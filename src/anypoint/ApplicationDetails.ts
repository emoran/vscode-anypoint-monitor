import * as vscode from 'vscode';
import * as fs from 'fs';

/** Flatten nested objects into dot-notation key/value pairs */
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

/** Cell renderer for certain keys (dates, statuses, etc.) */
function renderCell(key: string, value: any): string {
  // If the key ends with 'Date' (case-insensitive), parse as timestamp
  if (key.match(/date$/i)) {
    const ms = parseInt(value, 10);
    if (!isNaN(ms)) {
      const dateObj = new Date(ms);
      return dateObj.toISOString().split('T')[0]; // yyyy-mm-dd
    }
  }

  // If it's a status field
  if (key === 'status') {
    if (value === 'RUNNING') {
      return '🟢 RUNNING';
    } else if (value === 'STOPPED' || value === 'UNDEPLOYED' || value === 'STARTED') {
      return '🔴 ' + value;
    }
  }

  return value ?? '';
}

/** Build a 2-col table for a single application object (flattened). */
function buildSingleApplicationTable(app: any): string {
  if (!app || Object.keys(app).length === 0) {
    return `
      <div class="box">
        <h2>Application Information</h2>
        <p>No application data available.</p>
      </div>
    `;
  }

  // Flatten & sort
  const flattened = flattenObject(app);
  const allKeys = Object.keys(flattened).sort();

  // Generate <tr><td>Attribute</td><td>Value</td></tr> rows
  const rowsHtml = allKeys
    .map((key) => {
      const val = flattened[key];
      return `
      <tr>
        <td><strong>${key}</strong></td>
        <td>${renderCell(key, val)}</td>
      </tr>
    `;
    })
    .join('');

  return `
    <div class="box">
      <h2>Application Information</h2>
      <div class="table-container">
        <table class="app-table">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Build a table for the Schedulers array */
function buildSchedulersTable(schedulers: any[]): string {
  if (!schedulers || schedulers.length === 0) {
    return `
      <div class="box">
        <h2>Schedulers</h2>
        <p>No schedulers available.</p>
      </div>
    `;
  }

  const columns = [
    { key: 'flow', label: 'Flow' },
    { key: 'name', label: 'Name' },
    { key: 'lastRun', label: 'Last Run' },
    { key: 'enabled', label: 'Enabled' },
    { key: 'status', label: 'Status' },
  ];

  const rowsHtml = schedulers
    .map((sched) => {
      // Check schedule for cron or period/timeUnit
      let scheduleDisplay = '';
      if (sched.schedule) {
        if (sched.schedule.cronExpression) {
          scheduleDisplay = `Cron: ${sched.schedule.cronExpression}`;
        } else if (sched.schedule.period !== undefined && sched.schedule.timeUnit) {
          scheduleDisplay = `Every ${sched.schedule.period} ${sched.schedule.timeUnit}`;
        }
      }

      // Build columns
      const cells = columns.map((col) => {
        const val = sched[col.key];
        return `<td>${renderCell(col.key, val)}</td>`;
      });
      // Add the custom schedule column
      cells.push(`<td>${scheduleDisplay}</td>`);

      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  return `
    <div class="box">
      <h2>Schedulers</h2>
      <div class="table-container">
        <table class="app-table">
          <thead>
            <tr>
              ${columns.map((c) => `<th>${c.label}</th>`).join('')}
              <th>Schedule</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Build a static table for logs, but with no filtering/pagination. 
 *  We'll enhance it with client-side JS for searching & paging. */
function buildLogsSection(logData: any): string {
  // We allow either an array or an object with a .data array
  const logsArray = Array.isArray(logData)
    ? logData
    : Array.isArray(logData?.data)
    ? logData.data
    : [];

  if (logsArray.length === 0) {
    return `
      <div class="box">
        <h2>Logs</h2>
        <p>No logs available.</p>
      </div>
    `;
  }

  // We’ll just generate a table skeleton. The actual rows will be built in JS
  return `
    <div class="box">
      <h2>Logs</h2>
      
      <!-- Filter input -->
      <div style="margin-bottom: 0.5rem;">
        <input 
          id="logFilter" 
          type="text" 
          placeholder="Filter logs by text..." 
          style="width: 250px; padding: 4px;"
        />
      </div>

      <div class="table-container">
        <table class="logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Priority</th>
              <th>Logger</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody id="logsTbody">
            <!-- We fill this in client-side script -->
          </tbody>
        </table>
      </div>

      <!-- Pagination controls -->
      <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 1rem;">
        <button id="logsPrev" class="button">Prev</button>
        <button id="logsNext" class="button">Next</button>
        <span id="logsPageInfo" style="font-size: 0.85rem;"></span>
      </div>
    </div>
  `;
}

/** Generate CSV content for the single application data. */
function generateCsvContent(data: any): string {
  const app = data.application;
  if (!app || typeof app !== 'object') {
    return '';
  }
  const flattenedApp = flattenObject(app);
  const allKeys = Object.keys(flattenedApp).sort();
  const header = allKeys.join(',');
  const row = allKeys
    .map((k) => {
      let val = flattenedApp[k] ?? '';
      if (k.match(/date$/i)) {
        const ms = parseInt(val, 10);
        if (!isNaN(ms)) {
          val = new Date(ms).toISOString().split('T')[0];
        }
      }
      if (k === 'status' && val === 'RUNNING') val = '🟢 RUNNING';
      if (k === 'status' && ['STOPPED', 'UNDEPLOYED', 'STARTED'].includes(val)) {
        val = '🔴 ' + val;
      }
      return `"${String(val).replace(/"/g, '""')}"`;
    })
    .join(',');
  return [header, row].join('\n');
}

/** Main function to show the multi-section dashboard webview. */
export function showDashboardWebview(context: vscode.ExtensionContext, data: any) {
  if (!data) data = {};
  data.application = data.application || {};
  data.schedulers = Array.isArray(data.schedulers) ? data.schedulers : [];
  data.alerts = Array.isArray(data.alerts) ? data.alerts : [];
  data.analytics = Array.isArray(data.analytics) ? data.analytics : [];
  // logs can be array or object with { data: [] }
  data.logs = data.logs ?? [];

  const panel = vscode.window.createWebviewPanel(
    'anypointDashboard',
    'Anypoint Monitor Dashboard',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getDashboardHtml(data, panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'downloadCsv') {
      const csvData = generateCsvContent(data);
      if (!csvData) {
        vscode.window.showInformationMessage('No application data to export.');
        return;
      }
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Save as CSV',
      });
      if (uri) {
        fs.writeFileSync(uri.fsPath, csvData, 'utf-8');
        vscode.window.showInformationMessage(`CSV file saved to ${uri.fsPath}`);
      }
    }
  });
}

function getDashboardHtml(
  data: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  // Optional logo
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // Build the sections
  const applicationHtml = buildSingleApplicationTable(data.application);

  // We reuse buildSchedulersTable or inline version. Shown here is inline for demonstration.
  const schedulersHtml = `
    <div class="box scheduler-box">
      <h2>Schedulers</h2>
      <div class="table-container">
        <table class="app-table">
          <thead>
            <tr>
              <th>Flow</th>
              <th>Name</th>
              <th>Last Run</th>
              <th>Enabled</th>
              <th>Status</th>
              <th>Schedule</th>
            </tr>
          </thead>
          <tbody>
            ${
              data.schedulers?.length
                ? data.schedulers
                    .map((sched: any) => {
                      const flow = renderCell('flow', sched.flow);
                      const name = renderCell('name', sched.name);
                      const lastRun = renderCell('lastRun', sched.lastRun);
                      const enabled = renderCell('enabled', sched.enabled);
                      const status = renderCell('status', sched.status);

                      let scheduleDisplay = '';
                      if (sched.schedule) {
                        if (sched.schedule.cronExpression) {
                          scheduleDisplay = `Cron: ${sched.schedule.cronExpression}`;
                        } else if (
                          sched.schedule.period !== undefined &&
                          sched.schedule.timeUnit
                        ) {
                          scheduleDisplay = `Every ${sched.schedule.period} ${sched.schedule.timeUnit}`;
                        }
                      }

                      return `
                    <tr>
                      <td>${flow}</td>
                      <td>${name}</td>
                      <td>${lastRun}</td>
                      <td>${enabled}</td>
                      <td>${status}</td>
                      <td>${scheduleDisplay}</td>
                    </tr>
                  `;
                    })
                    .join('')
                : '<tr><td colspan="6">No schedulers available.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  const logsHtml = `
    <div class="box logs-box">
      <h2>Logs</h2>
      
      <!-- Filter input -->
      <div style="margin-bottom: 0.5rem;">
        <input 
          id="logFilter" 
          type="text" 
          placeholder="Filter logs by text..." 
          style="width: 250px; padding: 4px;"
        />
      </div>

      <div class="table-container">
        <table class="logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Priority</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody id="logsTbody">
            <!-- Rows filled via client-side script -->
          </tbody>
        </table>
      </div>

      <!-- Pagination controls -->
      <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 1rem;">
        <button id="logsPrev" class="button">Prev</button>
        <button id="logsNext" class="button">Next</button>
        <span id="logsPageInfo" style="font-size: 0.85rem;"></span>
      </div>
    </div>
  `;

  // Simple placeholders for Alerts & Analytics
  const alertsHtml = `
    <div class="box">
      <h2>Alerts</h2>
      <p>${JSON.stringify(data.alerts)}</p>
    </div>
  `;
  const analyticsHtml = `
    <div class="box">
      <h2>Analytics</h2>
      <div class="analytics-icons">
        <h3>Coming Soon.</h3>
      </div>
    </div>
  `;

  // Final HTML with a hero section (optional) + blue-gray “tech” style
  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Anypoint Monitor Dashboard</title>
        <style>
          /* Global resets, blue-gray tech style */
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
              Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
            color: #212529;
            background-color: #ffffff;
          }

          /* NAVBAR - changed from #1e1a41 to #1f2b3c */
          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #1f2b3c;
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
            color: #fff;
            font-size: 1.25rem;
            margin: 0;
          }
          .navbar-right {
            display: flex;
            gap: 1.5rem;
          }
          .navbar-right a {
            color: #fff;
            text-decoration: none;
            font-weight: 500;
            font-size: 0.9rem;
          }
          .navbar-right a:hover {
            text-decoration: underline;
          }

          /* Optional Hero Section with a blue-gray gradient (like previous examples) */
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

          /* Container */
          .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 1rem;
          }

          /* Button style: from purple to a subtle blue-gray */
          .button {
            padding: 10px 16px;
            font-size: 14px;
            color: #fff;
            background-color: #52667a; /* muted blue-gray */
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
          }
          .button:hover {
            background-color: #435362;
          }

          /* 2-column layout */
          .dashboard-grid {
            display: grid;
            grid-template-columns: 750px 1.5fr;
            gap: 1rem;
          }
          .left-column,
          .right-column {
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }

          /* Boxes */
          .box {
            background-color: #fafafa;
            border: 1px solid #e2e2e2;
            border-radius: 4px;
            padding: 1rem;
          }
          .box h2 {
            margin-top: 0;
            font-size: 1.1rem;
            margin-bottom: 0.75rem;
          }
          .table-container {
            width: 100%;
            overflow-x: auto;
          }

          .app-table {
            border-collapse: collapse;
            width: 100%;
            background-color: #fff;
            box-shadow: 0 0 5px rgba(0, 0, 0, 0.15);
            font-size: 0.75rem;
          }
          .app-table th,
          .app-table td {
            padding: 6px;
            border-bottom: 1px solid #e2e2e2;
            text-align: left;
            vertical-align: top;
            font-size: 0.71rem;
          }
          .app-table th {
            background-color: #f4f4f4;
            font-weight: 600;
            white-space: nowrap;
          }
          .app-table tr:hover {
            background-color: #f9f9f9;
          }

          /* Make logs table smaller and scrollable */
          .logs-table {
            border-collapse: collapse;
            width: 100%;
            background-color: #fff;
            box-shadow: 0 0 5px rgba(0, 0, 0, 0.15);
            font-size: 0.75rem;
            font-family: "Courier New", Courier, monospace;
          }
          .logs-table th,
          .logs-table td {
            padding: 6px;
            border-bottom: 1px solid #e2e2e2;
            text-align: left;
            vertical-align: top;
          }
          .logs-table th {
            background-color: #f4f4f4;
            font-weight: 600;
            white-space: nowrap;
          }
          .logs-table tr:hover {
            background-color: #f9f9f9;
          }

          /* Adjust boxes if you want scroll limits */
          .scheduler-box .table-container {
            max-height: none;
            overflow-y: visible;
          }
          .logs-box .table-container {
            max-height: 300px;
            overflow-y: auto;
          }

          .analytics-icons {
            display: flex;
            gap: 1rem;
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
          <!-- 2-column grid layout -->
          <div class="dashboard-grid">
            <!-- Left Column: Application Info & Analytics -->
            <div class="left-column">
              ${applicationHtml}
              ${analyticsHtml}
            </div>

            <!-- Right Column: Schedulers, Logs, & Alerts -->
            <div class="right-column">
              ${schedulersHtml}
              ${logsHtml}
              <div class="box">
                <h2>Alerts</h2>
                <p>${JSON.stringify(data.alerts)}</p>
              </div>
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          // CSV Button (if you add one in your HTML, e.g. <button id="downloadCsv" class="button">Download CSV</button>)
          const csvBtn = document.getElementById('downloadCsv');
          if (csvBtn) {
            csvBtn.addEventListener('click', () => {
              vscode.postMessage({ command: 'downloadCsv' });
            });
          }

          // ========== LOGS FILTERING + PAGINATION ==========
          // We'll assume we have "data.logs" in the code behind. We'll embed it here:
          const logsRaw = ${JSON.stringify(data.logs?.data ?? data.logs ?? [])};

          // This is our in-memory array of logs:
          let logsData = Array.isArray(logsRaw) ? logsRaw : [];
          // We'll keep a separate "filtered" array
          let filteredLogs = [...logsData];

          let currentPage = 1;
          const pageSize = 10; // Show 10 logs per page

          // DOM references
          const logFilter = document.getElementById('logFilter');
          const logsTbody = document.getElementById('logsTbody');
          const logsPrev = document.getElementById('logsPrev');
          const logsNext = document.getElementById('logsNext');
          const logsPageInfo = document.getElementById('logsPageInfo');

          // Render the logs for the current page
          function renderLogsTable() {
            // Calculate slice
            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            const pageLogs = filteredLogs.slice(startIndex, endIndex);

            // Build rows
            const rowsHtml = pageLogs
              .map((log) => {
                const dateStr = new Date(log.timestamp).toISOString();
                const msg = (log.message || '').replace(/\\n/g, '<br/>');
                return \`
                  <tr>
                    <td>\${dateStr}</td>
                    <td>\${log.priority || ''}</td>
                    <td>\${msg}</td>
                  </tr>
                \`;
              })
              .join('');

            logsTbody.innerHTML = rowsHtml;

            // Show page info
            const totalPages = Math.ceil(filteredLogs.length / pageSize);
            if (logsPageInfo) {
              logsPageInfo.textContent = \`Page \${currentPage} of \${totalPages}\`;
            }

            // Enable/disable Prev/Next
            if (logsPrev) logsPrev.disabled = currentPage <= 1;
            if (logsNext) logsNext.disabled = currentPage >= totalPages;
          }

          // Filter logs by text
          function applyLogFilter() {
            const term = logFilter?.value?.toLowerCase() || '';
            filteredLogs = logsData.filter((log) => {
              const combined = [log.threadName, log.priority, log.message]
                .join(' ')
                .toLowerCase();
              return combined.includes(term);
            });
            currentPage = 1; // reset to first page
            renderLogsTable();
          }

          // Hook up buttons
          logsPrev?.addEventListener('click', () => {
            if (currentPage > 1) {
              currentPage--;
              renderLogsTable();
            }
          });
          logsNext?.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredLogs.length / pageSize);
            if (currentPage < totalPages) {
              currentPage++;
              renderLogsTable();
            }
          });
          // Hook up filter
          logFilter?.addEventListener('input', () => {
            applyLogFilter();
          });

          // Initial render
          renderLogsTable();
        </script>
      </body>
    </html>
  `;
}