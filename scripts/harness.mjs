/**
 * Runs the plugin's Host half outside DSH with a stub ctx, so the fetch/cache
 * path can be verified before a restart. Not part of the bundle.
 */
import { readFileSync } from 'node:fs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../plugins/ollama-board/index.js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(line => line.includes('=') && !line.trim().startsWith('#'))
    .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
)

const routes = new Map()
const ctx = {
  effect(callback) { return callback() },
  webServer: {
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
  },
}

const keyFile = path.join(mkdtempSync(path.join(tmpdir(), 'ob-')), 'key')
writeFileSync(keyFile, `${env.OLLAMA_API_KEY}\n`)
apply(ctx, { keyFile })
console.log('routes:', [...routes.keys()])

// The Host half now starts a beat on activation; the first read should wait
// for that fill rather than return an empty board.
const started = Date.now()
const response = await routes.get('/ollama-board/snapshot').resource(new Request('http://x/ollama-board/snapshot'))
const body = await response.json()
console.log('status:', response.status, 'took:', Date.now() - started, 'ms')
console.log('configured:', body.configured, 'stale:', body.stale, 'error:', body.error)
console.log('balance:', JSON.stringify(body.balance))
for (const range of ['24h', '7d', '30d']) {
  const usage = body.usage[range]
  console.log(`${range}: buckets=${usage?.buckets?.length} totals=`, JSON.stringify(usage?.totals && {
    request_count: usage.totals.request_count,
    usage_usd: usage.totals.usage_usd,
    input_tokens: usage.totals.input_tokens,
    cached: usage.totals.cached_input_tokens,
    output_tokens: usage.totals.output_tokens,
    groups: (usage.totals.groups || []).length,
  }))
}

const cached = Date.now()
await routes.get('/ollama-board/snapshot').resource(new Request('http://x/'))
console.log('second call (cache) took:', Date.now() - cached, 'ms')

console.log('beat timer active — exiting so the harness does not hang')
process.exit(0)
