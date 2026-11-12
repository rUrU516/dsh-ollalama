# dsh-ollalama

DSH 插件：把 Ollama Cloud 的余额和三档用量做成一个看板页。

- Host 半（`index.js`）：持有 API key，每分钟拉一次 ollama.com，对外只提供一个**只读**快照路由。
- Client 半（`client.js`）：侧栏图标 + 看板页，每 10 秒读一次那份快照。

```
ollama.com ──每 60s──▶ Host 内存快照 ──GET /ollama-board/snapshot──▶ 浏览器（每 10s）
```

## 数据形状（契约）

这是唯一的对外形状。任何消费者（看板、将来的悬浮窗……）只认这一种，**不存在兼容分支**。

```js
{
  balance: {
    included: { balance_usd, allowance_usd, period: { from, until } },
    purchased: { balance_usd },
  },
  usage: {
    '24h' | '7d' | '30d': {
      granularity: 'hour' | 'day',
      totals: {
        usage_usd, request_count, input_tokens, cached_input_tokens, output_tokens,
        groups?: [{ model, request_count, usage_usd, input_tokens, cached_input_tokens, output_tokens }],
        remainder?: { 同 group 字段 },
      },
      buckets: [{ from, until, partial?, usage_usd, request_count,
                  input_tokens, cached_input_tokens, output_tokens }],
    },
  },
  fetchedAt: number | null,
}
```

### 字段语义

| 字段 | 含义 |
| --- | --- |
| `included.balance_usd` | 订阅额度剩余（按周期重置） |
| `included.allowance_usd` | 本期订阅总额度 |
| `included.period` | 本期起止，UTC，`from` 含、`until` 不含 |
| `purchased.balance_usd` | 单独购买的 credits 余额，不随周期重置，只算未过期的 |
| `totals.usage_usd` | 本档位请求的价值，**包含订阅覆盖的和充值支付的** |
| `totals.input_tokens` | 输入 token，**已包含** `cached_input_tokens`，不要相加 |
| `totals.groups` | `group_by=model` 的拆分，最多 10 个，按金额排序 |
| `totals.remainder` | 第 11 名往后的合并，可能不存在 |
| `buckets[]` | 时间桶；`24h` 25 个小时桶，`7d` 8 个、`30d` 31 个天桶 |
| `buckets[].partial` | 存在且为 true 表示这一小时/天还没走完 |
| `fetchedAt` | **最后一次成功拉取**的时刻（毫秒）。失败不更新 |

快照里**只有数据，没有错误、没有状态标记**。某一拍失败就是失败：上一份数字留着，
浏览器用 `fetchedAt` 自己算出它们的真实年龄。
错误码只出现在 `POST /key` 的回答里 —— 那是对用户刚做动作的直接回应。

两个容易搞错的地方：

1. **`allowance_usd − balance_usd` 只反映订阅额度的消耗**，不含 `purchased` 的消耗；而 `totals.usage_usd` 是两者合计。所以 purchased 被消耗过时，这两个数对不上是正常的。
2. **`input_tokens` 已经包含 `cached_input_tokens`**，缓存命中率是 `cached / input`，不是 `cached / (input + cached)`。

## 消费方式

```js
const snapshot = await (await fetch('/ollama-board/snapshot')).json()
const ready = snapshot.balance !== null
```

**只有两个分支**：`ready` 就直接取字段；不 ready 就显示"拿不到数据"。不要写 `|| {}`、`Number(x) || 0` 这类兜底 —— Host 已经保证形状了。

## 拉取策略

两种失败要分开处理，这是刻意的：

| 情况 | 处理 | 原因 |
| --- | --- | --- |
| **没拿到**（超时 / 网络错 / 非 200） | 保留上一份数据，只记 `error` | 暂时性故障，旧数据仍是最佳信息 |
| **拿到了但形状不符** | **清空缓存**（`balance`/`fetchedAt` 置 null） | 我们对接口的假设作废了，继续展示旧数字等于把猜测当现状 |

- Host：`setInterval` 每 60 秒拉一次，4 个请求并行（balance + 3 档 usage），各自 20 秒超时。
  **没有重试** —— 下一拍就是重试；**没有单飞锁** —— 20s 超时远小于 60s 节拍，两轮不可能重叠。
- Client：进入看板页读一次（t=0），之后每 10 秒无条件读一次本地缓存；离开页面停。
  没有 `visibilitychange`、没有和 Host 对表。

## 配置 API key

面板右上角一个钥匙按钮（缓慢的青色呼吸光，方便定位）。点开 → 输入框**向左**展开，
`✓` 校验并保存，`×` 收起。

- 校验：Host 拿候选 key 打一次 `/api/balance`，通过才写入
- 存储：`~/.dsh/ollama-board.key`，权限 600；Host 每一拍读取，**换 key 不用重启**
- 手工写入也一样：`echo 'sk-...' > ~/.dsh/ollama-board.key`
- 删除 key：`rm ~/.dsh/ollama-board.key`

### 错误码

Host 只返回 code，文案由前端 `STRINGS.<locale>.errors` 映射。

| code | 含义 |
| --- | --- |
| `no-key` | 文件不存在或为空 |
| `empty` | 输入为空 |
| `unauthorized` | 401，key 被拒绝 |
| `forbidden` | 403，账号被限制 |
| `rate-limited` | 429，附 `retryAfter` 秒 |
| `server-error` | 其它非 2xx |
| `timeout` | 20 秒内没有应答 |
| `bad-shape` | 返回格式与预期不符 |

## 出错时提示在哪

- **保存失败** → 钥匙下方一行红字，输入框保留
- **后台拉取失败** → 不显示（快照里没有错误）；只看页脚的「更新于 Xm 前」
- **一条数据都没有** → 内容区只有一行「暂时拉不到数据」，其余照旧

## 已知限制

- ollama.com 的记账本身有 **1~3 分钟延迟**，所以页面上的数字最旧可能是几分钟前的账，和拉取频率无关。
- `/api/usage` 与 `/api/balance` 限流是**账号级 10 次/分钟**，跨所有 key 和设备共享；本插件稳态占 4 次/分钟。
- 形状闸门依赖 ollama.com 的返回格式，接口一变就会进入"拿不到"状态（这是期望行为，不是故障）。

## 自测脚本

```
node scripts/harness-render.mjs # 无浏览器渲染所有状态，捕捉渲染期异常（秒级）
node scripts/harness.mjs        # 真实上游，验证拉取与缓存
node scripts/harness-shape.mjs  # 假上游返回垃圾，验证形状闸门
node scripts/harness-clear.mjs  # 两拍：第一拍合法、第二拍垃圾，验证清空（约 65 秒）
```

改完 `client.js` 先跑 `harness-render.mjs` —— 它用一个小型 React 替身把 5 种状态
（24h/7d/30d/无数据/加载中）各渲染一遍，渲染期抛错会直接失败。
`DUMP=1` 可以打印渲染出的完整文本。