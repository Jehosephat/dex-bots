# Jupiter Ultra Swap API Setup

## Overview

Jupiter's Ultra Swap API provides:
- ✅ **Dynamic rate limits** that scale with your swap volume
- ✅ **No Pro plans or payment required** - just need a free API key
- ✅ **Better rate limits** than v1 API
- ✅ **Automatic fallback** to v1 API if Ultra Swap fails

## Benefits

1. **Dynamic Rate Limits**: Rate limits automatically increase as your swap volume grows
2. **No Cost**: Free API key from Jupiter Portal
3. **Better Reliability**: Less likely to hit rate limits compared to v1 API
4. **Backward Compatible**: Falls back to v1 API automatically if Ultra Swap fails

## Setup Instructions

### 1. Get Your API Key

1. Visit [Jupiter Portal](https://portal.jup.ag/)
2. Sign up or log in
3. Generate a universal API key (works for all Jupiter APIs)
4. Copy your API key

### 2. Configure Environment Variables

Add these to your `.env` file:

```bash
# Enable Jupiter Ultra Swap API
USE_JUPITER_ULTRA=true

# Your Jupiter API key (get from https://portal.jup.ag/)
JUPITER_ULTRA_API_KEY=your_api_key_here
```

### 3. Restart the Bot

After adding the environment variables, restart the bot. You should see:

```
✅ Jupiter Ultra Swap API enabled (dynamic rate limits)
✅ Jupiter Ultra Swap API key configured
```

## How It Works

1. **Quote Requests**: When enabled, the bot tries Ultra Swap API first for quotes
2. **Automatic Fallback**: If Ultra Swap fails, it automatically falls back to v1 API
3. **Rate Limits**: Rate limits scale with your swap volume automatically
4. **No Changes Needed**: Works with existing code - just enable via environment variable

## Rate Limits

- **Without API Key**: Base rate limits (similar to v1)
- **With API Key**: Dynamic rate limits that scale with swap volume
- **No Payment Required**: Free API key provides dynamic scaling

## Troubleshooting

### Ultra Swap API Not Working

If you see warnings like:
```
⚠️ Ultra Swap API failed, falling back to v1 API
```

The bot will automatically use v1 API as fallback. Check:
1. API key is correct in `.env`
2. `USE_JUPITER_ULTRA=true` is set
3. Network connectivity to `api.jup.ag`

### Rate Limits Still Hitting

Even with Ultra Swap, you may still hit rate limits if:
- You're making too many requests too quickly
- Your swap volume hasn't grown yet (rate limits scale with volume)

**Solutions:**
- Increase `strategyEvaluationDelayMs` in config
- Reduce number of strategies evaluated
- Wait for swap volume to grow (rate limits increase automatically)

## Comparison

| Feature | v1 API | Ultra Swap API |
|---------|--------|----------------|
| Rate Limits | Fixed (60 req/min) | Dynamic (scales with volume) |
| Cost | Free | Free |
| API Key Required | No | Yes (for better limits) |
| Fallback Support | N/A | ✅ Automatic |
| Setup Complexity | None | Low (just add API key) |

## Documentation

- [Jupiter Ultra Swap Docs](https://dev.jup.ag/docs/ultra/get-started)
- [Jupiter Portal](https://portal.jup.ag/)
- [Rate Limit Details](https://dev.jup.ag/docs/ultra/rate-limit)

