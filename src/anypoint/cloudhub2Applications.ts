import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Creates a webview panel and displays a table of applications (CloudHub 2.0),
 * with the same dark, techy vibe as your previous design.
 */
export function showApplicationsWebview(context: vscode.ExtensionContext, data: any) {
  const appsArray = Array.isArray(data.items) ? data.items : [];

  // Create the webview panel
  const panel = vscode.window.createWebviewPanel(
    'applicationsView',
    'CloudHub 2.0 Applications',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Set the HTML content
  panel.webview.html = getApplicationsHtml(appsArray, panel.webview, context.extensionUri);

  // Listen for messages (CSV export, etc.)
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
 * Generates the HTML for the dark theme + tech vibe.
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

  // 3. URIs for resources
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // DataTables + jQuery
  const jqueryJs = 'https://code.jquery.com/jquery-3.6.0.min.js';
  const dataTableJs = 'https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js';
  const dataTableCss = 'https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css';

  // Google Fonts (Fira Code for the tech vibe)
  const googleFontLink = 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap';

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub 2.0 Applications</title>

        <!-- DataTables + Fira Code Font -->
        <link rel="stylesheet" href="${dataTableCss}" />
        <link rel="stylesheet" href="${googleFontLink}" />

        <style>
          /* Dark Theme + Tech Vibe */
          :root {
            --background-color: #0D1117;
            --card-color: #161B22;
            --text-color: #C9D1D9;
            --accent-color: #58A6FF;
            --navbar-color: #141A22;
            --navbar-text-color: #F0F6FC;
            --button-hover-color: #3186D1;
            --table-hover-color: #21262D;
          }

          body {
            margin: 0;
            padding: 0;
            background-color: var(--background-color);
            color: var(--text-color);
            font-family: 'Fira Code', monospace, sans-serif;
            font-size: 14px;
          }

          /* NAVBAR */
          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: var(--navbar-color);
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
            color: var(--navbar-text-color);
            font-size: 1.25rem;
            margin: 0;
          }
          .navbar-right {
            display: flex;
            gap: 1.5rem;
          }
          .navbar-right a {
            color: var(--navbar-text-color);
            text-decoration: none;
            font-weight: 500;
            font-size: 0.9rem;
          }
          .navbar-right a:hover {
            text-decoration: underline;
          }

          /* MAIN CONTAINER */
          .container {
            width: 90%;
            max-width: 1200px;
            margin: 1rem auto;
          }

          /* CARD */
          .card {
            background-color: var(--card-color);
            border: 1px solid #30363D;
            border-radius: 6px;
            padding: 1rem;
          }
          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1rem;
          }
          .card-header h2 {
            margin: 0;
            font-size: 1.25rem;
            color: var(--accent-color);
          }

          /* BUTTON */
          .button {
            padding: 6px 12px;
            font-size: 0.85rem;
            color: #ffffff;
            background-color: var(--accent-color);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
          }
          .button:hover {
            background-color: var(--button-hover-color);
          }

          /* TABLE + DATATABLES OVERRIDES */
          #appTable_wrapper .dataTables_length,
          #appTable_wrapper .dataTables_filter,
          #appTable_wrapper .dataTables_info,
          #appTable_wrapper .dataTables_paginate {
            margin: 0.5rem 0;
            font-size: 0.85rem;
            color: var(--text-color);
          }
          /* "Show X entries" label and dropdown */
          #appTable_length label {
            color: var(--text-color);
            font-weight: normal;
          }
          #appTable_length select {
            background-color: #121212;
            color: var(--text-color);
            border: 1px solid #30363D;
            border-radius: 4px;
            padding: 2px 8px;
            outline: none;
          }

          #appTable_wrapper input[type="search"] {
            background-color: #121212;
            color: var(--text-color);
            border: 1px solid #30363D;
          }
          #appTable thead {
            background-color: #21262D;
          }
          #appTable thead th {
            color: var(--accent-color);
            border-bottom: 1px solid #30363D;
            white-space: nowrap;
          }
          #appTable tbody tr {
            background-color: var(--card-color);
            border-bottom: 1px solid #30363D;
          }
          #appTable tbody tr:hover {
            background-color: var(--table-hover-color);
          }
          #appTable tbody td {
            color: var(--text-color);
            white-space: nowrap;
          }
          .dataTables_paginate .paginate_button {
            color: var(--accent-color) !important;
          }
          .dataTables_paginate .paginate_button.current {
            background: var(--accent-color) !important;
            color: #fff !important;
          }

          /* SCROLLABLE TABLE WRAPPER */
          .table-container {
            width: 100%;
            overflow-x: auto;
          }
        </style>
      </head>
      <body>
        <!-- NAVBAR -->
        <nav class="navbar">
          <div class="navbar-left">
            <img src="${logoSrc}" />
            <h1>Anypoint Monitor Extension</h1>
          </div>
          <div class="navbar-right">
            <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor">About</a>
            <a href="https://www.buymeacoffee.com/yucelmoran">Buy Me a Coffee</a>
          </div>
        </nav>

        <!-- MAIN CONTENT -->
        <div class="container">
          <div class="card">
            <div class="card-header">
              <h2>CloudHub 2.0 Applications</h2>
              <button id="downloadCsv" class="button">Download as CSV</button>
            </div>

            <div class="table-container">
              <table id="appTable" class="display" style="width:100%;">
                <thead>
                  <tr>
                    ${allKeysArray.map((key) => `<th>${key}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${flattenedApps
                    .map((flatApp) => {
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
        </div>

        <!-- jQuery & DataTables -->
        <script src="${jqueryJs}"></script>
        <script src="${dataTableJs}"></script>
        <script>
          const vscode = acquireVsCodeApi();

          // CSV download button
          document.getElementById('downloadCsv').addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadCsv' });
          });

          // Initialize DataTables
          $(document).ready(function () {
            $('#appTable').DataTable({
              pageLength: 10,
              responsive: true,
              autoWidth: false,
              language: {
                search: "Search:",
                lengthMenu: "Show _MENU_ entries"
              }
            });
          });
        </script>
      </body>
    </html>
  `;
}

/**
 * Flatten a nested object into dot-notation keys.
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
 */
function renderCell(key: string, value: any): string {
  if (key === 'id') {
    // Exclude the 'id' column
    return '';
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

  return value ?? '';
}

/**
 * Generates CSV content from the flattened objects.
 */
function generateCsvContent(apps: any[]): string {
  // Flatten each app, gather all keys
  const allKeys = new Set<string>();
  const flattenedApps = apps.map((app) => {
    const flat = flattenObject(app);
    Object.keys(flat).forEach((k) => allKeys.add(k));
    return flat;
  });

  // Remove "id", sort keys
  let allKeysArray = Array.from(allKeys).filter((k) => k !== 'id');
  allKeysArray.sort();

  // Build CSV header
  const headerRow = allKeysArray.join(',');

  // Convert each row
  const rows = flattenedApps.map((flatApp) => {
    return allKeysArray
      .map((key) => {
        let val = flatApp[key] !== undefined ? flatApp[key] : '';

        // Date fields
        if (key.match(/Date$/i)) {
          const ms = parseInt(val, 10);
          if (!isNaN(ms)) {
            const dateObj = new Date(ms);
            val = dateObj.toISOString().split('T')[0];
          }
        }

        // Status icons
        if (key === 'application.status') {
          if (val === 'RUNNING') {
            val = '🟢 RUNNING';
          } else if (val === 'STOPPED') {
            val = '🔴 STOPPED';
          }
        }

        // CSV-escape (surround with quotes, double any internal quotes)
        const safeVal = String(val).replace(/"/g, '""');
        return `"${safeVal}"`;
      })
      .join(',');
  });

  // Join header + rows
  return [headerRow, ...rows].join('\n');
}