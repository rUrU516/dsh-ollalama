/**
 * Host half of the Ollama Cloud dashboard.
 *
 * Three pieces of logic: keep the last successful snapshot, try again every
 * minute, and serve that snapshot read-only.
 *
 * There is no retry, no backoff and no lock: the next beat is the retry, and
 * the 20s timeout keeps a hung round well under the 60s beat, so two rounds can
 * never overlap. A transport failure keeps the previous snapshot; a response in
 * an unexpected shape clears it (see `pull`).
 */

export const name = 'ollama-board'
export const inject = ['webServer']

const BASE_URL = 'https://ollama.com'
const BEAT_MS = 60_000
const TIMEOUT_MS = 20_000
const RANGES = ['24h', '7d', '30d']

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
 *   fetchedAt: number | null,  // last SUCCESSFUL pull; null means nothing usable
 *   error: string | null,
 *   configured: boolean,       // an API key is present
 *   stale: boolean,            // fetchedAt older than two beats
 * }
 *
 * Meaning of the two wallets: `included` is the subscription allowance and
 * resets every billing period; `purchased` is bought credit and never resets.
 * `totals.usage_usd` covers spending from BOTH, while `allowance_usd -
 * balance_usd` only measures the subscription part.
 *
 * `input_tokens` already includes `cached_input_tokens` — never add them.
 *
 * Anything that fails this shape is discarded, so a consumer needs one branch
 * only: `ready = snapshot.balance !== null`.
 */

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = value => typeof value === 'number' && Number.isFinite(value)

/**
 * Anything we do not recognise is a failed round, never a half-usable one:
 * nothing is cached, so every reader keeps seeing the previous state or none.
 */
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

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export function apply(ctx, config = {}) {
  const apiKey = String(config.apiKey || '').trim()
  const baseUrl = String(config.baseUrl || BASE_URL).replace(/\/+$/, '')

  // The only state: the last good pull, or the last error when nothing has
  // succeeded yet. `fetchedAt` never moves on failure, so the browser can
  // report the real age of what it is showing.
  let snapshot = { balance: null, usage: {}, fetchedAt: null, error: null }

  async function get(path) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`)
    return response.json()
  }

  async function pull() {
    try {
      const [balance, ...ranges] = await Promise.all([
        get('/api/balance'),
        ...RANGES.map(range => get(`/api/usage?range=${range}&group_by=model`)),
      ])
      const usage = Object.fromEntries(RANGES.map((range, index) => [range, ranges[index]]))
      if (!isExpected(balance, usage)) {
        // We got an answer, but not one this plugin understands. Our assumptions
        // about the payload are void, so keeping the old numbers would present a
        // guess as if it were current.
        snapshot = { balance: null, usage: {}, fetchedAt: null, error: 'ollama.com answered in an unexpected shape' }
        return
      }
      snapshot = { balance, usage, fetchedAt: Date.now(), error: null }
    } catch (error) {
      // Nothing came back at all: still a transport blip, so the last good
      // numbers stay on screen and the next beat retries.
      snapshot = { ...snapshot, error: error instanceof Error ? error.message : String(error) }
    }
  }

  if (!apiKey) snapshot = { ...snapshot, error: 'No API key configured for ollama-board.' }

  // The first read must not land before the first round finishes, otherwise a
  // board opened right after launch shows empty cards until the next beat.
  const ready = apiKey ? pull() : Promise.resolve()

  if (apiKey) {
    ctx.effect(() => {
      const timer = setInterval(pull, BEAT_MS)
      return () => clearInterval(timer)
    }, 'ollama-board: one pull per minute')
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/ollama-board/snapshot',
    resource: async () => {
      await ready
      const stale = snapshot.fetchedAt === null || Date.now() - snapshot.fetchedAt > BEAT_MS * 2
      return json({ ...snapshot, configured: apiKey.length > 0, stale })
    },
  }), 'ollama-board: snapshot route')
}
