const fs = require('fs');
const path = require('path');

const connectionString = process.env.ANYPOINT_MONITOR_APPINSIGHTS_CONNECTION_STRING;

if (!connectionString) {
    console.error('Missing ANYPOINT_MONITOR_APPINSIGHTS_CONNECTION_STRING. Aborting telemetry injection.');
    process.exit(1);
}

const escaped = connectionString.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
const targetPath = path.join(__dirname, '..', 'src', 'services', 'telemetryConfig.ts');
const contents = `export const TELEMETRY_CONNECTION_STRING = '${escaped}';\n`;

fs.writeFileSync(targetPath, contents, 'utf8');
console.log('Injected Application Insights connection string into telemetryConfig.ts');
