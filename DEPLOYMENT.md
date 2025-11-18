# Deployment Guide - Slack Webhook Configuration

## Overview
The Slack webhook URL for feedback is stored securely using Base64 obfuscation in the codebase. While not cryptographically secure, this prevents casual scanning and keeps the webhook functional.

## Current Implementation

The webhook URL is stored in `src/config/webhook.config.ts` as a Base64-encoded string.

### Your Current Webhook (Already Configured)

The webhook URL is already Base64-encoded and included in `src/config/webhook.config.ts`.

## How to Update the Webhook URL

### Method 1: Using Base64 Encoding (Quick)

1. Encode your new webhook URL:
   ```bash
   echo -n 'YOUR_NEW_WEBHOOK_URL' | base64
   ```

2. Update `src/config/webhook.config.ts`:
   ```typescript
   const obfuscatedWebhook = 'YOUR_BASE64_ENCODED_STRING';
   ```

3. Rebuild:
   ```bash
   npm run compile
   ```

### Method 2: Using Environment Variables (Recommended for CI/CD)

1. Set environment variable before building:
   ```bash
   export SLACK_WEBHOOK_URL='https://hooks.slack.com/services/...'
   npm run compile
   ```

2. The code will automatically use the environment variable if available.

## Security Best Practices

### ⚠️ Current Approach: Obfuscation (Low Security)
- **Pros**: Simple, no external dependencies, works offline
- **Cons**: Can be decoded by anyone with access to the code
- **Good for**: Low-risk scenarios, open-source projects

### ✅ Recommended: Use a Proxy Server (High Security)

Create a simple serverless function that proxies requests to Slack:

#### Example using Cloudflare Workers (Free):

```javascript
// deploy to workers.cloudflare.com
export default {
  async fetch(request) {
    // Store your actual webhook URL in Cloudflare Worker environment variables
    const SLACK_WEBHOOK = env.SLACK_WEBHOOK_URL;

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.json();

    const response = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    return new Response('OK', { status: 200 });
  }
}
```

Then update `src/config/webhook.config.ts`:
```typescript
export function getSlackWebhookUrl(): string {
    return 'https://your-worker.YOUR_SUBDOMAIN.workers.dev';
}
```

Benefits:
- ✅ Webhook URL never exposed in code
- ✅ Can add rate limiting
- ✅ Can rotate webhook without rebuilding extension
- ✅ Can add authentication if needed

## Publishing to VS Code Marketplace

When publishing, the obfuscated webhook will be included in the extension package. This is acceptable for low-risk scenarios but consider using a proxy for production.

```bash
npm run deploy
```

## Testing the Feedback Feature

1. Open VSCode with your extension
2. Run command: `AM: Provide Feedback`
3. Fill out the feedback form
4. Check your Slack channel for the message

## Rotating the Webhook

If you need to rotate the webhook (e.g., if it's compromised):

1. Create a new webhook in Slack
2. Encode it with Base64
3. Update `src/config/webhook.config.ts`
4. Rebuild and republish the extension
5. Optionally: create a new version to force updates

## Questions?

Contact: yucel.moran@gmail.com
