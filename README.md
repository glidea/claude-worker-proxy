Convert model APIs from various providers (Gemini, OpenAI) into Claude format and serve them

## Features

- 🚀 One-click deploy to Cloudflare Workers
- 🔄 Compatible with Claude Code. Pair with [One-Balance](https://github.com/glidea/one-balance) to use Claude Code at low cost or even free
- 📡 Supports both streaming and non-streaming responses
- 🛠️ Supports tool calling
- 🎯 Zero configuration, works out of the box

## Quick Deploy

```bash
git clone https://github.com/glidea/claude-worker-proxy
cd claude-worker-proxy
npm install
wrangler login # If not installed yet: npm i -g wrangler@latest
npm run deploycf
```

## Usage

```bash
# Example: Request Gemini backend in Claude format
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

### Parameter Reference

- URL format: `{worker_url}/{type}/{provider_url_with_version}/v1/messages`
- `type`: Target provider type — currently supports `gemini` and `openai`
- `provider_url_with_version`: Target provider's API base URL
- `x-api-key`: API key for the target provider

### Using with Claude Code

```bash
# Edit ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://claude-worker-proxy.xxxx.workers.dev/gemini/https://xxx.com/v1beta", # https://xxx.com/v1beta: note the version suffix; must support function calling!
    "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: YOUR_KEY",
    "ANTHROPIC_MODEL": "gemini-2.5-pro", # Large model, modify as needed
    "ANTHROPIC_SMALL_FAST_MODEL": "gemini-2.5-flash", # Small 
