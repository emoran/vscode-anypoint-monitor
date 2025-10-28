import * as vscode from 'vscode';
import * as fs from 'fs';
import { ApiHelper } from '../controllers/apiHelper.js';

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
    if (value === 'RUNNING' || value === 'STARTED') {
      return `<span class="status-badge status-running"><span class="status-dot"></span>RUNNING</span>`;
    }
    if (['STOPPED', 'UNDEPLOYED'].includes(value)) {
      return `<span class="status-badge status-stopped"><span class="status-dot"></span>${value}</span>`;
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
      if (k === 'status' && (val === 'RUNNING' || val === 'STARTED')) {
        val = 'RUNNING';
      }
      if (k === 'status' && ['STOPPED', 'UNDEPLOYED'].includes(val)) {
        val = val;
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
  apiHelper: ApiHelper
): Promise<void> {
  const url = `https://anypoint.mulesoft.com/cloudhub/api/applications/${applicationName}/status`;
  const headers = {
    'x-anypnt-env-id': envId
  };
  
  await apiHelper.post(url, { status }, { headers });
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

      if (!format) {
        return;
      }

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
        const apiHelper = new ApiHelper(context);
        await updateApplicationStatus(domain, 'stop', envId, apiHelper);
        vscode.window.showInformationMessage(`Application ${domain} is being stopped...`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to stop app: ${err.message}`);
      }
    } else if (message.command === 'startApp') {
      try {
        const apiHelper = new ApiHelper(context);
        await updateApplicationStatus(domain, 'start', envId, apiHelper);
        vscode.window.showInformationMessage(`Application ${domain} is being started...`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to start app: ${err.message}`);
      }
    } else if (message.command === 'restartApp') {
      try {
        const apiHelper = new ApiHelper(context);
        await updateApplicationStatus(domain, 'restart', envId, apiHelper);
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
          /* Code Time inspired theme */
          :root {
            --background-primary: #1e2328;
            --background-secondary: #161b22;
            --surface-primary: #21262d;
            --surface-secondary: #30363d;
            --surface-accent: #0d1117;
            --text-primary: #f0f6fc;
            --text-secondary: #7d8590;
            --text-muted: #656d76;
            --accent-blue: #58a6ff;
            --accent-light: #79c0ff;
            --border-primary: #30363d;
            --border-muted: #21262d;
            --success: #3fb950;
            --warning: #d29922;
            --error: #f85149;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 0;
            background-color: var(--background-primary);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
          }

          /* Header Section */
          .header {
            background-color: var(--background-secondary);
            border-bottom: 1px solid var(--border-primary);
            padding: 24px 32px;
          }

          .header-content {
            max-width: 1200px;
            margin: 0 auto;
          }

          .header h1 {
            font-size: 28px;
            font-weight: 600;
            margin: 0 0 8px 0;
            color: var(--text-primary);
          }

          .header p {
            font-size: 16px;
            color: var(--text-secondary);
            margin: 0;
          }

          /* Main Content */
          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 32px;
          }

          /* TABS */
          .tabs {
            margin-top: 16px;
          }
          .tab-header {
            display: flex;
            gap: 8px;
            margin-bottom: 24px;
            border-bottom: 1px solid var(--border-primary);
            padding-bottom: 12px;
          }
          .tab-btn {
            background-color: transparent;
            color: var(--text-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
          }
          .tab-btn.active {
            background-color: var(--accent-blue);
            color: white;
            border-color: var(--accent-blue);
          }
          .tab-btn:hover:not(.active) {
            background-color: var(--surface-secondary);
            color: var(--text-primary);
          }
          .tab-content {
            display: none;
          }
          .tab-content.active {
            display: block;
          }

          /* CARD */
          .card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            transition: all 0.2s;
          }
          .card:hover {
            border-color: var(--border-muted);
            transform: translateY(-1px);
          }
          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
          }
          .card-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: var(--text-primary);
          }

          /* BUTTONS */
          .button-group {
            display: flex;
            gap: 8px;
          }
          .button {
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 500;
            color: white;
            background-color: var(--accent-blue);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
          }
          .button:hover {
            background-color: var(--accent-light);
            transform: translateY(-1px);
          }

          /* TABLES */
          .table-container {
            width: 100%;
            overflow-x: auto;
            border-radius: 8px;
            border: 1px solid var(--border-primary);
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            padding: 12px 16px;
            text-align: left;
            vertical-align: top;
            border-bottom: 1px solid var(--border-muted);
          }
          th {
            background-color: var(--surface-secondary);
            color: var(--text-secondary);
            font-weight: 500;
            font-size: 13px;
            white-space: nowrap;
          }
          td {
            color: var(--text-primary);
            font-size: 14px;
          }
          tr:hover {
            background-color: var(--surface-secondary);
          }
          .app-table {
            font-size: 14px;
          }
          .logs-table {
            font-family: 'Fira Code', 'Courier New', monospace;
            font-size: 13px;
          }

          /* Status Badges */
          .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
          }

          .status-running {
            background-color: rgba(63, 185, 80, 0.15);
            color: var(--success);
          }

          .status-stopped {
            background-color: rgba(248, 81, 73, 0.15);
            color: var(--error);
          }

          .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: currentColor;
          }

          /* Form Controls */
          input[type="text"] {
            background-color: var(--surface-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            padding: 8px 12px;
            color: var(--text-primary);
            font-size: 14px;
          }

          input[type="text"]:focus {
            outline: none;
            border-color: var(--accent-blue);
            box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.1);
          }

          /* Details/Summary */
          details {
            margin-top: 12px;
          }

          summary {
            cursor: pointer;
            font-weight: 500;
            color: var(--accent-blue);
            padding: 8px 0;
          }

          summary:hover {
            color: var(--accent-light);
          }

          /* Responsive Design */
          @media (max-width: 768px) {
            .container {
              padding: 16px;
            }
            
            .header {
              padding: 16px;
            }
            
            .card {
              padding: 16px;
            }
            
            .card-header {
              flex-direction: column;
              align-items: flex-start;
              gap: 12px;
            }
            
            .button-group {
              width: 100%;
            }
            
            .button {
              flex: 1;
            }
          }
        </style>
      </head>
      <body>
        <!-- Header -->
        <div class="header">
          <div class="header-content">
            <h1>${data.application?.domain || 'Application Details'}</h1>
            <p>CloudHub 1.0 Application Dashboard</p>
          </div>
        </div>

        <!-- Main Content -->
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