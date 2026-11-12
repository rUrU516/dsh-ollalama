/**
 * Renders the Client half outside a browser with a tiny React stand-in.
 *
 * Catches the class of bug that blanked the page: a render-time TypeError in a
 * component (for example spreading `createElement`'s return value). Uses no
 * network and needs no DOM — components only produce element trees.
 */
import { readFileSync } from 'node:fs'

// ── tiny React ───────────────────────────────────────────────────────────────

let scope = { index: 0, overrides: [] }
let pendingOverrides = []

function createElement(type, props, ...children) {
  return { type, props: { ...(props || {}), children: children.flat(Infinity) } }
}

function useState(initial) {
  const entry = scope.overrides[scope.index]
  scope.index += 1
  return [entry === undefined ? initial : entry.value, () => {}]
}

function useRef(initial) {
  scope.index += 1
  return { current: initial }
}

function useEffect() { scope.index += 1 }

const React = { createElement, useState, useRef, useEffect }

// ── tiny renderer ────────────────────────────────────────────────────────────

function render(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join('')
  const { type, props } = node
  if (typeof type === 'function') {
    const outer = scope
    scope = { index: 0, overrides: pendingOverrides }
    pendingOverrides = []
    try {
      return render(type(props))
    } finally {
      scope = outer
    }
  }
  return (props.children || []).map(render).join('')
}

// ── load the real Client half ────────────────────────────────────────────────

let definition = null
globalThis.window = { __ModuleLoader__: { load: value => { definition = value } } }
// Node ships a read-only `navigator`; force the zh locale so assertions are stable.
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
globalThis.document = {
  head: { appendChild() {}, },
  createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
  addEventListener() {}, removeEventListener() {},
}

await import('../plugins/ollama-board/client.js')
const plugin = definition.factory(specifier => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require: ${specifier}`)
})

const registered = new Map()
plugin.apply({
  effect: callback => { callback(); return () => {} },
  on: () => () => {},
  get: () => undefined,
  slots: {
    inject: (key, callback) => { callback(); return () => {} },
    register: (options, component) => { registered.set(options.key || options.id, component); return () => {} },
  },
})

const Page = registered.get('ollama-board')

// ── fixture matching the documented snapshot shape ───────────────────────────

const bucket = (from, usd, requests, input, cached, output, partial) => ({
  from, until: from, usage_usd: usd, request_count: requests,
  input_tokens: input, cached_input_tokens: cached, output_tokens: output,
  ...(partial ? { partial: true } : {}),
})

const group = (model, usd, requests, input, cached, output) => ({
  model, usage_usd: usd, request_count: requests,
  input_tokens: input, cached_input_tokens: cached, output_tokens: output,
})

function range(range, granularity, count, unit) {
  const buckets = Array.from({ length: count }, (_, index) =>
    bucket(`2026-11-11T${String(index % 24).padStart(2, '0')}:00:00Z`, index === count - 1 ? 0.02 : 0.001,
      unit, 1000 * (index + 1), 900 * (index + 1), 50, index === count - 1))
  return {
    range, granularity, from: buckets[0].from, until: buckets.at(-1).from,
    totals: {
      request_count: count * unit, usage_usd: 0.3482,
      input_tokens: 23_337_922, cached_input_tokens: 23_194_240, output_tokens: 137_702,
      groups: [group('deepseek-v4.1-flash:1017', 0.34816, 155, 23_337_856, 23_194_240, 137_670),
               group('gemma4:31b', 0.00004, 4, 66, 0, 32)],
    },
    buckets,
  }
}

const snapshot = {
  balance: {
    included: {
      balance_usd: 59.64751,
      allowance_usd: 60,
      period: { from: '2026-11-11T14:32:44Z', until: '2026-12-11T14:32:44Z' },
    },
    purchased: { balance_usd: 0 },
  },
  usage: {
    '24h': range('24h', 'hour', 25, 6),
    '7d': range('7d', 'day', 8, 20),
    '30d': range('30d', 'day', 31, 5),
  },
  fetchedAt: Date.now() - 5_000,
  error: null,
  configured: true,
  stale: false,
}

// ── run ──────────────────────────────────────────────────────────────────────

const NO_DATA = { balance: null, usage: {}, fetchedAt: null }

const cases = [
  ['24h', [{ value: '24h' }, { value: snapshot }], ['缓存命中', '$']],
  ['7d', [{ value: '7d' }, { value: snapshot }], ['缓存命中']],
  ['30d', [{ value: '30d' }, { value: snapshot }], ['缓存命中']],
  ['first run', [], ['暂时拉不到数据']],
  ['no data', [{ value: '24h' }, { value: NO_DATA }], ['暂时拉不到数据']],
]

let failed = false
for (const [name, overrides, expected] of cases) {
  try {
    pendingOverrides = overrides
    const html = render(createElement(Page))
    const ok = expected.every(word => html.includes(word))
    console.log(`${name.padEnd(9)} -> ${html.length} chars ${ok ? 'OK' : 'MISSING TEXT'}`)
    if (process.env.DUMP && name === '24h') console.log('  full:', html)
    if (!ok) { failed = true; console.log('  output:', html.slice(0, 300)) }
  } catch (error) {
    failed = true
    console.log(`${name.padEnd(9)} -> THREW: ${error && error.message}`)
    console.log(error && error.stack)
  }
}

// the sidebar icon must render too
try {
  const icon = registered.get('ollama-board')
  render(createElement(icon, { size: 20, active: true }))
  console.log('icon      -> OK')
} catch (error) {
  failed = true
  console.log('icon      -> THREW:', error && error.message)
}

console.log(failed ? 'FAIL' : 'PASS: every state renders without throwing')
process.exit(failed ? 1 : 0)
