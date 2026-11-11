/**
 * Browser half of the Ollama Cloud dashboard.
 *
 * Renders one sidebar entry plus the dashboard page. Every number comes from
 * the Host half's cached snapshot routes — the API key never reaches the page.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-ollama-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'ollama-board'
    const RANGES = ['24h', '7d', '30d']
    // Local cache reads only; six a minute costs nothing and touches no upstream.
    const POLL_MS = 10_000

    const STRINGS = {
      zh: {
        nav: 'ollalama',
        title: 'ollalama',
        subtitle: '余额与用量',
        balance: '本期余额',
        used: '已用',
        purchased: '充值余额',
        resetIn: '距重置',
        days: '天',
        usage: '用量',
        requests: '请求',
        cost: '花费',
        total: '总计 Token',
        hitRate: '缓存命中',
        partial: '进行中',
        byModel: '按模型',
        model: '模型',
        noData: '这段时间没有记录到请求。',
        loading: '读取中…',
        unavailable: '暂时拿不到数据。',
        updated: '更新于',
        ago: '前',
        stale: '数据陈旧',
        delay: 'ollama.com 记账有分钟级延迟',
        error: '读取失败',
        notConfigured: '没有配置 API key，请在插件设置里填写。',
      },
      en: {
        nav: 'ollalama',
        title: 'ollalama',
        subtitle: 'Balance and usage',
        balance: 'Balance',
        used: 'used',
        purchased: 'Purchased credits',
        resetIn: 'resets in',
        days: 'days',
        usage: 'Usage',
        requests: 'Requests',
        cost: 'Cost',
        total: 'Total tokens',
        hitRate: 'Cache hit',
        partial: 'in progress',
        byModel: 'By model',
        model: 'Model',
        noData: 'No requests recorded in this range.',
        loading: 'Loading…',
        unavailable: 'No data available.',
        updated: 'Updated',
        ago: 'ago',
        stale: 'Stale',
        delay: 'ollama.com accounting lags by a minute or two',
        error: 'Read failed',
        notConfigured: 'No API key configured for this plugin.',
      },
    }

    function pickLocale() {
      try {
        const locale = ctxRef && ctxRef.get('locale')
        const snapshot = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null
        const id = String((snapshot && (snapshot.id || snapshot.locale)) || '')
        if (id) return id.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch (error) { /* fall through to the browser language */ }
      const nav = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
      return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    // ── formatting ──────────────────────────────────────────────────────────

    function money(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      if (n === 0) return '$0'
      if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`
      if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`
      return `$${n.toFixed(5)}`
    }

    function compactMoney(value) {
      return money(value).replace(/\.00$/, '')
    }

    function tokens(value) {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) return '0'
      if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
      if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
      if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`
      return String(Math.round(n))
    }

    function percent(part, total) {
      const p = Number(part)
      const t = Number(total)
      if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return 0
      return Math.max(0, Math.min(100, (p / t) * 100))
    }

    function day(iso) {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      return `${d.getMonth() + 1}/${d.getDate()}`
    }

    function hour(iso) {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      return `${String(d.getHours()).padStart(2, '0')}:00`
    }

    function ago(ms, t) {
      const n = Number(ms)
      if (!Number.isFinite(n) || n < 0) return '—'
      const s = Math.round(n / 1000)
      if (s < 60) return `${s}s ${t.ago}`
      const m = Math.round(s / 60)
      if (m < 60) return `${m}m ${t.ago}`
      return `${Math.round(m / 60)}h ${t.ago}`
    }

    // ── data access ─────────────────────────────────────────────────────────

    async function readSnapshot() {
      const response = await fetch('/ollama-board/snapshot', { cache: 'no-store', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    // ── sections ────────────────────────────────────────────────────────────

    function PanelIcon(props) {
      const size = (props && props.size) || 20
      const active = Boolean(props && props.active)
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
        stroke: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('path', { d: 'M3 17.5 L9 11 L13 14.5 L21 6.5' }),
        h('circle', { cx: 21, cy: 6.5, r: 2, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M3 21 H21', opacity: 0.4 }),
      )
    }

    function Metric(props) {
      return h('div', { className: 'ob-metric' },
        h('div', { className: 'ob-metric-label' }, props.label),
        h('div', { className: 'ob-metric-value' }, props.value),
        props.hint ? h('div', { className: 'ob-metric-hint' }, props.hint) : null,
      )
    }

    function BalanceCard(props) {
      const { balance, t } = props
      const { included, purchased } = balance
      const used = included.allowance_usd - included.balance_usd
      // The bar shows what is LEFT: a full bar means a full allowance, which is
      // the direction this card is supposed to communicate.
      const leftPercent = percent(included.balance_usd, included.allowance_usd)
      const usedPercent = percent(used, included.allowance_usd)
      const period = included.period
      const daysLeft = Math.max(0, Math.ceil((new Date(period.until).getTime() - Date.now()) / 86_400_000))
      const fill = leftPercent <= 10 ? 'ob-fill ob-fill-low' : leftPercent <= 25 ? 'ob-fill ob-fill-warn' : 'ob-fill'

      return h('div', { className: 'ob-card' },
        h('div', { className: 'ob-balance' },
          h('div', null,
            h('div', { className: 'ob-card-title' }, t.balance),
            h('div', { className: 'ob-balance-value' },
              money(included.balance_usd),
              h('span', { className: 'ob-balance-total' }, ` / ${compactMoney(included.allowance_usd)}`),
            ),
          ),
          h('div', { className: 'ob-balance-side' },
            h('div', { className: 'ob-metric-label' }, t.purchased),
            h('div', { className: 'ob-balance-sub' }, money(purchased.balance_usd)),
          ),
        ),
        h('div', { className: 'ob-track ob-track-lg' },
          h('div', { className: fill, style: { width: `${leftPercent}%` } }),
        ),
        h('div', { className: 'ob-metric-hint ob-split' },
          h('span', null, `${t.resetIn} ${daysLeft} ${t.days}`),
          h('span', { className: 'ob-mono' }, `${t.used} ${usedPercent.toFixed(1)}%`),
        ),
      )
    }

    function renderBars(props) {
      const { usage, hover, onEnter } = props
      const buckets = usage.buckets
      const values = buckets.map(bucket => bucket.usage_usd)
      const max = Math.max(...values)
      const flat = max <= 0

      return buckets.map((bucket, index) => {
        const value = values[index]
        const height = flat ? 2 : Math.max(value > 0 ? 3 : 1, (value / max) * 100)
        return h('div', {
          key: `${bucket.from}-${index}`,
          className: `ob-col${hover === index ? ' ob-col-active' : ''}`,
          onMouseEnter: onEnter ? () => onEnter(index) : undefined,
        }, h('div', {
          className: `ob-bar${bucket.partial ? ' ob-bar-partial' : ''}${value > 0 ? '' : ' ob-bar-zero'}`,
          style: { height: `${height}%` },
        }))
      })
    }

    function Chart(props) {
      const { usage, t, range } = props
      // Hover lives here so moving the pointer repaints the chart only.
      const [hover, setHover] = React.useState(null)

      // A range switch changes the bucket count; drop the hover so no tooltip
      // survives onto a bar the pointer is not over.
      React.useEffect(() => { setHover(null) }, [range])

      const buckets = usage.buckets
      if (buckets.length === 0) return h('div', { className: 'ob-empty' }, t.noData)

      const values = buckets.map(bucket => bucket.usage_usd)
      const max = Math.max(...values)
      const isHourly = usage.granularity === 'hour'
      const label = iso => (isHourly ? hour(iso) : day(iso))
      const flat = max <= 0
      const ticks = buckets.length > 1 ? [0, Math.floor(buckets.length / 2), buckets.length - 1] : [0]

      const active = hover !== null ? buckets[hover] : null
      const ratio = hover !== null && active ? (hover + 0.5) / buckets.length : 0
      // Pin the tooltip inside the card at both ends instead of centering it off-edge.
      const anchor = ratio < 0.15 ? '0%' : ratio > 0.85 ? '-100%' : '-50%'

      return h('div', { className: 'ob-chart' },
        h('div', { className: 'ob-bars', onMouseLeave: () => setHover(null) },
          ...renderBars({ usage, hover, onEnter: setHover }),
          active ? h('div', {
            className: 'ob-tip',
            style: { left: `${ratio * 100}%`, transform: `translateX(${anchor})` },
          },
            h('div', { className: 'ob-tip-head' },
              h('span', null, label(active.from)),
              active.partial ? h('span', { className: 'ob-tip-tag' }, t.partial) : null,
            ),
            h('div', { className: 'ob-tip-k' }, t.cost),
            h('div', { className: 'ob-tip-v' }, money(active.usage_usd)),
            h('div', { className: 'ob-tip-k' }, t.requests),
            h('div', { className: 'ob-tip-v' }, String(active.request_count)),
            h('div', { className: 'ob-tip-k' }, t.total),
            h('div', { className: 'ob-tip-v' }, tokens(active.input_tokens + active.output_tokens)),
            h('div', { className: 'ob-tip-k' }, t.hitRate),
            h('div', { className: 'ob-tip-v' }, `${percent(active.cached_input_tokens, active.input_tokens).toFixed(1)}%`),
          ) : null,
        ),
        h('div', { className: 'ob-ticks' },
          ...ticks.map(index => h('span', { key: index }, label(buckets[index].from))),
        ),
        flat ? h('div', { className: 'ob-empty' }, t.noData) : null,
      )
    }

    function ModelTable(props) {
      const { totals, t } = props
      const rows = totals.groups.slice().sort((a, b) => b.usage_usd - a.usage_usd)
      const remainder = totals.remainder
      if (remainder && remainder.request_count > 0) rows.push({ ...remainder, model: '…' })

      return h('table', { className: 'ob-table' },
        h('thead', null, h('tr', null,
          h('th', null, t.model),
          h('th', { className: 'ob-num' }, t.cost),
          h('th', { className: 'ob-num' }, t.requests),
          h('th', { className: 'ob-num' }, t.total),
          h('th', { className: 'ob-num' }, t.hitRate),
        )),
        h('tbody', null, ...rows.map((row, index) => h('tr', { key: `${row.model}-${index}` },
          h('td', { className: 'ob-model' }, row.model),
          h('td', { className: 'ob-num ob-mono' }, money(row.usage_usd)),
          h('td', { className: 'ob-num ob-mono' }, String(row.request_count)),
          h('td', { className: 'ob-num ob-mono' }, tokens(row.input_tokens + row.output_tokens)),
          h('td', { className: 'ob-num ob-mono' }, `${percent(row.cached_input_tokens, row.input_tokens).toFixed(1)}%`),
        ))),
      )
    }

    // The age must tick locally: the Host computed it once when the snapshot was
    // served, so reusing that number would freeze the label between reads.
    function Freshness(props) {
      const { data, t } = props
      const [now, setNow] = React.useState(Date.now())

      React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1_000)
        return () => clearInterval(id)
      }, [])

      const bits = []
      if (data && data.fetchedAt) {
        // The age ticks live, but staleness is judged by the Host at read time:
        // comparing the live age against the TTL would flash "stale" for the few
        // seconds before every scheduled read.
        bits.push(`${t.updated} ${ago(Math.max(0, now - data.fetchedAt), t)}`)
        if (data.stale) bits.push(t.stale)
      } else if (data) {
        bits.push(t.stale)
      } else {
        bits.push(t.loading)
      }
      return h('span', null, bits.join(' · '))
    }

    function Page() {
      const [range, setRange] = React.useState('24h')
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const locale = pickLocale()
      const t = STRINGS[locale] || STRINGS.en

      React.useEffect(() => {
        async function load() {
          try {
            setData(await readSnapshot())
            setError(null)
          } catch (failure) {
            setError(String((failure && failure.message) || failure))
          }
        }
        // Same shape as the Host beat: one action, one timer, no conditions.
        // The mount call is just the beat that fires at t=0 instead of t=10s.
        load()
        const timer = setInterval(load, POLL_MS)
        return () => clearInterval(timer)
      }, [])

      // The Host caches only responses that match the expected shape, so a
      // snapshot either carries everything below or no balance at all.
      const ready = Boolean(data && data.balance)
      const usage = ready ? data.usage[range] : null
      const totals = ready ? usage.totals : null
      const groups = ready && Array.isArray(totals.groups) ? totals.groups : []
      const hasGroups = groups.length > 0
        || Boolean(totals && totals.remainder && totals.remainder.request_count > 0)

      return h('div', { className: 'ob-page' },
        h('div', { className: 'ob-wrap' },
          h('div', { className: 'ob-head' },
            h('div', null,
              h('div', { className: 'ob-title' }, t.title),
              h('div', { className: 'ob-sub' }, t.subtitle),
            ),
          ),

          error ? h('div', { className: 'ob-error' }, `${t.error}: ${error}`) : null,
          data && data.error ? h('div', { className: 'ob-error' }, data.error) : null,
          data && !data.configured ? h('div', { className: 'ob-error' }, t.notConfigured) : null,

          ready
            ? h(BalanceCard, { balance: data.balance, t })
            : h('div', { className: 'ob-card' },
                h('div', { className: 'ob-empty' }, data ? t.unavailable : t.loading)),

          ready ? h('div', { className: 'ob-card' },
            h('div', { className: 'ob-card-head' },
              h('div', { className: 'ob-card-title' }, t.usage),
              h('div', { className: 'ob-tabs' }, ...RANGES.map(value => h('button', {
                key: value,
                type: 'button',
                className: `ob-tab${value === range ? ' ob-tab-active' : ''}`,
                onClick: () => setRange(value),
              }, value))),
            ),
            h('div', { className: 'ob-metrics' },
              h(Metric, { label: t.cost, value: money(totals.usage_usd) }),
              h(Metric, { label: t.requests, value: String(totals.request_count) }),
              // input already contains cached, so the total is input + output only.
              h(Metric, { label: t.total, value: tokens(totals.input_tokens + totals.output_tokens) }),
              h(Metric, { label: t.hitRate, value: `${percent(totals.cached_input_tokens, totals.input_tokens).toFixed(1)}%` }),
            ),
            h(Chart, { usage, t, range }),
          ) : null,

          ready ? h('div', { className: 'ob-card' },
            h('div', { className: 'ob-card-head' },
              h('div', { className: 'ob-card-title' }, t.byModel),
            ),
            hasGroups ? h(ModelTable, { totals, t }) : h('div', { className: 'ob-empty' }, t.noData),
          ) : null,

          h('div', { className: 'ob-foot' },
            h(Freshness, { data, t }),
            h('span', { className: 'ob-dim' }, t.delay),
          ),
        ),
      )
    }

    // ── styles ──────────────────────────────────────────────────────────────

    const CSS = `
      .ob-page { height: 100%; overflow: auto; padding: 28px 32px 56px; box-sizing: border-box; }
      .ob-wrap { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
      .ob-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .ob-title { font-size: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .ob-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 4px; }
      .ob-card {
        background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px;
      }
      .ob-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .ob-card-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .ob-balance { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .ob-balance-value { font-size: 32px; font-weight: 600; line-height: 1.1; margin-top: 6px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
      .ob-balance-total { font-size: 16px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
      .ob-balance-side { text-align: right; }
      .ob-balance-sub { font-size: 16px; margin-top: 4px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
      .ob-track { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
      .ob-track-lg { height: 8px; }
      .ob-fill { height: 100%; background: var(--dsw-alias-brand-primary); border-radius: 999px; transition: width .3s ease; }
      .ob-fill-warn { background: var(--dsw-alias-state-warn-primary); }
      .ob-fill-low { background: var(--dsw-alias-state-error-primary); }
      .ob-split { display: flex; justify-content: space-between; }
      .ob-metric-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .ob-metric-value { font-size: 18px; font-weight: 600; margin-top: 3px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
      .ob-metric-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
      .ob-metrics { display: flex; gap: 32px; flex-wrap: wrap; }
      .ob-tabs { display: flex; gap: 4px; background: var(--dsw-alias-bg-layer-2); padding: 3px; border-radius: 8px; }
      .ob-tab {
        font: inherit; font-size: 12px; cursor: pointer; border: 0; border-radius: 6px;
        padding: 4px 12px; background: transparent; color: var(--dsw-alias-label-secondary);
      }
      .ob-tab-active { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 600; }
      .ob-chart { display: flex; flex-direction: column; gap: 8px; }
      .ob-bars { position: relative; display: flex; align-items: flex-end; gap: 3px; height: 132px; }
      .ob-col { flex: 1 1 0; min-width: 2px; height: 100%; display: flex; align-items: flex-end; }
      .ob-bar {
        width: 100%; background: var(--dsw-alias-brand-primary); border-radius: 2px 2px 0 0;
        opacity: .85; transition: transform .12s ease;
      }
      .ob-col-active .ob-bar { transform: translateY(-2px); }
      .ob-bar-zero { background: var(--dsw-alias-state-idle-primary); opacity: .35; }
      .ob-bar-partial { opacity: .4; box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
      /* Same surface, border and radius as .ob-card — no separate popover look. */
      .ob-tip {
        position: absolute; bottom: calc(100% + 6px); z-index: 2; pointer-events: none;
        display: grid; grid-template-columns: auto auto; gap: 3px 16px; align-items: baseline;
        padding: 10px 12px; border-radius: 12px; white-space: nowrap;
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
      }
      .ob-tip-head {
        grid-column: 1 / -1; display: flex; align-items: center; gap: 6px;
        font-size: 11px; color: var(--dsw-alias-label-secondary);
      }
      .ob-tip-tag {
        padding: 1px 5px; border-radius: 4px; font-size: 10px;
        border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary);
      }
      .ob-tip-k { font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .ob-tip-v { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
      .ob-ticks { display: flex; justify-content: space-between; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .ob-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .ob-table th {
        text-align: left; font-weight: 500; font-size: 11px; padding: 6px 8px;
        color: var(--dsw-alias-label-secondary); border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .ob-table td { padding: 7px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
      .ob-table tr:last-child td { border-bottom: 0; }
      .ob-num { text-align: right; }
      .ob-mono { font-variant-numeric: tabular-nums; }
      .ob-model { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .ob-dim { color: var(--dsw-alias-label-secondary); }
      .ob-empty { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 8px 0; }
      .ob-error {
        font-size: 12px; padding: 10px 12px; border-radius: 8px;
        color: var(--dsw-alias-state-error-primary);
        border: 1px solid var(--dsw-alias-state-error-primary);
        background: var(--dsw-alias-bg-layer-1);
      }
      .ob-foot { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
    `

    let ctxRef = null

    return {
      inject: ['slots'],
      apply(ctx) {
        ctxRef = ctx

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-ollama-board', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'ollama-board: styles')

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          label: () => (STRINGS[pickLocale()] || STRINGS.en).nav,
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Page))
      },
    }
  },
})
