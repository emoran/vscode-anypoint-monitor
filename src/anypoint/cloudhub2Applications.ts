import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Creates a webview panel and displays a table of applications,
 * styled similarly to your "tech" design, with DataTables for filtering/pagination.
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
 */
function renderCell(key: string, value: any): string {
  if (key === 'id') {
    return ''; // We'll exclude the 'id' column entirely
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
 * Generates HTML for the webview with a dynamic table that
 * shows all JSON attributes (flattened), plus DataTables for pagination/filtering.
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

  // 3. Construct URIs for your assets (e.g. logo)
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // 4. Because we want DataTables, include jQuery & DataTables scripts
  //    using their public CDNs, plus the DataTables CSS
  const jqueryJs = 'https://code.jquery.com/jquery-3.6.0.min.js';
  const dataTableJs = 'https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js';
  const dataTableCss = 'https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css';

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>CloudHub 2.0 Applications</title>
        <!-- OPTIONAL: modern Google Font -->
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap" />

        <!-- DataTables CSS -->
        <link rel="stylesheet" href="${dataTableCss}" />

        <style>
          /* GLOBAL RESET & FONT */
          body {
            margin: 0;
            padding: 0;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI",
              Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
            color: #212529;
            background-color: #ffffff;
          }

          /* NAVBAR */
          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #1f2b3c; /* Blue-gray tone */
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

          /* HERO SECTION */
          .hero {
            background: linear-gradient(90deg, #2c3e50 0%, #4a5965 50%, #67737b 100%);
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

          /* MAIN CONTAINER: ~80% width, centered */
          .container {
            width: 80%;
            margin: 1rem auto;
            background-color: #ffffff;
          }

          /* TITLE & BUTTON */
          .title-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 1rem 0;
          }
          .title-bar h4 {
            font-size: 1.25rem;
            margin: 0;
          }
          .button {
            padding: 8px 14px;
            font-size: 0.85rem;
            color: #ffffff;
            background-color: #52667a;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            font-weight: 600;
          }
          .button:hover {
            background-color: #435362;
          }

          /* TABLE CONTAINER (SCROLLABLE) */
          .table-container {
            width: 100%;
            overflow-x: auto;
            margin-bottom: 2rem;
          }

          /* TABLE STYLES with DataTables */
          table.dataTable { /* add .dataTable for styling from the included CSS */
            border-collapse: collapse;
            background-color: #fff;
            box-shadow: 0 0 5px rgba(0,0,0,0.1);
            width: 100%; /* Let it stretch full width */
          }
          table.dataTable thead th,
          table.dataTable tbody td {
            font-size: 0.8rem; /* smaller font */
            padding: 6px 8px;  /* tighter cell padding */
            white-space: nowrap;
          }
          /* Subtle row striping & hover highlight can be handled by DataTables,
             but we can also keep our own if we prefer. */
          table.dataTable tbody tr:nth-child(even) {
            background-color: #fafbfc;
          }
          table.dataTable tbody tr:hover {
            background-color: #f1f3f5;
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
          <!-- Title & Button -->
          <div class="title-bar">
            <h4>CloudHub 2.0 Applications</h4>
            <button id="downloadCsv" class="button">Download as CSV</button>
          </div>

          <!-- Scrollable Table Container -->
          <div class="table-container">
            <!-- IMPORTANT: id="appTable" and class="display" for DataTables -->
            <table id="appTable" class="display">
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

        <!-- jQuery and DataTables scripts -->
        <script src="${jqueryJs}"></script>
        <script src="${dataTableJs}"></script>

        <script>
          const vscode = acquireVsCodeApi();

          // CSV download handler
          document.getElementById('downloadCsv').addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadCsv' });
          });

          // Initialize DataTables
          $(document).ready(function () {
            $('#appTable').DataTable({
              pageLength: 10,      // Show 10 rows per page by default
              responsive: true,    // Make table responsive (requires extra plugin)
              autoWidth: false,    // Don't force DataTables to auto-calculate column widths
              // You can add more DataTables config here if desired
            });
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
  // Flatten each app to gather all keys
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