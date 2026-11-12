/**
 * Exercises the key route: a rejected candidate must not be stored, an accepted
 * one must be written to the key file and take effect on the spot.
 */
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../plugins/ollama-board/index.js'

const GOOD = 'good-key'
const GOOD_BALANCE = {
  included: {
    balance_usd: 60,
    allowance_usd: 60,
    period: { from: '2026-11-11T00:00:00Z', until: '2026-12-11T00:00:00Z' },
  },
  purchased: { balance_usd: 0 },
}
const GOOD_USAGE = {
  granularity: 'day',
  totals: { usage_usd: 0, request_count: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
  buckets: [],
}

const upstream = createServer((req, res) => {
  if (req.headers.authorization === 'Bearer limited-key') {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '42' })
    res.end('{"error":"too many requests"}')
    return
  }
  if (req.headers.authorization !== `Bearer ${GOOD}`) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end('{"error":"invalid credentials"}')
    return
  }
  const pathname = req.url.split('?')[0]
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(pathname === '/api/balance' ? GOOD_BALANCE : GOOD_USAGE))
})
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
const { port } = upstream.address()

// No key file at all: this is the first-run state.
const keyFile = path.join(mkdtempSync(path.join(tmpdir(), 'ob-')), 'key')

const routes = new Map()
apply({
  effect: callback => callback(),
  get: () => undefined,
  webServer: { register: route => { routes.set(route.path, route); return () => {} } },
}, { keyFile, baseUrl: `http://127.0.0.1:${port}` })

const read = async () => (await routes.get('/ollama-board/snapshot').resource(new Request('http://x/'))).json()

async function post(key, method = 'POST') {
  const body = JSON.stringify({ apiKey: key })
  const request = { method, async *[Symbol.asyncIterator]() { yield Buffer.from(body) } }
  let status = 0
  let text = ''
  const response = { writeHead(code) { status = code }, end(chunk) { text = chunk || '' } }
  await routes.get('/ollama-board/key').handler(request, response)
  return { status, body: JSON.parse(text || '{}') }
}

const first = await read()
console.log('no key    -> balance:', first.balance)

const getAttempt = await post('', 'GET')
const empty = await post('   ')
const denied = await post('wrong-key')
const deniedWrote = existsSync(keyFile)
const limited = await post('limited-key')
const accepted = await post(GOOD)

const after = await read()
console.log('GET       -> status:', getAttempt.status)
console.log('empty     ->', JSON.stringify(empty.body))
console.log('bad key   ->', JSON.stringify(denied.body), '| file written:', deniedWrote)
console.log('429       ->', JSON.stringify(limited.body))
console.log('good key  ->', JSON.stringify(accepted.body), '| stored:', readFileSync(keyFile, 'utf8').trim())
console.log('snapshot  -> balance:', after.balance && after.balance.included.balance_usd)

const passed = first.balance === null
  && getAttempt.status === 405
  && empty.body.code === 'empty'
  && denied.body.code === 'unauthorized' && deniedWrote === false
  && limited.body.code === 'rate-limited' && limited.body.retryAfter === 42
  && accepted.body.ok === true && readFileSync(keyFile, 'utf8').trim() === GOOD
  && after.balance.included.balance_usd === 60

console.log(passed ? 'PASS: rejected keys are not stored, accepted keys take effect' : 'FAIL')
upstream.close()
process.exit(passed ? 0 : 1)
