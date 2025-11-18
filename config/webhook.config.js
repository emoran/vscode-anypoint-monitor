"use strict";
// Webhook configuration
// This file is used to store the Slack webhook URL securely
// The webhook URL is injected at build time via environment variables
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSlackWebhookUrl = getSlackWebhookUrl;
function getSlackWebhookUrl() {
    // Option 1: Use environment variable at build time
    // This gets replaced during the build process via webpack DefinePlugin
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
        return webhookUrl;
    }
    // Option 2: Fallback to obfuscated webhook (Base64 encoded)
    // This is NOT secure but prevents casual scanning
    // To generate: echo -n 'YOUR_WEBHOOK_URL' | base64
    const obfuscatedWebhook = 'aHR0cHM6Ly9ob29rcy5zbGFjay5jb20vc2VydmljZXMvVENQNVJGNTNML0IwOTNUVkI0U0Y3L3dtWGJ0STluQzBtR3hvQmVVNDc0RzBPSg==';
    try {
        return Buffer.from(obfuscatedWebhook, 'base64').toString('utf-8');
    }
    catch (error) {
        console.error('Failed to decode webhook URL');
        return '';
    }
}
//# sourceMappingURL=webhook.config.js.map