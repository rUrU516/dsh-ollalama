/**
 * Browser half of the Ollama Cloud dashboard.
 *
 * Renders one sidebar entry plus the dashboard page. Every number comes from
 * the Host half's cached snapshot routes — the API key never reaches the page.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ollama-board',
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
        empty: '暂时拉不到数据。',
        updated: '更新于',
        ago: '前',
        delay: 'ollama.com 记账有分钟级延迟',
        keyTitle: '设置 API key',
        floatTitle: '悬浮窗',
        keySave: '校验并保存',
        keyCancel: '收起',
        errors: {
          'no-key': '还没有配置 API key',
          empty: '请输入 key',
          unauthorized: 'key 被拒绝',
          forbidden: '账号被限制或无权访问',
          'rate-limited': '请求太频繁',
          'server-error': 'ollama.com 返回了错误',
          timeout: '连接 ollama.com 超时',
          'bad-shape': 'ollama.com 的返回格式变了',
        },
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
        empty: 'Nothing to show right now.',
        updated: 'Updated',
        ago: 'ago',
        delay: 'ollama.com accounting lags by a minute or two',
        keyTitle: 'Set API key',
        floatTitle: 'Floating window',
        keySave: 'Check and save',
        keyCancel: 'Collapse',
        errors: {
          'no-key': 'No API key configured',
          empty: 'Enter a key first',
          unauthorized: 'Key rejected',
          forbidden: 'Account restricted or not allowed',
          'rate-limited': 'Too many requests',
          'server-error': 'ollama.com returned an error',
          timeout: 'Timed out reaching ollama.com',
          'bad-shape': 'ollama.com answered in an unexpected shape',
        },
      },
    }

    function pickLocale() {
      try {
        const locale = ctxRef && ctxRef.get('locale')
        const snapshot = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null
        // LocaleSnapshot publishes `active`; a wrong field name falls back silently.
        const id = String((snapshot && snapshot.active) || '')
        if (id) return id.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch (error) { /* fall through to the browser language */ }
      const nav = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
      return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    const stringsFor = () => STRINGS[pickLocale()] || STRINGS.en

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
        // The age ticks live, so the label always describes the data on screen.
        bits.push(`${t.updated} ${ago(Math.max(0, now - data.fetchedAt), t)}`)
      }
      return h('span', null, bits.join(' · '))
    }

    // One boolean shared by the page (button) and the overlay (window). The two
    // live in different slots, so a module-level store is the shortest path.
    const floatStore = {
      open: false,
      listeners: new Set(),
      set(patch) {
        Object.assign(this, patch)
        for (const listener of this.listeners) listener()
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }

    function useFloat() {
      const [, bump] = React.useState(0)
      React.useEffect(() => floatStore.subscribe(() => bump(n => n + 1)), [])
      return floatStore
    }

    function FloatIcon(props) {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('circle', { cx: 12, cy: 12, r: 7.5 }),
        props.active ? h('circle', { cx: 12, cy: 12, r: 3, fill: 'currentColor', stroke: 'none' }) : null,
      )
    }

    // The floating window: one ring of the subscription balance, nothing else.
    function FloatWindow() {
      const store = useFloat()
      const t = stringsFor()
      const [data, setData] = React.useState(null)
      const [pos, setPos] = React.useState(null)
      const drag = React.useRef(null)

      React.useEffect(() => {
        if (!store.open) return
        let cancelled = false
        async function load() {
          try {
            const next = await readSnapshot()
            if (!cancelled) setData(next)
          } catch (error) { /* keep the last copy */ }
        }
        load()
        const timer = setInterval(load, POLL_MS)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [store.open])

      if (!store.open) return null

      const included = data && data.balance ? data.balance.included : null
      const fraction = included && included.allowance_usd > 0
        ? Math.max(0, Math.min(1, included.balance_usd / included.allowance_usd))
        : 0
      const SIZE = 40
      const RADIUS = 16
      const CENTRE = SIZE / 2
      const CIRCUMFERENCE = 2 * Math.PI * RADIUS
      const arc = CIRCUMFERENCE * fraction

      const style = pos
        ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' }
        : { right: '28px', bottom: '28px' }

      const clamp = (value, max) => Math.max(0, Math.min(value, max))

      return h('div', {
        className: `ob-float${included ? '' : ' is-empty'}`,
        style,
        onPointerDown: event => {
          if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          const box = event.currentTarget.getBoundingClientRect()
          drag.current = { dx: event.clientX - box.left, dy: event.clientY - box.top }
        },
        onPointerMove: event => {
          if (!drag.current) return
          const width = typeof window === 'undefined' ? 0 : window.innerWidth
          const height = typeof window === 'undefined' ? 0 : window.innerHeight
          setPos({
            x: clamp(event.clientX - drag.current.dx, width - 48),
            y: clamp(event.clientY - drag.current.dy, height - 48),
          })
        },
        onPointerUp: () => { drag.current = null },
        onPointerCancel: () => { drag.current = null },
      },
        h('svg', { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': true },
          h('circle', {
            cx: CENTRE, cy: CENTRE, r: RADIUS, fill: 'none',
            stroke: 'var(--dsw-alias-bg-layer-2)', strokeWidth: 4,
          }),
          included ? h('circle', {
            cx: CENTRE, cy: CENTRE, r: RADIUS, fill: 'none',
            stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 4, strokeLinecap: 'round',
            strokeDasharray: `${arc} ${CIRCUMFERENCE - arc}`,
            transform: `rotate(-90 ${CENTRE} ${CENTRE})`,
          }) : null,
        ),

        included ? h('div', { className: 'ob-float-tip' },
          h('div', { className: 'ob-float-line strong' },
            `${money(included.balance_usd)} / ${compactMoney(included.allowance_usd)}`),
          h('div', { className: 'ob-float-line' },
            `${t.used} ${percent(included.allowance_usd - included.balance_usd, included.allowance_usd).toFixed(1)}%`),
          h('div', { className: 'ob-float-line' },
            `${t.resetIn} ${Math.max(0, Math.ceil((new Date(included.period.until).getTime() - Date.now()) / 86_400_000))} ${t.days}`),
        ) : h('div', { className: 'ob-float-tip' },
          h('div', { className: 'ob-float-line' }, t.empty),
        ),
      )
    }

    function KeyIcon() {
      return h('svg', {
        width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('circle', { cx: 8.5, cy: 8.5, r: 4 }),
        h('path', { d: 'M11.4 11.4 L20 20' }),
        h('path', { d: 'M16.2 16.2 L18.6 13.8' }),
      )
    }

    // A small control, not a mode: the panel keeps polling and rendering behind
    // it whatever happens here.
    function KeyBar(props) {
      const { open, saving, failure, t, floatOpen, onToggle, onToggleFloat, onSubmit, onClose } = props
      const [value, setValue] = React.useState('')
      const field = React.useRef(null)

      React.useEffect(() => {
        if (open && field.current) field.current.focus()
      }, [open])

      const submit = () => {
        const candidate = value.trim()
        if (saving || candidate === '') return
        onSubmit(candidate)
      }

      const base = failure ? (t.errors[failure.code] || t.errors['server-error']) : ''
      const message = failure && failure.retryAfter ? `${base} (${failure.retryAfter}s)` : base

      return h('div', { className: 'ob-keybar' },
        h('div', { className: `ob-keyform${open ? ' ob-keyform-open' : ''}` },
          h('input', {
            ref: field,
            className: 'ob-input',
            type: 'password',
            value,
            placeholder: 'ollama.com API key',
            spellCheck: false,
            autoComplete: 'off',
            disabled: saving,
            onChange: event => setValue(event.target.value),
            onKeyDown: event => { if (event.key === 'Enter') submit() },
          }),
          h('button', {
            type: 'button',
            className: 'ob-key-ok',
            onClick: submit,
            disabled: saving || value.trim() === '',
            title: t.keySave,
            'aria-label': t.keySave,
          }, saving ? '…' : '✓'),
          h('button', {
            type: 'button',
            className: 'ob-key-x',
            onClick: onClose,
            title: t.keyCancel,
            'aria-label': t.keyCancel,
          }, '×'),
        ),
        h('button', {
          type: 'button',
          className: `ob-key${floatOpen ? ' is-on' : ''}`,
          onClick: onToggleFloat,
          title: t.floatTitle,
          'aria-label': t.floatTitle,
        }, h(FloatIcon, { active: floatOpen })),

        h('button', {
          type: 'button',
          className: 'ob-key',
          onClick: onToggle,
          title: t.keyTitle,
          'aria-label': t.keyTitle,
        }, h(KeyIcon)),
        message ? h('div', { className: 'ob-keymsg' }, message) : null,
      )
    }

    function Page() {
      const [range, setRange] = React.useState('24h')
      const [data, setData] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [failure, setFailure] = React.useState(null)
      const float = useFloat()
      const t = stringsFor()

      React.useEffect(() => {
        async function load() {
          try {
            setData(await readSnapshot())
          } catch (error) { /* keep showing the last copy we had */ }
        }
        // Same shape as the Host beat: one action, one timer, no conditions.
        // The mount call is just the beat that fires at t=0 instead of t=10s.
        load()
        const timer = setInterval(load, POLL_MS)
        return () => clearInterval(timer)
      }, [])

      async function submitKey(value) {
        setSaving(true)
        setFailure(null)
        try {
          const response = await fetch('/ollama-board/key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: value }),
          })
          const text = await response.text()
          let body = null
          try { body = text ? JSON.parse(text) : null } catch (error) { body = null }
          if (!body) {
            setFailure({ code: 'server-error', retryAfter: null })
            return
          }
          if (!body.ok) {
            setFailure({ code: body.code, retryAfter: body.retryAfter || null })
            return
          }
          setOpen(false)
          setFailure(null)
          setData(await readSnapshot())
        } catch (error) {
          setFailure({ code: 'server-error', retryAfter: null })
        } finally {
          setSaving(false)
        }
      }

      // The Host caches only responses that match the expected shape, so a
      // snapshot either carries everything below or no balance at all.
      const ready = Boolean(data && data.balance)
      const usage = ready ? data.usage[range] : null
      const totals = ready ? usage.totals : null
      const groups = ready && Array.isArray(totals.groups) ? totals.groups : []
      const hasGroups = groups.length > 0
        || Boolean(totals && totals.remainder && totals.remainder.request_count > 0)

      return h('div', { className: 'ob-stage' },
        h('div', { className: 'ob-scroll' },
          h('div', { className: 'ob-wrap' },
            h('div', { className: 'ob-head' },
              h('div', null,
                h('div', { className: 'ob-title' }, t.title),
                h('div', { className: 'ob-sub' }, t.subtitle),
              ),
            ),

            ready
              ? h(BalanceCard, { balance: data.balance, t })
              : h('div', { className: 'ob-card' },
                  h('div', { className: 'ob-empty' }, t.empty)),

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
        ),

        h(KeyBar, {
          open,
          saving,
          failure,
          t,
          floatOpen: float.open,
          onToggleFloat: () => floatStore.set({ open: !float.open }),
          onToggle: () => {
            setOpen(!open)
            setFailure(null)
          },
          onSubmit: submitKey,
          onClose: () => {
            setOpen(false)
            setFailure(null)
          },
        }),
      )
    }

    // ── styles ──────────────────────────────────────────────────────────────

    const CSS = `
      .ob-stage { position: relative; height: 100%; overflow: hidden; }
      .ob-scroll { height: 100%; overflow: auto; padding: 28px 32px 56px; box-sizing: border-box; }
      /* Right edge of the 1040px content column, not the viewport edge:
         right = wrap edge = 50% - (1040 / 2 + 0) once the column stops growing. */
      .ob-keybar {
        position: absolute; top: 24px; right: max(32px, calc(50% - 520px)); z-index: 3;
        display: flex; align-items: center; gap: 10px;
      }
      .ob-keyform {
        display: flex; align-items: center; gap: 8px;
        width: 0; opacity: 0; overflow: hidden;
        transition: width .28s cubic-bezier(.4, 0, .2, 1), opacity .2s ease;
      }
      .ob-keyform-open { width: 332px; opacity: 1; }
      .ob-input {
        flex: 1 1 auto; min-width: 0; height: 34px; padding: 0 10px;
        font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; outline: none;
      }
      .ob-input:focus { border-color: var(--dsw-alias-border-l2); }
      .ob-key, .ob-key-ok, .ob-key-x {
        flex: 0 0 auto; height: 34px; border-radius: 8px; cursor: pointer; font: inherit;
        background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-primary);
        transition: background .12s ease, border-color .12s ease, opacity .12s ease;
      }
      /* A slow cyan breath: findable at a glance, quiet enough to ignore. */
      .ob-key {
        width: 34px; display: flex; align-items: center; justify-content: center;
        opacity: .85; --ob-glow: 56, 189, 248;
        animation: ob-breathe 2.6s ease-in-out infinite;
      }
      @keyframes ob-breathe {
        0%, 100% { border-color: var(--dsw-alias-border-l1); box-shadow: 0 0 0 0 rgba(var(--ob-glow), 0); }
        50% {
          border-color: rgba(var(--ob-glow), .7);
          box-shadow: 0 0 0 3px rgba(var(--ob-glow), .10), 0 0 12px 2px rgba(var(--ob-glow), .28);
        }
      }
      @media (prefers-reduced-motion: reduce) { .ob-key { animation: none; } }
      .ob-key:hover, .ob-key-ok:hover, .ob-key-x:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
      .ob-key:hover { opacity: 1; }
      .ob-key-ok, .ob-key-x { width: 34px; font-size: 14px; line-height: 1; }
      .ob-key-ok:disabled { opacity: .4; cursor: default; }
      .ob-key.is-on { opacity: 1; border-color: var(--dsw-alias-brand-primary); }

      .ob-float {
        position: fixed; z-index: 40; width: 40px; height: 40px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        box-shadow: 0 6px 18px rgb(0 0 0 / .28);
        cursor: grab; touch-action: none; user-select: none;
      }
      .ob-float:active { cursor: grabbing; }
      /* No usable data: the ring is drained and everything fades to grey. */
      .ob-float.is-empty { opacity: .55; }
      .ob-float-tip {
        position: absolute; bottom: calc(100% + 8px); right: 0; pointer-events: none;
        display: flex; flex-direction: column; gap: 3px; align-items: flex-end;
        padding: 8px 10px; border-radius: 8px; white-space: nowrap;
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        opacity: 0; transform: translateY(2px);
        transition: opacity .12s ease, transform .12s ease;
      }
      .ob-float:hover .ob-float-tip { opacity: 1; transform: translateY(0); }
      .ob-float-line { font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .ob-float-line.strong {
        font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary);
        font-variant-numeric: tabular-nums;
      }
      .ob-float.is-empty svg circle:first-child { stroke: var(--dsw-alias-state-idle-primary); }
      .ob-keymsg {
        position: absolute; top: 42px; right: 0; max-width: 380px; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; text-align: right;
        font-size: 11px; color: var(--dsw-alias-state-error-primary);
      }
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
          label: () => stringsFor().nav,
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Page))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'ollama-board-float',
          order: 60,
        }, FloatWindow))
      },
    }
  },
})
