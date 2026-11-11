/**
 * Proves the shape gate: an upstream that answers the wrong shape must not be
 * cached, so every reader sees "no data" instead of a half-filled board.
 */
import { createServer } from 'node:http'
import { apply } from '../plugins/ollama-board/index.js'

const wrongShapes = {
  '/api/balance': { included: { balance_usd: 'lots' } },
  '/api/usage': { nope: true },
}

const upstream = createServer((req, res) => {
  const path = req.url.split('?')[0]
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(wrongShapes[path] ?? {}))
})
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
const { port } = upstream.address()

const routes = new Map()
apply({
  effect: callback => callback(),
  webServer: { register: route => { routes.set(route.path, route); return () => {} } },
}, { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}` })

const body = await (await routes.get('/ollama-board/snapshot').resource(new Request('http://x/'))).json()

console.log('balance:', body.balance)
console.log('usage keys:', Object.keys(body.usage))
console.log('fetchedAt:', body.fetchedAt)
console.log('error:', body.error)
console.log(body.balance === null && body.fetchedAt === null && /unexpected shape/.test(body.error)
  ? 'PASS: wrong shape was not cached'
  : 'FAIL: wrong shape leaked into the snapshot')

upstream.close()
process.exit(0)
