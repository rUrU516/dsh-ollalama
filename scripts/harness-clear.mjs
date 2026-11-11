/**
 * End-to-end check of the two failure paths, which needs two beats:
 *
 *   1st beat  valid payload   -> cached and served
 *   2nd beat  garbage payload -> cache cleared, because the shape gate means
 *                                "we no longer know what this API says"
 *
 * Takes about 65 seconds. Not part of the bundle.
 */
import { createServer } from 'node:http'
import { apply } from '../plugins/ollama-board/index.js'

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
  totals: {
    usage_usd: 0,
    request_count: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
  },
  buckets: [],
}

let requests = 0
const upstream = createServer((req, res) => {
  requests += 1
  const good = requests <= 4
  const path = req.url.split('?')[0]
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(good ? (path === '/api/balance' ? GOOD_BALANCE : GOOD_USAGE) : { nope: true }))
})
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
const { port } = upstream.address()

const routes = new Map()
apply({
  effect: callback => callback(),
  webServer: { register: route => { routes.set(route.path, route); return () => {} } },
}, { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}` })

const read = async () => (await routes.get('/ollama-board/snapshot').resource(new Request('http://x/'))).json()
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

await wait(1_000)
const afterFirst = await read()
console.log('after 1st beat -> balance:', afterFirst.balance === null ? null : afterFirst.balance.included.balance_usd,
  '| fetchedAt set:', afterFirst.fetchedAt !== null, '| error:', afterFirst.error)

await wait(62_000)
const afterSecond = await read()
console.log('after 2nd beat -> balance:', afterSecond.balance, '| fetchedAt:', afterSecond.fetchedAt,
  '| error:', afterSecond.error)

const passed = afterFirst.balance !== null
  && afterSecond.balance === null
  && afterSecond.fetchedAt === null
  && /unexpected shape/.test(afterSecond.error)

console.log(passed ? 'PASS: valid beat cached, malformed beat cleared the cache' : 'FAIL: unexpected outcome')

upstream.close()
process.exit(0)
