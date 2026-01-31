const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'src', 'services', 'telemetryConfig.ts');
const contents = "export const TELEMETRY_CONNECTION_STRING = '';\n";

fs.writeFileSync(targetPath, contents, 'utf8');
console.log('Cleared Application Insights connection string from telemetryConfig.ts');
