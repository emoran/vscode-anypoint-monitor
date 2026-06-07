const fs = require('fs');
const path = require('path');

const connectionString = process.env.ANYPOINT_MONITOR_APPINSIGHTS_CONNECTION_STRING;

const targetPath = path.join(__dirname, '..', 'src', 'services', 'telemetryConfig.ts');

if (!connectionString) {
    console.warn('Missing ANYPOINT_MONITOR_APPINSIGHTS_CONNECTION_STRING. Skipping telemetry injection (telemetry disabled for this build).');
    if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, "export const TELEMETRY_CONNECTION_STRING = '';\n", 'utf8');
        console.log('Created telemetryConfig.ts with empty connection string.');
    }
    process.exit(0);
}

const escaped = connectionString.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
const contents = `export const TELEMETRY_CONNECTION_STRING = '${escaped}';\n`;

fs.writeFileSync(targetPath, contents, 'utf8');
console.log('Injected Application Insights connection string into telemetryConfig.ts');
