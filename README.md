---

<img width="400" height="200" alt="4ca65f573c3d7b3dec0cd829d86262f6" src="https://github.com/user-attachments/assets/9fcffadc-2b95-411d-b778-bf33809f7ef7" />

感谢 [Claude API](https://www.claudeapi.com?source=claudeworkerproxy) 赞助本项目！Claude API 是专注 Claude 模型的官方渠道 API 服务商，基于 Anthropic 官方 Key 与 AWS Bedrock 官方渠道，提供稳定的 Claude Code 与 Agent 应用接入体验，支持 Claude 全系列模型，保留 Tool Use、长上下文等官方能力。服务非逆向、非降智，适合 Claude Code 深度用户、Agent 工程师与企业技术团队使用。通过[专属链接](https://www.claudeapi.com?source=claudeworkerproxy)注册后联系客服，可领取免费测试额度，并支持开票和团队对接。

<img width="400" height="200" alt="33f1d0d49cce103272da3821f66a2820" src="https://github.com/user-attachments/assets/fd909546-1544-4b7d-a7c1-67244d729e4f" />

本项目由 [code0.ai](https://code0.ai?source=claudeworkerproxy) 赞助 —— 一站接入 gpt-image / Gemini / Claude 等主流 AI 模型，稳定不掉线，按量计费即充即用，专为 AI 创作者打造。注册后联系客服可免费领取测试额度，支持企业对接及开票。

---

把各家（Gemini，OpenAI）的模型 API 转换成 Claude 格式提供服务

## 特性

- 🚀 一键部署到 Cloudflare Workers
- 🔄 兼容 Claude Code。配合 [One-Balance](https://github.com/glidea/one-balance) 低成本，0 费用使用 Claude Code
- 📡 支持流式和非流式响应
- 🛠️ 支持工具调用
- 🎯 零配置，开箱即用

## 快速部署

```bash
git clone https://github.com/glidea/claude-worker-proxy
cd claude-worker-proxy
npm install
wrangler login # 如果尚未安装：npm i -g wrangler@latest
npm run deploycf
```

## 使用方法

```bash
# 例子：以 Claude 格式请求 Gemini 后端
curl -X POST https://claude-worker-proxy.xxxx.workers.dev/gemini/https://generativelanguage.googleapis.com/v1beta/v1/messages \
  -H "x-api-key: YOUR_GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

### 参数说明

- URL 格式：`{worker_url}/{type}/{provider_url_with_version}/v1/messages`
- `type`: 目标厂商类型，目前支持 `gemini`, `openai`
- `provider_url_with_version`: 目标厂商 API 基础地址
- `x-api-key`: 目标厂商的 API Key

### 在 Claude Code 中使用

```bash
# 编辑 ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://claude-worker-proxy.xxxx.workers.dev/gemini/https://xxx.com/v1beta", # https://xxx.com/v1beta： 注意带版本号；需要支持函数调用！
    "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: YOUR_KEY",
    "ANTHROPIC_MODEL": "gemini-2.5-pro", # 大模型，按需修改
    "ANTHROPIC_SMALL_FAST_MODEL": "gemini-2.5-flash", # 小模型。也许你并不需要 ccr 那么强大的 route
    "API_TIMEOUT_MS": "600000"
  }
}

claude
```


---

<table>
  <tr>
    <td align="center">
      <img src="https://github.com/glidea/zenfeed/blob/main/docs/images/wechat.png?raw=true" alt="Wechat QR Code" width="300">
      <br>
      <strong>AI 学习交流社群</strong>
    </td>
    <td align="center">
      <img src="https://github.com/glidea/banana-prompt-quicker/blob/main/images/glidea.png?raw=true" width="250">
      <br>
      <strong><a href="https://glidea.zenfeed.xyz/">我的其它项目</a></strong>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="https://github.com/glidea/banana-prompt-quicker/blob/main/images/readnote.png?raw=true" width="400">
      <br>
      <strong><a href="https://www.xiaohongshu.com/user/profile/5f7dc54d0000000001004afb">📕 小红书账号 - 持续分享 AI 原创</a></strong>
    </td>
  </tr>
</table>
