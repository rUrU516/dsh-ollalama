# dsh-ollalama

在 DSH（DeepSeek Harness）上做 **Ollama Cloud** 相关插件的工作区。

## 用户意图

用户想先摸清 ollama.com 的订阅 / API 端点，再基于此做若干「简单的插件」（DSH 插件）。
用户提供了一把测试 key（已存 `.env.local`，见下）。

## 阅读顺序

| 想干什么 | 读哪个 |
| --- | --- |
| 查 Ollama Cloud 有哪些端点、返回什么、限额多少 | `context-ollama-cloud-api.md` |
| 做/改 DSH 插件（bundle 结构、安装、slot） | `context-plugins.md` |
| 项目里有什么文件 | 本文件下方「文件」 |

## 文件

```
agent-context/            影子上下文（本目录）
plugins/ollama-board/     看板插件（Host + Client 双半）
scripts/harness.mjs       脱离 DSH 验证 Host 半的脚本
research/ollama-openapi.yaml   Ollama 官方 OpenAPI（/api/* 原生端点，云端版）
.env.local                OLLAMA_API_KEY（含真实 key，勿提交/勿外传）
.gitignore
```

## 已定 / 未定

- 已定：Ollama Cloud 的 key 走 `Authorization: Bearer`，原生端点在 `https://ollama.com/api`，
  OpenAI 兼容在 `/v1`，Anthropic 兼容在 `/v1/messages`。已实测可用。
- 未定：具体要做哪几个插件（2026-11-11 待用户拍板）。
