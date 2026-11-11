# Ollama Cloud API（2026-11-11 实测）

来源：<https://docs.ollama.com/api/>（`llms.txt` 索引）、`research/ollama-openapi.yaml`（官方 spec），
其余为 **本机用测试 key 实打实 curl 出来的结果**，标注了 HTTP 码。

## 基本形态

| 项 | 值 |
| --- | --- |
| 原生端点 | `https://ollama.com/api/*` |
| OpenAI 兼容 | `https://ollama.com/v1`（`/v1/chat/completions`、`/v1/models`、`/v1/responses`） |
| Anthropic 兼容 | `https://ollama.com/v1/messages` |
| 认证 | `Authorization: Bearer <key>`；Anthropic 端点也**只认** Bearer，`x-api-key` 单独不行 |
| 本地服务 | `http://localhost:11434` 不需要 key（云端模型需 `ollama signin`） |
| key 有效期 | 不过期，`https://ollama.com/settings/keys` 可吊销 |

错误格式统一是 `{"error": "..."}`（网关层 401 是 `{"error": "invalid credentials"}`）。

## 实测端点清单

### 推理

| 端点 | 方法 | 实测 | 说明 |
| --- | --- | --- | --- |
| `/api/generate` | POST | 文档有（未单独测） | 单轮补全 + 计时/usage 字段 |
| `/api/chat` | POST | **200** | 原生 chat，带 `total_duration`/`eval_count`/`prompt_eval_cached_count` |
| `/v1/chat/completions` | POST | **200** | OpenAI 格式，`usage.prompt_tokens_details.cached_tokens` |
| `/v1/responses` | POST | **200** | 无状态 Responses；云端**不支持**有状态、内置 web search、custom tool replay |
| `/v1/messages` | POST | **200** | Anthropic 格式，`anthropic-version` 头 |
| `/api/embed` | POST | **401** | 云端对这把 key 返回 `unauthorized`，推测云端不开放 embeddings（需再验证） |
| `/v1/embeddings` | POST | **404** | 路由不存在 |
| `/v1/systemone` | POST | 文档有（未测） | 决策/是否/打分模型，v0.35+/云端 v0.40.5+ |

### 模型目录

| 端点 | 实测 | 说明 |
| --- | --- | --- |
| `GET /api/tags` | **200** | 云端可用模型 + `capabilities`（completion/thinking/tools/vision/decision） |
| `GET /v1/models` | **200** | OpenAI 列表格式 `{object:"list",data:[{id,...}]}` |
| `GET /v1/models/{id}` | **200** | 单个模型 |
| `POST /api/show` | **200** | `capabilities`、`model_info`（context_length 等）、`thinking.default` |
| `GET /api/ps` | **401** | 本地运行时概念，云端不适用 |

管理类（`/api/create` `/api/copy` `/api/push` `/api/pull` `/api/delete` `/api/blobs/{digest}`）
是本地/发布用途，云端直接用会失败，插件里不用碰。

### 账户 / 计费 ★（做面板就靠这两个）

`GET /api/usage?range=24h|7d|30d&scope=self|team&group_by=model`

```json
{"range":"7d","scope":"self","granularity":"day","from":"...","until":"...",
 "totals":{"request_count":6,"usage_usd":0.00681,"input_tokens":73755,
           "cached_input_tokens":56704,"output_tokens":1092},
 "buckets":[{"from":"...","until":"...","request_count":0,"usage_usd":0,...,"partial":true}]}
```

- `group_by=model` 时 `totals` 与每个 bucket 里多出 `groups[]`（最多 10 组，按 `usage_usd` 排序），
  溢出部分合并在 `remainder`。
- `24h`→按小时 25 桶；`7d`→8 桶；`30d`→31 桶。`partial:true` 表示当前桶未走完。
- 时间是 UTC，`from` 含、`until` 不含。

`GET /api/balance`

```json
{"included":{"balance_usd":59.99065,"allowance_usd":60,
             "period":{"from":"2026-11-11T14:32:44Z","until":"2026-12-11T14:32:44Z"}},
 "purchased":{"balance_usd":0}}
```

- 旧套餐会返回 `included.session` / `included.weekly`（`remaining_percent` + `resets_at`），
  做 UI 要兼容两种形状。
- 团队：所有人共享同一份 included/purchased 余额。

**限流**：`usage` 和 `balance` 都是 **10 次/分钟/用户**，跨所有 key 和设备共享，官方建议 1 次/分钟轮询；
429 带 `Retry-After` 头。→ 插件必须做缓存，不能每次渲染都打。

## 账号现状（2026-11-11 22:43 UTC+8 采样）

- balance：included 60 USD，已用 ~0.01，purchased 0；周期 11-11 → 12-11。
- 24h 用量：14 次请求 / $0.0154，其中 `deepseek-v4.1-flash:1017` 12 次（231k in / 200k cached / 3.8k out），
  `gemma4:31b` 2 次。→ 说明这把 key 或同账号已被用来跑 dsh/agent 类负载（未核实是谁跑的）。

## 模型（`/api/tags` 实测，24 个）

kimi-k3, kimi-k3.1-pro, kimi-k2.6, kimi-k2.7-code, nemotron-3-ultra, nemotron-3-super,
deepseek-v4.1-flash(+:1017), deepseek-v4-pro:0813, glm-5.3, glm-5.3-flash, glm-5.2,
minimax-m3, minimax-m3.1-flash, mimo-v2.6-pro, mimo-v2.6-flash, mistral-large-4,
gpt-oss:20b, gpt-oss:120b, gemma4:31b, clef:27b, beam, muse-spark-open。

注意 `:cloud` 后缀是**本地** ollama 指向云端的写法（`gpt-oss:120b-cloud`）；直连 `ollama.com` 时用不带后缀的名字。

## 可复用片段

```bash
set -a; . ./.env.local; set +a
curl -sS https://ollama.com/api/balance -H "Authorization: Bearer $OLLAMA_API_KEY"
curl -sS 'https://ollama.com/api/usage?range=24h&group_by=model' -H "Authorization: Bearer $OLLAMA_API_KEY"
```

---

## 附：余额 / 用量的语义与坑（2026-11-11 实测）

### balance 的两个钱包

- `included` = 订阅额度，按**订阅日起算的一个月**重置（不是自然月；年付也按月滚）。
- `purchased` = 单独充值的 credits，不随周期重置，只统计未过期部分。
- 旧套餐是 `oneOf`：返回 `included.session` / `weekly`（`remaining_percent` 0–100 + `resets_at`），
  没有 `balance_usd`。UI 必须两种形状都兼容。
- 团队共享同一份 included / purchased。
- 403（封号）和 503（计费系统不可用）**不能当成余额为 0**。

### usage 的窗口语义

- `24h`：当前 UTC 小时整点往回 24 小时，小时桶 ×25
- `7d` / `30d`：从 7 / 30 天前的 **00:00 UTC** 起，天桶 ×8 / ×31
- 每个桶 `from` 含、`until` 不含；最后一个桶带 `partial: true`；零值桶也返回
- 同一 `range` 在不同时刻查询，起点会跳变（对齐零点）

### 字段关系

- `usage_usd` = 请求价值，含套餐覆盖部分 + 充值支付部分，不是"额外付费"
- `input_tokens` **已包含** `cached_input_tokens`；两者不能相加
- `group_by=model` → 最多 10 组，按 `usage_usd` 排序，溢出进 `remainder`；
  老套餐无金额时自动改为按 `request_count` 排序并只给请求数

### 恒等式（可校验）

`included.allowance_usd − included.balance_usd` == 本周期 `usage_usd`。
实测：`60 − 59.97138 = 0.02862` == usage 的 `0.02862` ✅
但两者窗口不同（订阅周期 vs 滚动窗口），仅在周期起点落在 usage 窗口内时相等。

### 数据是最终一致的，延迟分钟级

| 时刻 (UTC) | 查询 | 结果 |
| --- | --- | --- |
| 14:43:05 | 7d | 6 次 / $0.00681 |
| 14:43:40 | 24h | 14 次 / $0.01540 |
| 14:47:20 | 7d & 24h | 均 22 次 / $0.02551 |
| 14:48:05 | 30d | 24 次 / $0.02862 |

先出现的 `7d < 24h` 物理上不可能 → 记账滞后。**不能做"实时花费"**。

### 限流预算

- `usage` 与 `balance` 各自「10 次/分钟/用户」，跨所有 key 与设备共享（官方建议 1 次/分钟）。
  两者是否共享同一个 10 次配额文档未明确 → 按共享的保守假设设计。
- 429 带 `Retry-After`，必须照做退避。
