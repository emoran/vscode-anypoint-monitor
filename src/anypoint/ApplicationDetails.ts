import * as vscode from 'vscode';
import * as fs from 'fs';
// If you need fetch in Node, you might need node-fetch or axios. E.g.:
// import fetch from 'node-fetch';

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
    if (value === 'RUNNING' || value ==='STARTED') return '🟢 RUNNING';
    if (['STOPPED', 'UNDEPLOYED', 'STARTED'].includes(value)) {
      return '🔴 ' + value;
    }
  }
  return value ?? '';
}

/**
 * Builds the Application Information table,
 * with Stop/Start/Restart buttons.
 */
function buildSingleApplicationTable(app: any): string {
  if (!app || Object.keys(app).length === 0) {
    return `
      <div class="box">
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
    <div class="box">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <h2 style="margin: 0;">Application Information</h2>
        <div style="display:flex; gap:0.5rem;">
          <button id="btnStopApp" class="button">Stop Application</button>
          <button id="btnStartApp" class="button">Start Application</button>
          <button id="btnRestartApp" class="button">Restart Application</button>
        </div>
      </div>
      <div class="table-container" style="margin-top: 0.75rem;">
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

/** Build schedulers table (unchanged). */
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
    <div class="box">
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
      if (
        k === 'status' &&
        ['STOPPED', 'UNDEPLOYED', 'STARTED'].includes(val)
      ) {
        val = '🔴 ' + val;
      }
      return `"${String(val).replace(/"/g, '""')}"`;
    })
    .join(',');
  return [header, row].join('\n');
}

/**
 * Helper to update the application status via CloudHub API.
 * status can be "stop" | "start" | "restart".
 */
async function updateApplicationStatus(
  applicationName: string,
  status: 'stop' | 'start' | 'restart',
  envId: string,       // e.g. environment ID
  authToken: string
): Promise<void> {
  const url = `https://anypoint.mulesoft.com/cloudhub/api/applications/${applicationName}/status`;
  const body = JSON.stringify({ status });
  
  // If you don't have a global fetch, you might do `const fetch = require('node-fetch')` up top.
  // Or use axios. Example with fetch:
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${authToken}`,
      'content-type': 'application/json',
      'x-anypnt-env-id': envId
    },
    body
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Failed to update app status: ${resp.status} ${resp.statusText} => ${txt}`);
  }
}

/**
 * Show the dashboard webview. The webview includes "Stop", "Start", and "Restart" buttons,
 * which call this endpoint with {status:"stop"|"start"|"restart"} in the body.
 */
export async function showDashboardWebview(
  context: vscode.ExtensionContext,
  domain: string,
  data: any,
  environment: string
) {
  // Suppose we store environment ID and token somewhere. 
  // Example: context.secrets, or data.envId, data.token, etc.
  const envId = environment;  // or retrieve from secrets

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
    }
    else if (message.command === 'stopApp') {
      // Call the status endpoint with {"status":"stop"}
      try {

        let accessToken = await context.secrets.get('anypoint.accessToken');
        if (!accessToken) {
          throw new Error('No access token found. Please log in first.');
        }
        await updateApplicationStatus(domain, 'stop', envId, accessToken);
        vscode.window.showInformationMessage(`Application ${domain} is being stopped...`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to stop app: ${err.message}`);
      }
    }
    else if (message.command === 'startApp') {
      // Call the status endpoint with {"status":"start"}
      try {

        let accessToken = await context.secrets.get('anypoint.accessToken');
        if (!accessToken) {
          throw new Error('No access token found. Please log in first.');
        }

        await updateApplicationStatus(domain, 'start', envId, accessToken);
        vscode.window.showInformationMessage(`Application ${domain} is being started...`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to start app: ${err.message}`);
      }
    }
    else if (message.command === 'restartApp') {
      // Call the status endpoint with {"status":"restart"}
      try {

        let accessToken = await context.secrets.get('anypoint.accessToken');
        if (!accessToken) {
          throw new Error('No access token found. Please log in first.');
        }

        await updateApplicationStatus(domain, 'restart', envId, accessToken);
        vscode.window.showInformationMessage(`Application ${domain} is being restarted...`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to restart app: ${err.message}`);
      }
    }
  });
}

/** Return the HTML for the webview */
function getDashboardHtml(
  data: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // Build application, schedulers, alerts, logs
  const applicationHtml = buildSingleApplicationTable(data.application);
  const schedulersHtml = buildSchedulersTable(data.schedulers);
  const alertsHtml = `
    <div class="box">
      <h2>Alerts</h2>
      <p>${JSON.stringify(data.alerts)}</p>
    </div>
  `;
  const logsHtml = `
    <div class="box logs-box">
      <h2>Logs</h2>
      <div style="margin-bottom: 0.5rem;">
        <input 
          id="logFilter" 
          type="text" 
          placeholder="Filter logs by text..." 
          style="width: 250px; padding: 4px;"
        />
      </div>
      <div class="table-container" style="max-height: 300px; overflow-y:auto;">
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

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Anypoint Monitor Dashboard</title>
        <style>
          body {
            margin: 0; padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
              Helvetica, Arial, sans-serif;
            color: #212529; background-color: #ffffff;
          }
          .navbar {
            display: flex; align-items: center; justify-content: space-between;
            background-color: #1f2b3c; padding: 0.75rem 1rem;
          }
          .navbar-left { display: flex; align-items: center; gap: 1rem; }
          .navbar-left img { height: 32px; width: auto; }
          .navbar-left h1 { color: #fff; font-size: 1.25rem; margin:0; }
          .navbar-right { display: flex; gap:1.5rem; }
          .navbar-right a { color: #fff; text-decoration:none; font-weight:500; font-size:0.9rem; }
          .navbar-right a:hover { text-decoration:underline; }
          .container { max-width:1400px; margin:0 auto; padding:1rem; }
          .button {
            padding: 6px 10px; font-size: 0.8rem; color: #fff;
            background-color: #52667a; border:none; border-radius:4px;
            cursor:pointer; text-decoration:none;
          }
          .button:hover { background-color:#435362; }
          .dashboard-grid {
            display:grid; grid-template-columns:1fr 1fr; gap:1rem;
          }
          .box {
            background-color:#fafafa; border:1px solid #e2e2e2;
            border-radius:4px; padding:1rem;
          }
          .box h2 {
            margin-top:0; font-size:1.1rem; margin-bottom:0.75rem;
          }
          .table-container {
            width:100%; overflow-x:auto;
          }
          .app-table {
            border-collapse:collapse; width:100%; background-color:#fff;
            box-shadow:0 0 5px rgba(0,0,0,0.15); font-size:0.75rem;
          }
          .app-table th, .app-table td {
            padding:6px; border-bottom:1px solid #e2e2e2;
            text-align:left; vertical-align:top; font-size:0.71rem;
          }
          .app-table th {
            background-color:#f4f4f4; font-weight:600; white-space:nowrap;
          }
          .app-table tr:hover { background-color:#f9f9f9; }
          .logs-table {
            border-collapse:collapse; width:100%; background-color:#fff;
            box-shadow:0 0 5px rgba(0,0,0,0.15); font-size:0.75rem;
            font-family:"Courier New", Courier, monospace;
          }
          .logs-table th, .logs-table td {
            padding:6px; border-bottom:1px solid #e2e2e2;
            text-align:left; vertical-align:top;
          }
          .logs-table th {
            background-color:#f4f4f4; font-weight:600; white-space:nowrap;
          }
          .logs-table tr:hover { background-color:#f9f9f9; }
          .logs-box .table-container {
            /* max-height:300px => set in inline style above. */
          }
        </style>
      </head>
      <body>
        <!-- Top Navbar -->
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

        <div class="container">
          <!-- 2-col layout for Application & Schedulers/Alerts -->
          <div class="dashboard-grid">
            <div class="left-column">
              ${applicationHtml}
            </div>
            <div class="right-column">
              ${schedulersHtml}
              ${alertsHtml}
            </div>
          </div>

          <!-- Full width logs -->
          ${logsHtml}
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          // CSV download
          const csvBtn = document.getElementById('downloadCsv');
          if (csvBtn) {
            csvBtn.addEventListener('click', () => {
              vscode.postMessage({ command: 'downloadCsv' });
            });
          }

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
          const stopBtn = document.getElementById('btnStopApp');
          stopBtn?.addEventListener('click', () => {
            vscode.postMessage({ command: 'stopApp' });
          });
          const startBtn = document.getElementById('btnStartApp');
          startBtn?.addEventListener('click', () => {
            vscode.postMessage({ command: 'startApp' });
          });
          const restartBtn = document.getElementById('btnRestartApp');
          restartBtn?.addEventListener('click', () => {
            vscode.postMessage({ command: 'restartApp' });
          });
        </script>
      </body>
    </html>
  `;
}
