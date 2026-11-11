# DSH 插件：ollama-board

## 现状（2026-11-11）

已安装到 profile `desktop`，**待重启生效**（`install_bundle` 返回 `restart-required`，
运行中的进程还没加载新的 Host 半，所以 `/ollama-board/snapshot` 目前 404）。

**数据形状的权威说明在 `plugins/ollama-board/README.md`**（字段语义、消费方式、两条失败路径、
已知限制）。下面只记决策和坑，不重复字段表。

## 交付物

```
plugins/ollama-board/
├── index.js           Host 半：持有 key、拉 ollama.com、注册两个路由
├── client.js          浏览器半：侧栏图标 + 看板页
├── cordis.patch.yml   bundle 行（含 config，key 在这里）
├── package.json       dsh.client 声明
├── README.md          数据契约 + 使用说明（对外权威）
├── locale/{zh,en}.json  Plugin Manager 里显示的标题/描述
└── icon.svg
scripts/harness.mjs    脱离 DSH 跑 Host 半的自测脚本
```

## 架构（为什么这样切）

Host 与 Client 之间**没有可用的通用 RPC**：`host.call` / `harness.handle` 只属于
cordis 动态包（`cordis_define`），`ctx.remote.*` 是构建期生成的，普通 bundle 拿不到。
所以走 **HTTP 路由**：

| 路由 | 行为 |
| --- | --- |
| `GET /ollama-board/snapshot` | 只读内存快照，从不回源（回源只由节拍驱动） |

只有这一个路由。用户没有手动刷新入口（2026-11-11 明确要求「简洁为主，不给用户刷新功能」），
`/refresh` 路由和 `minRefreshMs` 已删除。

**Host 极简形态（2026-11-11 重写，151 行 → 86 行；加形状闸门后 110 行）**

一个变量存最近一次成功结果；`setInterval` 每 60s 拉一次（4 个请求**并行**，各自
20s 超时）；成功就整份替换，失败就原样保留只记 `error`。

- **没有重试**。失败后下一拍再来，节拍本身就是重试策略。
- **没有单飞锁**。超时 20s << 节拍 60s，两轮物理上不可能重叠。
- **没有 429 冷却**。被限流就当作一次普通失败，下一拍照撞。
- 4 个请求是一个整体：任一失败本轮作废，不写一半进去。
- 节拍从插件激活时刻起算，**不对齐墙钟**（对齐是为了和前端读时机配合，代价超过收益）。

**两条失败路径（2026-11-11，用户定稿）**：

| 情况 | 处理 | 理由 |
| --- | --- | --- |
| **没拿到**（超时 / 网络错 / 非 200） | 保留上一份数据，只记 `error` | 暂时性故障，旧数据仍是最佳信息 |
| **拿到了但形状不符**（`isExpected()` 否） | **清空缓存**（balance=null、usage={}、fetchedAt=null）+ 记 error | 我们对接口的假设已失效，继续展示旧数字等于拿猜测当现状 |

前端因此只面对**一种**形状 + 一个空态，不存在"兼容旧格式"的渲染分支。

验证：`scripts/harness-clear.mjs`（mock 上游第一拍返回合法、第二拍返回垃圾，
断言第一拍被缓存、第二拍被清空）。约 65 秒，因为它等第二拍。

payload：`{ balance, usage, fetchedAt, error, configured, stale }`。
`stale` = 距上次成功超过 2 拍（说明漏了一拍），由 Host 在响应时算。

**Client 半（2026-11-11 定稿，10 行）**：进入看板页读一次（t=0 那一拍），之后固定
每 10 秒无条件读一次本地缓存（1ms，不触上游）；离开看板页组件卸载、定时器清掉。

渲染只认一种形状：`ready = data && data.balance`。ready 就直接取字段（不再 `|| {}`、
不再 `Number() || 0`），不 ready 就只画一张「暂时拿不到数据」的卡片。
旧套餐（`included.session/weekly`）分支、`retryAt` 死代码、未使用文案已全部删除。

没有 `document.hidden` 判断、没有 `visibilitychange` 监听、没有和 Host 对表 ——
和 Host 完全同构：一个动作 + 一个定时器。只保证「Host 写完后 10 秒内上屏」。

页脚「更新于 Xs 前」由前端每秒用 `fetchedAt` 现算（1s ticker 只在页脚小组件里，
不重绘图表和表格）；「数据陈旧」用 Host 给的 `stale`，避免用实时年龄比阈值导致每拍闪烁。

## 槽位

- `sidebar.panellist`，id = `ollama-board` —— 侧栏图标（`{size, active}` props）
- `main`，key = `ollama-board` —— 看板页（侧栏按钮按 id 派发到同名 key）

## 已知取舍

- **key 明文在 `cordis.patch.yml`**，安装后也会进
  `~/.dsh/profiles/desktop/cordis.patch.yml`。没用 `ctx.credentials` 是因为
  没有配套的设置界面来录入，v1 先用 config 字段。
- 没有 `Config` schema（不依赖 schemastery），config 字段不做校验。
- 时区：桶边界是 UTC，前端用本地时间渲染。
