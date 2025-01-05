import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Creates a webview panel and displays a table of applications.
 * @param context The extension context (used to create WebviewPanel, etc.)
 * @param data The data returned by your API call (response JSON).
 */
export function showApplicationsWebview(context: vscode.ExtensionContext, data: any) {
  // 1. Extract items from data
  const appsArray = Array.isArray(data.items) ? data.items : [];

  // 2. Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'applicationsView',
    'CloudHub 2.0 Applications',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // 3. Set the HTML content
  panel.webview.html = getApplicationsHtml(appsArray, panel.webview, context.extensionUri);

  // 4. Listen for messages (CSV export, etc.)
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'downloadCsv') {
      const csvData = generateCsvContent(appsArray);
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save Applications as CSV',
      });
      if (uri) {
        fs.writeFileSync(uri.fsPath, csvData, 'utf-8');
        vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
      }
    }
  });
}

/**
 * Helper to flatten a nested object into dot-notation keys.
 * e.g. { target: { provider: 'MC' } } -> { 'target.provider': 'MC' }
 */
function flattenObject(obj: any, parentKey = '', res: any = {}): any {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const newKey = parentKey ? `${parentKey}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, newKey, res);
    } else {
      res[newKey] = value;
    }
  }
  return res;
}

/**
 * Renders a cell value given the key + original value.
 * - Skips entire "id" column.
 * - If key ends with "Date", treat the numeric value as a timestamp in ms and format as YYYY-MM-DD.
 * - If key is "application.status", show a green or red icon depending on RUNNING vs STOPPED.
 */
function renderCell(key: string, value: any): string {
  if (key === 'id') {
    return ''; // We'll filter out the 'id' column altogether, but this is just a safeguard
  }

  // Format date fields (ends with "Date")
  if (key.match(/Date$/i)) {
    const ms = parseInt(value, 10);
    if (!isNaN(ms)) {
      const dateObj = new Date(ms);
      return dateObj.toISOString().split('T')[0]; // yyyy-mm-dd
    }
  }

  // Show icon for application.status
  if (key === 'application.status') {
    if (value === 'RUNNING') {
      return '🟢 RUNNING';
    } else if (value === 'STOPPED') {
      return '🔴 STOPPED';
    }
  }

  // Otherwise, just show the value
  return value ?? '';
}

/**
 * Generates HTML for the webview with a dynamic table that
 * shows all JSON attributes (flattened).
 */
function getApplicationsHtml(
  apps: any[],
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  // 1. Flatten each item, gather all keys
  const allKeys = new Set<string>();
  const flattenedApps = apps.map((app) => {
    const flat = flattenObject(app);
    Object.keys(flat).forEach((k) => allKeys.add(k));
    return flat;
  });

  // 2. Convert to array, remove "id", and sort
  let allKeysArray = Array.from(allKeys).filter((k) => k !== 'id');
  allKeysArray.sort();

  // 3. (Optional) Logo path
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // 4. Build the HTML
  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub 2.0 Applications</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
              Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
            color: #212529;
            background-color: #ffffff;
          }
          /* Navbar */
          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #1e1a41;
            padding: 0.75rem 1rem;
          }
          .navbar-left {
            display: flex;
            align-items: center;
            gap: 1rem;
          }
          .navbar-left img {
            height: 32px;
            width: auto;
          }
          .navbar-left h1 {
            color: #ffffff;
            font-size: 1.25rem;
            margin: 0;
          }
          .navbar-right {
            display: flex;
            gap: 1.5rem;
          }
          .navbar-right a {
            color: #ffffff;
            text-decoration: none;
            font-weight: 500;
            font-size: 0.9rem;
          }
          .navbar-right a:hover {
            text-decoration: underline;
          }

          /* Hero section */
          .hero {
            background: linear-gradient(90deg, #262158 0%, #463f96 50%, #5d54b5 100%);
            color: #ffffff;
            padding: 2rem 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .hero-text {
            max-width: 60%;
          }
          .hero-text h2 {
            font-size: 2rem;
            margin-bottom: 0.5rem;
          }
          .hero-text p {
            margin-bottom: 0;
            font-size: 1rem;
            line-height: 1.4;
          }

          /* Container */
          .container {
            max-width: 1100px;
            margin: 0 auto;
            padding: 1rem;
            background-color: #ffffff;
          }

          /* Title & button */
          .title-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 1rem 0;
          }
          .title-bar h3 {
            font-size: 1.25rem;
            margin: 0;
          }
          .button {
            padding: 10px 16px;
            font-size: 14px;
            color: #ffffff;
            background-color: #5b44c0;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
          }
          .button:hover {
            background-color: #49359a;
          }

          /* Scrollable table container */
          .table-container {
            width: 100%;
            overflow-x: auto;
            margin-bottom: 2rem;
          }
          /* Table */
          .app-table {
            border-collapse: collapse;
            background-color: #fff;
            box-shadow: 0 0 5px rgba(0,0,0,0.15);
            width: auto;
          }
          .app-table th,
          .app-table td {
            padding: 8px; /* reduce padding so content is more compact */
            border-bottom: 1px solid #e2e2e2;
            text-align: left;
            vertical-align: top;
            white-space: nowrap;
            /* MAKE FONT SMALLER */
            font-size: 0.81rem; 
          }
          .app-table th {
            background-color: #f4f4f4;
            font-weight: 600;
          }
          .app-table tr:hover {
            background-color: #f9f9f9;
          }
        </style>
      </head>
      <body>
        <!-- Navbar -->
        <nav class="navbar">
          <div class="navbar-left">
            <img src="${logoSrc}" />
            <h1 class="extension-name">Anypoint Monitor Extension</h1>
          </div>
          <div class="navbar-right">
            <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor">About</a>
            <a href="https://www.buymeacoffee.com/yucelmoran">Buy Me a Coffee</a>
          </div>
        </nav>

        <!-- Main container -->
        <div class="container">
          <div class="title-bar">
            <h4>CloudHub 2.0 Applications</h4>
            <button id="downloadCsv" class="button">Download as CSV</button>
          </div>

          <!-- Scrollable container for table -->
          <div class="table-container">
            <table class="app-table">
              <thead>
                <tr>
                  ${allKeysArray.map((key) => `<th>${key}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${flattenedApps
                  .map((flatApp) => {
                    // Build each row by iterating columns in sorted order
                    const rowCells = allKeysArray.map((key) => {
                      const originalValue = flatApp[key];
                      return `<td>${renderCell(key, originalValue)}</td>`;
                    });
                    return `<tr>${rowCells.join('')}</tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('downloadCsv').addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadCsv' });
          });
        </script>
      </body>
    </html>
  `;
}

/**
 * Generates CSV content (skips "id" column, formats date columns, etc.).
 */
function generateCsvContent(apps: any[]): string {
  // Flatten each app to get all keys
  const allKeys = new Set<string>();
  const flattenedApps = apps.map((app) => {
    const flat = flattenObject(app);
    Object.keys(flat).forEach((k) => allKeys.add(k));
    return flat;
  });

  // Remove "id" from columns & sort
  let allKeysArray = Array.from(allKeys).filter((k) => k !== 'id');
  allKeysArray.sort();

  // Build CSV header
  const headerRow = allKeysArray.join(',');

  // Convert each row
  const rows = flattenedApps.map((flatApp) => {
    return allKeysArray
      .map((key) => {
        let val = flatApp[key] !== undefined ? flatApp[key] : '';

        // If it's a date field (ends with "Date"), format as yyyy-mm-dd
        if (key.match(/Date$/i)) {
          const ms = parseInt(val, 10);
          if (!isNaN(ms)) {
            const dateObj = new Date(ms);
            val = dateObj.toISOString().split('T')[0];
          }
        }

        // If it's application.status, replace with 🟢 or 🔴
        if (key === 'application.status') {
          if (val === 'RUNNING') {
            val = '🟢 RUNNING';
          } else if (val === 'STOPPED') {
            val = '🔴 STOPPED';
          }
        }

        // CSV-escape (wrap in quotes, double internal quotes)
        const safe = String(val).replace(/"/g, '""');
        return `"${safe}"`;
      })
      .join(',');
  });

  // Join header + rows
  return [headerRow, ...rows].join('\n');
}