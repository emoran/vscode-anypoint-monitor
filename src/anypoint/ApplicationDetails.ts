import * as vscode from 'vscode';
import * as fs from 'fs';
import { ApiHelper } from '../controllers/apiHelper.js';
import { telemetryService } from '../services/telemetryService';
import { wrapWebviewHtml, badge, button as uiButton } from '../webview/ui-kit';

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
  apiHelper: ApiHelper,
  context?: vscode.ExtensionContext
): Promise<void> {
  const { getBaseUrl } = await import('../constants.js');
  const baseUrl = context ? await getBaseUrl(context) : 'https://anypoint.mulesoft.com';
  const url = `${baseUrl}/cloudhub/api/applications/${applicationName}/status`;
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
  telemetryService.trackPageView('applicationDashboard');
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

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div>
          <h1>${data.application?.domain || 'Application Details'}</h1>
          <div class="am-page-header-meta">
            ${badge('CloudHub 1.0', 'info', true)}
          </div>
        </div>
      </div>

      <div class="ch1d-tabs">
        <nav class="ch1d-tab-header">
          <button data-tab="app-info" class="ch1d-tab-btn active">Application Info</button>
          <button data-tab="schedulers" class="ch1d-tab-btn">Schedulers</button>
          <button data-tab="alerts" class="ch1d-tab-btn">Alerts</button>
          <button data-tab="logs" class="ch1d-tab-btn">Logs</button>
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
    </div>`;

  const scripts = `
    const vscode = acquireVsCodeApi();

    document.querySelectorAll('.ch1d-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ch1d-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
      });
    });

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
      const si = (currentPage - 1) * pageSize;
      const pageLogs = filteredLogs.slice(si, si + pageSize);
      logsTbody.innerHTML = pageLogs.map(log => {
        const dateStr = new Date(log.timestamp).toISOString();
        const msg = (log.message || '').replace(/\\n/g, '<br/>');
        return \`<tr><td>\${dateStr}</td><td>\${log.priority || ''}</td><td>\${msg}</td></tr>\`;
      }).join('');
      const totalPages = Math.ceil(filteredLogs.length / pageSize);
      logsPageInfo.textContent = \`Page \${currentPage} of \${totalPages}\`;
      logsPrev.disabled = (currentPage <= 1);
      logsNext.disabled = (currentPage >= totalPages);
    }

    function applyLogFilter() {
      const term = (logFilter.value || '').toLowerCase();
      filteredLogs = logsData.filter(log => {
        return [log.threadName, log.priority, log.message].join(' ').toLowerCase().includes(term);
      });
      currentPage = 1;
      renderLogsTable();
    }

    logsPrev?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderLogsTable(); } });
    logsNext?.addEventListener('click', () => {
      if (currentPage < Math.ceil(filteredLogs.length / pageSize)) { currentPage++; renderLogsTable(); }
    });
    logFilter?.addEventListener('input', applyLogFilter);
    renderLogsTable();

    document.getElementById('btnStopApp')?.addEventListener('click', () => vscode.postMessage({ command: 'stopApp' }));
    document.getElementById('btnStartApp')?.addEventListener('click', () => vscode.postMessage({ command: 'startApp' }));
    document.getElementById('btnRestartApp')?.addEventListener('click', () => vscode.postMessage({ command: 'restartApp' }));
    document.getElementById('btnDownloadLogs')?.addEventListener('click', () => vscode.postMessage({ command: 'downloadLogs' }));
  `;

  return wrapWebviewHtml({
    title: 'Anypoint Monitor Dashboard',
    body,
    scripts,
    extraStyles: `
      .ch1d-tabs { margin-top: 16px; }
      .ch1d-tab-header {
        display: flex; gap: 8px; margin-bottom: 24px;
        border-bottom: 1px solid var(--am-border); padding-bottom: 12px;
      }
      .ch1d-tab-btn {
        background: transparent; color: var(--am-text-muted);
        border: 1px solid var(--am-border); border-radius: var(--am-radius-sm);
        padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 500;
        transition: all 0.2s; font-family: inherit;
      }
      .ch1d-tab-btn.active {
        background: var(--am-btn-bg); color: var(--am-btn-fg);
        border-color: var(--am-btn-bg);
      }
      .ch1d-tab-btn:hover:not(.active) {
        background: var(--am-bg-surface-hover); color: var(--am-text-primary);
      }
      .tab-content { display: none; }
      .tab-content.active { display: block; }
      .card {
        background: var(--am-bg-surface); border: 1px solid var(--am-border);
        border-radius: var(--am-radius-md); padding: 24px; margin-bottom: 24px;
      }
      .card-header {
        display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;
      }
      .card-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
      .button-group { display: flex; gap: 8px; }
      .button {
        padding: 8px 16px; font-size: 13px; font-weight: 500;
        color: var(--am-btn-fg); background: var(--am-btn-bg);
        border: none; border-radius: var(--am-radius-sm); cursor: pointer;
      }
      .button:hover { background: var(--am-btn-hover); }
      .table-container {
        width: 100%; overflow-x: auto; border-radius: var(--am-radius-md);
        border: 1px solid var(--am-border);
      }
      table { border-collapse: collapse; width: 100%; }
      th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--am-border); }
      th { background: var(--am-bg-secondary); color: var(--am-text-muted); font-size: 12px; font-weight: 600; }
      td { font-size: 13px; }
      tr:hover { background: var(--am-bg-surface-hover); }
      .logs-table { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
      input[type="text"] {
        background: var(--am-bg-secondary); border: 1px solid var(--am-border);
        border-radius: var(--am-radius-sm); padding: 6px 12px;
        color: var(--am-text-primary); font-size: 13px;
      }
      input[type="text"]:focus { outline: none; border-color: var(--am-accent); }
      details { margin-top: 12px; }
      summary { cursor: pointer; font-weight: 500; color: var(--am-accent); padding: 8px 0; }
      summary:hover { filter: brightness(1.15); }
    `
  });
}
