import * as vscode from 'vscode';
import * as fs from 'fs';
// import fetch from 'node-fetch'; // Or use axios if needed

/** Flatten objects into dot-notation */
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

/** Renders a cell. If boolean => checkbox, if status => icon, etc. */
function renderAppInfoCell(key: string, value: any): string {
  if (typeof value === 'boolean') {
    return `<input type="checkbox" disabled ${value ? 'checked' : ''} />`;
  }
  if (key.match(/date$/i)) {
    const ms = parseInt(value, 10);
    if (!isNaN(ms)) {
      return new Date(ms).toISOString().split('T')[0];
    }
  }
  if (key === 'status') {
    if (value === 'RUNNING' || value === 'STARTED') return '🟢 RUNNING';
    if (['STOPPED', 'UNDEPLOYED', 'STARTED'].includes(value)) {
      return '🔴 ' + value;
    }
  }
  return value ?? '';
}

/**
 * Builds the Application Information card,
 * with Stop/Start/Restart buttons.
 */
function buildSingleApplicationTable(app: any): string {
  if (!app || Object.keys(app).length === 0) {
    return `
      <div class="card">
        <h2>Application Information</h2>
        <p>No application data available.</p>
      </div>
    `;
  }

  const flattened = flattenObject(app);
  const visibleKeys = new Set(['id', 'domain', 'fullDomain', 'region', 'muleVersion']);
  const normalFields: Record<string, any> = {};
  const propFields: Record<string, any> = {};

  const allKeys = Object.keys(flattened).sort();
  for (const key of allKeys) {
    const val = flattened[key];
    if (visibleKeys.has(key) || typeof val === 'boolean') {
      normalFields[key] = val;
    } else {
      propFields[key] = val;
    }
  }

  // Build normal rows
  const normalRowsHtml = Object.keys(normalFields)
    .map((key) => {
      return `
        <tr>
          <td><strong>${key}</strong></td>
          <td>${renderAppInfoCell(key, normalFields[key])}</td>
        </tr>
      `;
    })
    .join('');

  // Build hidden property rows
  const propRowsHtml = Object.keys(propFields)
    .map((key) => {
      return `
        <tr>
          <td><strong>${key}</strong></td>
          <td>${renderAppInfoCell(key, propFields[key])}</td>
        </tr>
      `;
    })
    .join('');

  const propsSection = Object.keys(propFields).length
    ? `
      <tr>
        <td colspan="2">
          <details>
            <summary style="cursor: pointer; font-weight: bold;">
              Show/Hide properties (${Object.keys(propFields).length})
            </summary>
            <table>
              ${propRowsHtml}
            </table>
          </details>
        </td>
      </tr>
    `
    : '';

  return `
    <div class="card">
      <div class="card-header">
        <h2>Application Information</h2>
        <div class="button-group">
          <button id="btnStopApp" class="button">Stop Application</button>
          <button id="btnStartApp" class="button">Start Application</button>
          <button id="btnRestartApp" class="button">Restart Application</button>
        </div>
      </div>
      <div class="table-container">
        <table class="app-table">
          <thead>
            <tr><th>Attribute</th><th>Value</th></tr>
          </thead>
          <tbody>
            ${normalRowsHtml}
            ${propsSection}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Build schedulers table (restyled). */
function buildSchedulersTable(schedulers: any[]): string {
  if (!schedulers || schedulers.length === 0) {
    return `
      <div class="card">
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
      let scheduleDisplay = '';
      if (sched.schedule) {
        if (sched.schedule.cronExpression) {
          scheduleDisplay = `Cron: ${sched.schedule.cronExpression}`;
        } else if (sched.schedule.period !== undefined && sched.schedule.timeUnit) {
          scheduleDisplay = `Every ${sched.schedule.period} ${sched.schedule.timeUnit}`;
        }
      }

      const cells = columns.map((col) => {
        const val = sched[col.key];
        return `<td>${renderAppInfoCell(col.key, val)}</td>`;
      });
      // Add schedule column
      cells.push(`<td>${scheduleDisplay}</td>`);

      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  return `
    <div class="card">
      <h2>Schedulers</h2>
      <div class="table-container">
        <table class="app-table">
          <thead>
            <tr>
              ${columns.map(c => `<th>${c.label}</th>`).join('')}
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

/** Generate CSV for the single application data */
function generateCsvContent(data: any): string {
  const app = data.application;
  if (!app || typeof app !== 'object') return '';

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

/** Generate log file content in different formats */
function generateLogContent(logs: any[], format: 'json' | 'txt' | 'csv'): string {
  if (!logs || !Array.isArray(logs) || logs.length === 0) {
    return format === 'json' ? '[]' : '';
  }

  switch (format) {
    case 'json':
      return JSON.stringify(logs, null, 2);
    
    case 'txt':
      return logs
        .map(log => {
          const timestamp = new Date(log.timestamp).toISOString();
          const priority = log.priority || 'INFO';
          const message = (log.message || '').replace(/\\n/g, '\n');
          return `[${timestamp}] ${priority}: ${message}`;
        })
        .join('\n\n');
    
    case 'csv':
      const headers = ['Timestamp', 'Priority', 'Thread Name', 'Message'];
      const csvRows = logs.map(log => {
        const timestamp = new Date(log.timestamp).toISOString();
        const priority = log.priority || '';
        const threadName = log.threadName || '';
        const message = (log.message || '').replace(/"/g, '""');
        return `"${timestamp}","${priority}","${threadName}","${message}"`;
      });
      return [headers.join(','), ...csvRows].join('\n');
    
    default:
      return '';
  }
}

/**
 * Helper to update the application status via CloudHub API.
 * status can be "stop" | "start" | "restart".
 */
async function updateApplicationStatus(
  applicationName: string,
  status: 'stop' | 'start' | 'restart',
  envId: string,
  authToken: string
): Promise<void> {
  const url = `https://anypoint.mulesoft.com/cloudhub/api/applications/${applicationName}/status`;
  const body = JSON.stringify({ status });
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
      'x-anypnt-env-id': envId
    },
    body,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Failed to update app status: ${resp.status} ${resp.statusText} => ${txt}`);
  }
}

/**
 * Show the dashboard webview.
 */
export async function showDashboardWebview(
  context: vscode.ExtensionContext,
  domain: string,
  data: any,
  environment: string
) {
  const envId = environment;

  data.application = data.application || {};
  data.schedulers = Array.isArray(data.schedulers) ? data.schedulers : [];
  data.alerts = Array.isArray(data.alerts) ? data.alerts : [];
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
    } else if (message.command === 'downloadLogs') {
      const logs = Array.isArray(data.logs?.data) ? data.logs.data : 
                   Array.isArray(data.logs) ? data.logs : [];
      
      if (logs.length === 0) {
        vscode.window.showInformationMessage('No log data to export.');
        return;
      }

      // Show format selection
      const format = await vscode.window.showQuickPick(
        [
          { label: 'JSON', description: 'Structured JSON format', value: 'json' },
          { label: 'Text', description: 'Human-readable text format', value: 'txt' },
          { label: 'CSV', description: 'Comma-separated values', value: 'csv' }
        ],
        { placeHolder: 'Select log file format' }
      );

      if (!format) return;

      const logContent = generateLogContent(logs, format.value as 'json' | 'txt' | 'csv');
      const fileExtension = format.value;
      const defaultFileName = `logs-${new Date().toISOString().split('T')[0]}.${fileExtension}`;

      const uri = await vscode.window.showSaveDialog({
        filters: {
          'JSON Files': ['json'],
          'Text Files': ['txt'],
          'CSV Files': ['csv']
        },
        defaultUri: vscode.Uri.file(defaultFileName),
        saveLabel: 'Save Logs'
      });

      if (uri) {
        fs.writeFileSync(uri.fsPath, logContent, 'utf-8');
        vscode.window.showInformationMessage(`Log file saved to ${uri.fsPath}`);
      }
    } else if (message.command === 'stopApp') {
      try {
        const accessToken = await context.secrets.get('anypoint.accessToken');
        if (!accessToken) throw new Error('No access token found. Please log in first.');
        await updateApplicationStatus(domain, 'stop', envId, accessToken);
        vscode.window.showInformationMessage(`Application ${domain} is being stopped...`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to stop app: ${err.message}`);
      }
    } else if (message.command === 'startApp') {
      try {
        const accessToken = await context.secrets.get('anypoint.accessToken');
        if (!accessToken) throw new Error('No access token found. Please log in first.');
        await updateApplicationStatus(domain, 'start', envId, accessToken);
        vscode.window.showInformationMessage(`Application ${domain} is being started...`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to start app: ${err.message}`);
      }
    } else if (message.command === 'restartApp') {
      try {
        const accessToken = await context.secrets.get('anypoint.accessToken');
        if (!accessToken) throw new Error('No access token found. Please log in first.');
        await updateApplicationStatus(domain, 'restart', envId, accessToken);
        vscode.window.showInformationMessage(`Application ${domain} is being restarted...`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to restart app: ${err.message}`);
      }
    }
  });
}

/** Return the HTML for the webview (dark theme, small font, with tabs). */
function getDashboardHtml(
  data: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // Build each section
  const applicationHtml = buildSingleApplicationTable(data.application);
  const schedulersHtml = buildSchedulersTable(data.schedulers);
  const alertsHtml = `
    <div class="card">
      <h2>Alerts</h2>
      <p>${JSON.stringify(data.alerts)}</p>
    </div>
  `;
  // Updated logs section with download button
  const logsHtml = `
    <div class="card logs">
      <div class="card-header">
        <h2>Logs</h2>
        <div class="button-group">
          <button id="btnDownloadLogs" class="button">Download Logs</button>
        </div>
      </div>
      <div style="margin-bottom: 0.5rem;">
        <input 
          id="logFilter" 
          type="text" 
          placeholder="Filter logs by text..." 
          style="width: 250px; padding: 4px;"
        />
      </div>
      <div class="table-container" style="max-height: 600px; overflow-y: auto;">
        <table class="logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Priority</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody id="logsTbody"></tbody>
        </table>
      </div>
      <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 1rem;">
        <button id="logsPrev" class="button">Prev</button>
        <button id="logsNext" class="button">Next</button>
        <span id="logsPageInfo" style="font-size: 0.85rem;"></span>
      </div>
    </div>
  `;

  // Build the tabbed layout (each tab is one section)
  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Anypoint Monitor Dashboard</title>

        <!-- Fira Code for tech vibe -->
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap" />

        <style>
          /* Dark Theme Variables */
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

          /* Smaller base font size */
          body {
            margin: 0;
            padding: 0;
            background-color: var(--background-color);
            color: var(--text-color);
            font-family: 'Fira Code', monospace, sans-serif;
            font-size: 12px;
          }

          /* NAVBAR */
          .navbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: var(--navbar-color);
            padding: 0.5rem 1rem;
          }
          .navbar-left {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .navbar-left img {
            height: 28px;
            width: auto;
          }
          .navbar-left h1 {
            color: var(--navbar-text-color);
            font-size: 1rem;
            margin: 0;
          }
          .navbar-right {
            display: flex;
            gap: 0.75rem;
          }
          .navbar-right a {
            color: var(--navbar-text-color);
            text-decoration: none;
            font-weight: 500;
            font-size: 0.75rem;
          }
          .navbar-right a:hover {
            text-decoration: underline;
          }

          /* CONTAINER */
          .container {
            width: 90%;
            max-width: 1400px;
            margin: 0.5rem auto;
          }

          /* TABS */
          .tabs {
            margin-top: 1rem;
          }
          .tab-header {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1rem;
          }
          .tab-btn {
            background-color: var(--card-color);
            color: var(--text-color);
            border: 1px solid #30363D;
            border-radius: 4px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 0.75rem;
          }
          .tab-btn.active, .tab-btn:hover {
            background-color: var(--button-hover-color);
          }
          .tab-content {
            display: none;
          }
          .tab-content.active {
            display: block;
          }

          /* CARD */
          .card {
            background-color: var(--card-color);
            border: 1px solid #30363D;
            border-radius: 6px;
            padding: 0.5rem;
            margin-bottom: 1rem;
          }
          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.5rem;
          }
          .card-header h2 {
            margin: 0;
            font-size: 0.9rem;
            color: var(--accent-color);
          }

          /* BUTTONS */
          .button-group {
            display: flex;
            gap: 0.25rem;
          }
          .button {
            padding: 4px 8px;
            font-size: 0.75rem;
            color: #fff;
            background-color: var(--accent-color);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
          }
          .button:hover {
            background-color: var(--button-hover-color);
          }

          /* TABLES */
          .table-container {
            width: 100%;
            overflow-x: auto;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            padding: 4px;
            border-bottom: 1px solid #30363D;
            text-align: left;
            vertical-align: top;
          }
          th {
            color: var(--accent-color);
            white-space: nowrap;
          }
          tr:hover {
            background-color: var(--table-hover-color);
          }
          .app-table {
            font-size: 0.75rem;
          }
          .logs-table {
            font-family: 'Fira Code', monospace;
            font-size: 0.7rem;
          }
        </style>
      </head>
      <body>
        <!-- NAVBAR -->
        <nav class="navbar">
          <div class="navbar-left">
            <img src="${logoSrc}" alt="Logo"/>
            <h1>Anypoint Monitor Extension</h1>
          </div>
          <div class="navbar-right">
            <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor">About</a>
            <a href="https://www.buymeacoffee.com/yucelmoran">Buy Me a Coffee</a>
          </div>
        </nav>

        <!-- MAIN CONTAINER -->
        <div class="container">
          <div class="tabs">
            <nav class="tab-header">
              <button data-tab="app-info" class="tab-btn active">Application Info</button>
              <button data-tab="schedulers" class="tab-btn">Schedulers</button>
              <button data-tab="alerts" class="tab-btn">Alerts</button>
              <button data-tab="logs" class="tab-btn">Logs</button>
            </nav>
            <div class="tab-content active" id="tab-app-info">
              ${applicationHtml}
            </div>
            <div class="tab-content" id="tab-schedulers">
              ${schedulersHtml}
            </div>
            <div class="tab-content" id="tab-alerts">
              ${alertsHtml}
            </div>
            <div class="tab-content" id="tab-logs">
              ${logsHtml}
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          // Tab switching logic
          const tabBtns = document.querySelectorAll('.tab-btn');
          const tabContents = document.querySelectorAll('.tab-content');
          tabBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
              tabBtns.forEach(b => b.classList.remove('active'));
              tabContents.forEach(tc => tc.classList.remove('active'));
              btn.classList.add('active');
              const tabId = 'tab-' + btn.dataset.tab;
              document.getElementById(tabId)?.classList.add('active');
            });
          });

          // Logs filtering & paging
          const logsRaw = ${JSON.stringify(data.logs?.data ?? data.logs ?? [])};
          let logsData = Array.isArray(logsRaw) ? logsRaw : [];
          let filteredLogs = [...logsData];
          let currentPage = 1;
          const pageSize = 10;

          const logFilter = document.getElementById('logFilter');
          const logsTbody = document.getElementById('logsTbody');
          const logsPrev = document.getElementById('logsPrev');
          const logsNext = document.getElementById('logsNext');
          const logsPageInfo = document.getElementById('logsPageInfo');

          function renderLogsTable() {
            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            const pageLogs = filteredLogs.slice(startIndex, endIndex);
            const rowsHtml = pageLogs.map(log => {
              const dateStr = new Date(log.timestamp).toISOString();
              const msg = (log.message || '').replace(/\\n/g, '<br/>');
              return \`
                <tr>
                  <td>\${dateStr}</td>
                  <td>\${log.priority || ''}</td>
                  <td>\${msg}</td>
                </tr>
              \`;
            }).join('');
            logsTbody.innerHTML = rowsHtml;
            const totalPages = Math.ceil(filteredLogs.length / pageSize);
            logsPageInfo.textContent = \`Page \${currentPage} of \${totalPages}\`;
            logsPrev.disabled = (currentPage <= 1);
            logsNext.disabled = (currentPage >= totalPages);
          }

          function applyLogFilter() {
            const term = (logFilter.value || '').toLowerCase();
            filteredLogs = logsData.filter(log => {
              const combined = [log.threadName, log.priority, log.message].join(' ').toLowerCase();
              return combined.includes(term);
            });
            currentPage = 1;
            renderLogsTable();
          }

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
          logFilter?.addEventListener('input', applyLogFilter);
          renderLogsTable();

          // Stop / Start / Restart Buttons
          document.getElementById('btnStopApp')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'stopApp' });
          });
          document.getElementById('btnStartApp')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'startApp' });
          });
          document.getElementById('btnRestartApp')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'restartApp' });
          });

          // Download Logs Button
          document.getElementById('btnDownloadLogs')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadLogs' });
          });
        </script>
      </body>
    </html>
  `;
}