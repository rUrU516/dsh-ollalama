/**
 * Host half of the Ollama Cloud dashboard.
 *
 * One timer, one snapshot, two routes:
 *   every 60s       read the key file, pull balance + three usage ranges
 *   GET  /snapshot  serve the cached snapshot
 *   POST /key       validate a candidate key, store it, pull once
 *
 * There is no retry, no backoff and no lock: the next beat is the retry, and
 * the 20s timeout keeps a hung round well under the 60s beat.
 */

import { chmod, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'ollama-board'
export const inject = ['webServer']

const BASE_URL = 'https://ollama.com'
const BEAT_MS = 60_000
const TIMEOUT_MS = 20_000
const RANGES = ['24h', '7d', '30d']

// One source of truth for the secret: a 0600 file, written by the key route and
// read on every beat, so replacing the key needs no restart.
const KEY_FILE = path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'ollama-board.key')

/**
 * The snapshot this plugin serves, and the only shape any consumer may assume:
 *
 * {
 *   balance: {
 *     included: { balance_usd, allowance_usd, period: { from, until } },
 *     purchased: { balance_usd },
 *   },
 *   usage: {
 *     '24h' | '7d' | '30d': {
 *       granularity: 'hour' | 'day',
 *       totals: {
 *         usage_usd, request_count, input_tokens, cached_input_tokens, output_tokens,
 *         groups?: [{ model, request_count, usage_usd, input_tokens, cached_input_tokens, output_tokens }],
 *         remainder?: { same fields as a group },
 *       },
 *       buckets: [{ from, until, partial?, usage_usd, request_count, input_tokens, cached_input_tokens, output_tokens }],
 *     },
 *   },
 *   fetchedAt: number | null,    // last SUCCESSFUL pull; null means nothing usable
 * }
 *
 * The snapshot carries data only. A failed beat is silent: the previous numbers
 * stay, and the browser shows their real age. Failure codes exist solely in the
 * answer to POST /key, which is a direct reply to what the user just did.
 *
 * Meaning of the two wallets: `included` is the subscription allowance and
 * resets every billing period; `purchased` is bought credit and never resets.
 * `totals.usage_usd` covers spending from BOTH, while `allowance_usd -
 * balance_usd` only measures the subscription part.
 *
 * `input_tokens` already includes `cached_input_tokens` — never add them.
 */

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = value => typeof value === 'number' && Number.isFinite(value)

/** The payload is not the shape this plugin was written against. */
class UnexpectedShape extends Error {}

/** 429: the account meters these endpoints at 10 requests a minute. */
class RateLimited extends Error {
  constructor(retryAfter) {
    super(`rate limited, retry in ${retryAfter}s`)
    this.retryAfter = retryAfter
  }
}

/** Any other non-2xx answer. */
class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

function classify(error) {
  if (error instanceof RateLimited) return { code: 'rate-limited', retryAfter: error.retryAfter }
  if (error instanceof UnexpectedShape) return { code: 'bad-shape', retryAfter: null }
  if (error && error.name === 'TimeoutError') return { code: 'timeout', retryAfter: null }
  if (error instanceof HttpError) {
    if (error.status === 401) return { code: 'unauthorized', retryAfter: null }
    if (error.status === 403) return { code: 'forbidden', retryAfter: null }
  }
  return { code: 'server-error', retryAfter: null }
}

/** Anything unrecognised is a failed round, never a half-usable one. */
function isExpected(balance, usage) {
  if (!isObject(balance)) return false
  const { included, purchased } = balance
  if (!isObject(included) || !isObject(purchased)) return false
  if (!isNumber(included.balance_usd) || !isNumber(included.allowance_usd)) return false
  if (!isObject(included.period)) return false
  if (typeof included.period.from !== 'string' || typeof included.period.until !== 'string') return false
  if (!isNumber(purchased.balance_usd)) return false
  return RANGES.every(range => {
    const data = usage[range]
    if (!isObject(data) || typeof data.granularity !== 'string') return false
    if (!isObject(data.totals) || !Array.isArray(data.buckets)) return false
    const totals = data.totals
    if (!isNumber(totals.usage_usd) || !isNumber(totals.request_count)) return false
    if (!isNumber(totals.input_tokens) || !isNumber(totals.cached_input_tokens)) return false
    if (!isNumber(totals.output_tokens)) return false
    return data.buckets.every(bucket => isObject(bucket) && typeof bucket.from === 'string')
  })
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const EMPTY = { balance: null, usage: {}, fetchedAt: null }

export function apply(ctx, config = {}) {
  const baseUrl = String(config.baseUrl || BASE_URL).replace(/\/+$/, '')
  const keyFile = String(config.keyFile || KEY_FILE)

  let snapshot = { ...EMPTY }

  async function currentKey() {
    try {
      return (await readFile(keyFile, 'utf8')).trim()
    } catch (error) {
      return ''
    }
  }

  async function get(pathname, key) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 429) throw new RateLimited(Math.max(1, Number(response.headers.get('retry-after')) || 60))
    if (!response.ok) throw new HttpError(response.status)
    return response.json()
  }

  async function load(key) {
    const [balance, ...ranges] = await Promise.all([
      get('/api/balance', key),
      ...RANGES.map(range => get(`/api/usage?range=${range}&group_by=model`, key)),
    ])
    const usage = Object.fromEntries(RANGES.map((range, index) => [range, ranges[index]]))
    if (!isExpected(balance, usage)) throw new UnexpectedShape('unexpected shape')
    return { balance, usage }
  }

  async function pull() {
    const key = await currentKey()
    if (!key) {
      snapshot = { ...EMPTY }
      return
    }
    try {
      const fresh = await load(key)
      snapshot = { ...fresh, fetchedAt: Date.now() }
    } catch (error) {
      // A shape change invalidates our reading of the payload, so the old
      // numbers go too; any other failure keeps them on screen.
      if (error instanceof UnexpectedShape) snapshot = { ...EMPTY }
    }
  }

  const ready = pull()

  ctx.effect(() => {
    const timer = setInterval(pull, BEAT_MS)
    return () => clearInterval(timer)
  }, 'ollama-board: one pull per minute')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/ollama-board/snapshot',
    // The snapshot, verbatim: consumers derive age from fetchedAt themselves.
    resource: async () => {
      await ready
      return json(snapshot)
    },
  }), 'ollama-board: snapshot route')

  // The candidate is stored only once the account accepts it, so the panel can
  // never end up holding a key that reads nothing.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/ollama-board/key',
    handler: async (request, response) => {
      const reply = (body, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify(body))
      }

      if (request.method !== 'POST') {
        reply({ ok: false, code: 'server-error' }, 405)
        return
      }

      let raw = ''
      try {
        for await (const chunk of request) raw += chunk
      } catch (error) {
        reply({ ok: false, code: 'server-error' })
        return
      }

      let candidate = ''
      try {
        candidate = String((JSON.parse(raw) || {}).apiKey || '').trim()
      } catch (error) { /* malformed body */ }
      if (!candidate) {
        reply({ ok: false, code: 'empty' })
        return
      }

      try {
        // One authenticated call is enough to prove the key.
        await get('/api/balance', candidate)
      } catch (error) {
        reply({ ok: false, ...classify(error) })
        return
      }

      try {
        await writeFile(keyFile, `${candidate}\n`, { mode: 0o600 })
        await chmod(keyFile, 0o600).catch(() => {})
      } catch (error) {
        reply({ ok: false, code: 'server-error' })
        return
      }

      await pull()
      reply({ ok: true })
    },
  }), 'ollama-board: key route')
}
