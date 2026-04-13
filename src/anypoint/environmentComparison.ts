import * as vscode from 'vscode';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    summaryCard,
    badge,
    button,
    escapeHtml as uiEscapeHtml,
    escapeAttr
} from '../webview/ui-kit';

export async function showEnvironmentComparisonWebview(
  context: vscode.ExtensionContext,
  comparisonData: any
) {
  telemetryService.trackPageView('environmentComparison');
  const panel = vscode.window.createWebviewPanel(
    'environmentComparison',
    'Environment Comparison Table',
    vscode.ViewColumn.One,
    { 
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  panel.onDidDispose(() => {
    // Panel disposed - cleanup if needed
  });

  panel.webview.html = getEnvironmentComparisonHtml(comparisonData, panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      switch (message.command) {
        case 'exportData':
          await exportEnvironmentComparisonData(comparisonData);
          break;
        case 'refreshData':
          vscode.commands.executeCommand('anypoint-monitor.environmentComparison');
          break;
      }
    } catch (error: any) {
      console.error('Error handling webview message:', error);
      vscode.window.showErrorMessage(`Error: ${error.message}`);
    }
  });
}

function renderBooleanField(label: string, value: any): string {
  if (value === 'N/A' || value === undefined) { return ''; }
  const boolValue = value === true || value === 'true';
  const variant = boolValue ? 'success' : 'error';
  const displayValue = boolValue ? 'YES' : 'NO';
  return `
    <div class="ec-detail-row">
      <span class="ec-detail-label">${uiEscapeHtml(label)}:</span>
      ${badge(displayValue, variant)}
    </div>
  `;
}

function formatDate(dateString: string): string {
  if (!dateString || dateString === 'N/A') { return 'N/A'; }
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return dateString;
  }
}

function generateComparisonBadges(app: any, environments: any[]): string[] {
  const badges: string[] = [];
  const deployments = Object.values(app.environments) as any[];
  
  if (deployments.length < 2) { return badges; }
  
  const versions = [...new Set(deployments.map(d => d.version))];
  if (versions.length > 1) { badges.push('version-diff'); }
  
  const runtimes = [...new Set(deployments.map(d => d.runtime))];
  if (runtimes.length > 1) { badges.push('config-diff'); }
  
  if (app.type === 'CH1') {
    const workers = [...new Set(deployments.map(d => d.workers))];
    const workerTypes = [...new Set(deployments.map(d => d.workerType))];
    if (workers.length > 1 || workerTypes.length > 1) { badges.push('resource-diff'); }
    
    const configs = ['monitoringEnabled', 'objectStoreV1', 'persistentQueues', 'autoRestart'];
    for (const config of configs) {
      const values = [...new Set(deployments.map(d => d[config]))];
      if (values.length > 1) { badges.push('config-diff'); }
    }
  } else if (app.type === 'CH2') {
    const replicas = [...new Set(deployments.map(d => d.replicas))];
    const cpus = [...new Set(deployments.map(d => d.cpuReserved))];
    const memories = [...new Set(deployments.map(d => d.memoryReserved))];
    if (replicas.length > 1 || cpus.length > 1 || memories.length > 1) { badges.push('resource-diff'); }
  }
  
  return [...new Set(badges)];
}

function getEnvBadge(env: any): { label: string; cls: string } {
    const envType = (env.type || '').toLowerCase();
    const envName = (env.name || '').toLowerCase();

    if (envType.includes('prod') || envName.includes('prod') || envName.includes('prd')) {
        return { label: 'PRD', cls: 'ec-env-badge-prod' };
    }
    if (envType.includes('qa') || envName.includes('qa') || envName.includes('qua') || envName.includes('quality')) {
        return { label: 'QA', cls: 'ec-env-badge-qa' };
    }
    if (envType.includes('uat') || envName.includes('uat')) {
        return { label: 'UAT', cls: 'ec-env-badge-uat' };
    }
    if (envType.includes('stag') || envName.includes('stag') || envName.includes('stg')) {
        return { label: 'STG', cls: 'ec-env-badge-stage' };
    }
    if (envType.includes('sandbox') || envType.includes('dev') || envName.includes('dev') || envName.includes('sandbox')) {
        return { label: 'DEV', cls: 'ec-env-badge-dev' };
    }
    if (envType.includes('test') || envName.includes('test')) {
        return { label: 'TST', cls: 'ec-env-badge-test' };
    }
    return { label: '', cls: '' };
}

function getEnvironmentComparisonHtml(
  comparisonData: any,
  _webview: vscode.Webview,
  _extensionUri: vscode.Uri
): string {
  const applications = Object.values(comparisonData.applications) as any[];
  const environments = comparisonData.environments || [];

  const summaryCards = `
    <div class="am-summary-cards">
        ${summaryCard({ icon: '📦', value: applications.length, label: 'Total Applications', animationDelay: '0.1s' })}
        ${summaryCard({ icon: '🌐', value: environments.length, label: 'Environments', animationDelay: '0.15s' })}
        ${summaryCard({ icon: '☁️', value: applications.filter((app: any) => app.type === 'CH1').length, label: 'CloudHub 1.0', variant: 'default', animationDelay: '0.2s' })}
        ${summaryCard({ icon: '⚡', value: applications.filter((app: any) => app.type === 'CH2').length, label: 'CloudHub 2.0', variant: 'default', animationDelay: '0.25s' })}
    </div>
    <div style="margin-bottom: 16px; font-size: 12px; color: var(--am-text-muted); font-style: italic;">
        Design environment excluded from comparison (used for API design, not deployments)
    </div>`;

  const filtersBar = `
    <div class="am-filters">
        <select class="am-select" id="statusFilter">
            <option value="all">All Statuses</option>
            <option value="version-diff">Version Differences</option>
            <option value="config-diff">Config Differences</option>
            <option value="running">Running Only</option>
            <option value="stopped">Stopped Only</option>
        </select>
        <select class="am-select" id="platformFilter">
            <option value="all">All Platforms</option>
            <option value="CH1">CloudHub 1.0</option>
            <option value="CH2">CloudHub 2.0</option>
        </select>
        <label class="ec-filter-label">
            <input type="checkbox" id="showAdvanced" checked> Show Advanced
        </label>
        <label class="ec-filter-label">
            <input type="checkbox" id="highlightDifferences" checked> Highlight Differences
        </label>
        ${button('Name Matching Help', { variant: 'ghost', onclick: 'showNameMatchingHelp()', icon: '📋' })}
    </div>`;

  const envHeaders = environments.map((env: any) => {
    const { label, cls } = getEnvBadge(env);
    return `<th class="ec-env-cell">
        <div class="ec-env-header">
            <span class="ec-env-name">${uiEscapeHtml(env.name || 'Unknown')}</span>
            ${label ? `<span class="ec-env-badge ${cls}">${uiEscapeHtml(label)}</span>` : ''}
        </div>
    </th>`;
  }).join('');

  const tableRows = applications.map((app: any) => {
    const badges = generateComparisonBadges(app, environments);

    const badgesHtml = badges.map(b => {
        const variant = b === 'version-diff' ? 'error' : b === 'config-diff' ? 'warning' : 'info';
        return badge(b.replace('-', ' ').toUpperCase(), variant);
    }).join(' ');

    const envCells = environments.map((env: any) => {
        const deployment = app.environments[env.id];
        if (!deployment) {
            return `<td class="ec-env-cell"><div class="ec-no-deployment">Not deployed</div></td>`;
        }

        const statusCls = getStatusClass(deployment.status);

        let ch1Fields = '';
        let ch2Fields = '';

        if (app.type === 'CH1') {
            ch1Fields = `
                <div class="ec-detail-row">
                    <span class="ec-detail-label">Artifact:</span>
                    <span class="ec-detail-value">${uiEscapeHtml(String(deployment.filename || 'N/A'))}</span>
                </div>
                <div class="ec-detail-row">
                    <span class="ec-detail-label">Region:</span>
                    <span class="ec-detail-value">${uiEscapeHtml(String(deployment.region || 'N/A'))}</span>
                </div>
                <div class="ec-detail-row">
                    <span class="ec-detail-label">Workers:</span>
                    <span class="ec-detail-value">${uiEscapeHtml(String(deployment.workers))} × ${uiEscapeHtml(String(deployment.workerType))}</span>
                </div>
                ${deployment.fullDomain !== 'N/A' ? `
                    <div class="ec-detail-row">
                        <span class="ec-detail-label">URL:</span>
                        <a href="https://${escapeAttr(String(deployment.fullDomain))}" target="_blank" class="ec-url-link">${uiEscapeHtml(String(deployment.fullDomain))}</a>
                    </div>
                ` : ''}
                <div class="ec-advanced-details" style="display: block;">
                    <button class="ec-toggle-advanced" onclick="toggleAdvanced(this)">▼ Advanced Settings</button>
                    <div class="ec-advanced-content" style="display: none;">
                        ${renderBooleanField('Monitoring', deployment.monitoringEnabled)}
                        ${renderBooleanField('ObjectStore V1', deployment.objectStoreV1)}
                        ${renderBooleanField('Persistent Queues', deployment.persistentQueues)}
                        ${renderBooleanField('Multiple Workers', deployment.multipleWorkers)}
                        ${renderBooleanField('Auto Restart', deployment.autoRestart)}
                        ${renderBooleanField('Static IPs', deployment.staticIPsEnabled)}
                        ${renderBooleanField('Secure Data Gateway', deployment.secureDataGateway)}
                        ${renderBooleanField('VPN', deployment.vpn)}
                        <div class="ec-detail-row">
                            <span class="ec-detail-label">Properties:</span>
                            <span class="ec-detail-value">${uiEscapeHtml(String(deployment.propertiesCount))} configured</span>
                        </div>
                        ${deployment.applicationSize !== 'N/A' ? `
                            <div class="ec-detail-row">
                                <span class="ec-detail-label">App Size:</span>
                                <span class="ec-detail-value">${uiEscapeHtml(String(deployment.applicationSize))}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>`;
        } else {
            ch2Fields = `
                <div class="ec-detail-row">
                    <span class="ec-detail-label">Replicas:</span>
                    <span class="ec-detail-value">${uiEscapeHtml(String(deployment.replicas))}</span>
                </div>
                <div class="ec-detail-row">
                    <span class="ec-detail-label">Resources:</span>
                    <span class="ec-detail-value">${uiEscapeHtml(String(deployment.cpuReserved))} CPU, ${uiEscapeHtml(String(deployment.memoryReserved))} MB</span>
                </div>
                ${deployment.filename !== 'N/A' ? `
                    <div class="ec-detail-row">
                        <span class="ec-detail-label">Artifact:</span>
                        <span class="ec-detail-value">${uiEscapeHtml(String(deployment.filename))}</span>
                    </div>
                ` : ''}
                ${deployment.creationDate !== 'N/A' ? `
                    <div class="ec-detail-row">
                        <span class="ec-detail-label">Created:</span>
                        <span class="ec-detail-value">${uiEscapeHtml(formatDate(deployment.creationDate))}</span>
                    </div>
                ` : ''}
                <div class="ec-advanced-details" style="display: block;">
                    <button class="ec-toggle-advanced" onclick="toggleAdvanced(this)">▼ Advanced Settings</button>
                    <div class="ec-advanced-content" style="display: none;">
                        ${deployment.autoScalingEnabled !== 'N/A' ? `
                            ${renderBooleanField('Auto Scaling', deployment.autoScalingEnabled)}
                            <div class="ec-detail-row">
                                <span class="ec-detail-label">Scaling Range:</span>
                                <span class="ec-detail-value">${uiEscapeHtml(String(deployment.minReplicas))} - ${uiEscapeHtml(String(deployment.maxReplicas))} replicas</span>
                            </div>
                        ` : ''}
                        ${deployment.cpuLimit !== 'N/A' ? `<div class="ec-detail-row"><span class="ec-detail-label">CPU Limit:</span><span class="ec-detail-value">${uiEscapeHtml(String(deployment.cpuLimit))}</span></div>` : ''}
                        ${deployment.memoryLimit !== 'N/A' ? `<div class="ec-detail-row"><span class="ec-detail-label">Memory Limit:</span><span class="ec-detail-value">${uiEscapeHtml(String(deployment.memoryLimit))}</span></div>` : ''}
                        ${deployment.networkType !== 'N/A' ? `<div class="ec-detail-row"><span class="ec-detail-label">Network:</span><span class="ec-detail-value">${uiEscapeHtml(String(deployment.networkType))}</span></div>` : ''}
                        ${renderBooleanField('Public Endpoints', deployment.publicEndpoints)}
                        ${renderBooleanField('Persistent Storage', deployment.persistentStorage)}
                        ${renderBooleanField('Clustered', deployment.clustered)}
                        ${renderBooleanField('Monitoring', deployment.monitoring)}
                        ${deployment.javaVersion !== 'N/A' ? `<div class="ec-detail-row"><span class="ec-detail-label">Java Version:</span><span class="ec-detail-value">${uiEscapeHtml(String(deployment.javaVersion))}</span></div>` : ''}
                        ${deployment.updateStrategy !== 'N/A' ? `<div class="ec-detail-row"><span class="ec-detail-label">Update Strategy:</span><span class="ec-detail-value">${uiEscapeHtml(String(deployment.updateStrategy))}</span></div>` : ''}
                    </div>
                </div>`;
        }

        return `
            <td class="ec-env-cell">
                <div class="ec-env-details">
                    <div class="ec-detail-row">
                        <span class="ec-detail-label">Status:</span>
                        <span class="ec-status-badge ${statusCls}">${uiEscapeHtml(String(deployment.status))}</span>
                    </div>
                    <div class="ec-detail-row">
                        <span class="ec-detail-label">Version:</span>
                        <span class="ec-version-highlight">${uiEscapeHtml(String(deployment.version))}</span>
                    </div>
                    <div class="ec-detail-row">
                        <span class="ec-detail-label">Runtime:</span>
                        <span class="ec-detail-value">${uiEscapeHtml(String(deployment.runtime))}</span>
                    </div>
                    ${app.type === 'CH1' ? ch1Fields : ch2Fields}
                </div>
            </td>`;
    }).join('');

    return `
        <tr class="ec-app-row" data-app-type="${escapeAttr(String(app.type))}" data-badges="${escapeAttr(badges.join(','))}">
            <td>
                <div class="ec-app-info">
                    <div class="ec-app-name">
                        ${uiEscapeHtml(String(app.name))}
                        <span class="ec-badge-group">${badgesHtml}</span>
                    </div>
                    ${badge(String(app.type), 'info')}
                    ${app.originalNames && app.originalNames.length > 1 ? `
                        <div class="ec-original-names">
                            <small title="Original application names across environments">
                                ${uiEscapeHtml(app.originalNames.join(', '))}
                            </small>
                        </div>
                    ` : ''}
                </div>
            </td>
            ${envCells}
        </tr>`;
  }).join('');

  const body = `
    <div class="am-container">
        <div class="am-page-header">
            <div>
                <h1>Environment Comparison Table</h1>
            </div>
            <div class="am-page-header-right">
                ${button('Refresh', { variant: 'ghost', onclick: 'refreshData()', icon: '🔄' })}
                ${button('Export', { variant: 'primary', onclick: 'exportData()', icon: '📊' })}
            </div>
        </div>

        ${summaryCards}
        ${filtersBar}

        <div class="ec-table-container">
            <table class="ec-table">
                <thead>
                    <tr>
                        <th>Application Name</th>
                        ${envHeaders}
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    </div>`;

  const scripts = `
    const vscode = acquireVsCodeApi();

    function refreshData() { vscode.postMessage({ command: 'refreshData' }); }
    function exportData() { vscode.postMessage({ command: 'exportData' }); }

    function toggleAdvanced(button) {
        const content = button.nextElementSibling;
        if (!content) return;
        const isVisible = content.style.display !== 'none';
        content.style.display = isVisible ? 'none' : 'block';
        button.textContent = isVisible ? '\\u25b6 Advanced Settings' : '\\u25bc Advanced Settings';
    }

    function applyFilters() {
        const statusFilter = document.getElementById('statusFilter').value;
        const platformFilter = document.getElementById('platformFilter').value;
        const rows = document.querySelectorAll('.ec-app-row');

        rows.forEach(row => {
            let show = true;
            if (platformFilter !== 'all' && row.getAttribute('data-app-type') !== platformFilter) show = false;
            if (statusFilter !== 'all') {
                const badges = row.getAttribute('data-badges').split(',');
                switch (statusFilter) {
                    case 'version-diff': if (!badges.includes('version-diff')) show = false; break;
                    case 'config-diff': if (!badges.includes('config-diff')) show = false; break;
                    case 'running': {
                        const s = row.querySelectorAll('.ec-status-badge');
                        if (![...s].some(b => b.textContent.toLowerCase().includes('running') || b.textContent.toLowerCase().includes('started'))) show = false;
                        break;
                    }
                    case 'stopped': {
                        const s = row.querySelectorAll('.ec-status-badge');
                        if (![...s].some(b => b.textContent.toLowerCase().includes('stopped') || b.textContent.toLowerCase().includes('undeployed'))) show = false;
                        break;
                    }
                }
            }
            row.style.display = show ? '' : 'none';
        });
    }

    function toggleAdvancedDisplay() {
        const checkbox = document.getElementById('showAdvanced');
        if (!checkbox) return;
        document.querySelectorAll('.ec-advanced-details').forEach(section => {
            section.style.display = checkbox.checked ? 'block' : 'none';
        });
    }

    function toggleHighlightDifferences() {
        const highlight = document.getElementById('highlightDifferences').checked;
        document.querySelectorAll('.ec-badge-group .am-badge').forEach(b => {
            b.style.display = highlight ? 'inline-flex' : 'none';
        });
    }

    function showNameMatchingHelp() {
        const modal = document.createElement('div');
        modal.className = 'ec-modal-overlay';
        const content = document.createElement('div');
        content.className = 'ec-modal-content';
        content.innerHTML = \`
            <h3>Intelligent Application Name Matching</h3>
            <p>This feature automatically groups applications with similar names across environments:</p>
            <h4>Supported Patterns:</h4>
            <ul>
                <li><strong>Environment Suffixes:</strong> myapp-dev, myapp-qa, myapp-prod</li>
                <li><strong>Environment Prefixes:</strong> dev-myapp, qa-myapp, prod-myapp</li>
                <li><strong>Complex Names:</strong> fabe-loyalty-program-exapi-sandbox → fabe-loyalty-program-exapi-prod</li>
                <li><strong>Abbreviations:</strong> myapp-stg, myapp-prd, myapp-sbx</li>
            </ul>
            <h4>Recognized Environment Keywords:</h4>
            <p><code>dev, develop, development, test, testing, qa, quality, uat, stage, staging, prod, production, sandbox, demo, preview, integration, sit, perf, performance</code></p>
            <div style="text-align: right; margin-top: 20px;">
                <button class="am-btn am-btn-primary" onclick="this.closest('.ec-modal-overlay').remove()">Close</button>
            </div>
        \`;
        modal.appendChild(content);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }

    document.addEventListener('DOMContentLoaded', function() {
        document.getElementById('statusFilter').addEventListener('change', applyFilters);
        document.getElementById('platformFilter').addEventListener('change', applyFilters);
        document.getElementById('showAdvanced').addEventListener('change', toggleAdvancedDisplay);
        document.getElementById('highlightDifferences').addEventListener('change', toggleHighlightDifferences);
        applyFilters();
    });
  `;

  return wrapWebviewHtml({
    title: 'Environment Comparison Table',
    body,
    scripts,
    extraStyles: getEnvironmentComparisonStyles()
  });
}

function getStatusClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s.includes('started') || s.includes('running') || s.includes('applied')) { return 'ec-status-started'; }
    if (s.includes('stopped') || s.includes('failed')) { return 'ec-status-stopped'; }
    if (s.includes('undeployed')) { return 'ec-status-undeployed'; }
    if (s.includes('deployed')) { return 'ec-status-deployed'; }
    if (s.includes('updating')) { return 'ec-status-updating'; }
    return '';
}

function getEnvironmentComparisonStyles(): string {
    return `
        .ec-table-container {
            overflow: auto;
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-lg);
            background: var(--am-bg-surface);
            max-height: calc(100vh - 360px);
            position: relative;
        }
        .ec-table { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 800px; }
        .ec-table th, .ec-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid var(--am-border);
            vertical-align: top;
        }
        .ec-table thead { position: sticky; top: 0; z-index: 10; }
        .ec-table th {
            background: var(--am-bg-secondary);
            color: var(--am-text-primary);
            font-weight: 600;
            border-bottom: 2px solid var(--am-border);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .ec-table th:first-child {
            position: sticky; left: 0; z-index: 12;
            background: var(--am-bg-secondary);
            border-right: 1px solid var(--am-border);
            min-width: 200px;
        }
        .ec-table td:first-child {
            position: sticky; left: 0; z-index: 5;
            background: var(--am-bg-surface);
            font-weight: 500;
            border-right: 1px solid var(--am-border);
            min-width: 200px;
        }
        .ec-env-cell { min-width: 200px; }
        .ec-env-header { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .ec-env-name { font-weight: 600; font-size: 13px; }
        .ec-env-badge {
            display: inline-block; padding: 2px 8px; border-radius: var(--am-radius-pill);
            font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .ec-env-badge-prod { background: var(--am-error); color: #fff; }
        .ec-env-badge-qa { background: color-mix(in srgb, var(--am-warning) 85%, #000); color: #fff; }
        .ec-env-badge-uat { background: #6f42c1; color: #fff; }
        .ec-env-badge-stage { background: #17a2b8; color: #fff; }
        .ec-env-badge-dev { background: var(--am-success); color: #fff; }
        .ec-env-badge-test { background: var(--am-text-muted); color: #fff; }

        .ec-env-details { display: flex; flex-direction: column; gap: 6px; }
        .ec-detail-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
        .ec-detail-label { color: var(--am-text-secondary); font-weight: 500; }
        .ec-detail-value { color: var(--am-text-primary); }

        .ec-status-badge {
            display: inline-block; padding: 4px 8px; border-radius: var(--am-radius-pill);
            font-size: 11px; font-weight: 500; text-transform: uppercase;
        }
        .ec-status-started { background: color-mix(in srgb, var(--am-success) 15%, transparent); color: var(--am-success); }
        .ec-status-stopped { background: color-mix(in srgb, var(--am-error) 15%, transparent); color: var(--am-error); }
        .ec-status-undeployed { background: color-mix(in srgb, var(--am-text-muted) 15%, transparent); color: var(--am-text-muted); }
        .ec-status-deployed { background: color-mix(in srgb, var(--am-info) 15%, transparent); color: var(--am-info); }
        .ec-status-updating { background: color-mix(in srgb, var(--am-warning) 15%, transparent); color: var(--am-warning); }

        .ec-version-highlight {
            background: color-mix(in srgb, var(--am-info) 10%, transparent);
            padding: 2px 6px; border-radius: var(--am-radius-sm); font-weight: 600;
        }
        .ec-no-deployment { color: var(--am-text-muted); font-style: italic; text-align: center; padding: 20px; }

        .ec-app-info { display: flex; flex-direction: column; gap: 4px; }
        .ec-app-name { font-weight: 600; color: var(--am-text-primary); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .ec-badge-group { display: inline-flex; gap: 4px; flex-wrap: wrap; }
        .ec-original-names { margin-top: 4px; color: var(--am-text-muted); font-size: 10px; font-style: italic; word-break: break-all; }

        .ec-url-link { color: var(--am-text-link); text-decoration: none; font-size: 11px; }
        .ec-url-link:hover { text-decoration: underline; }

        .ec-advanced-details { margin-top: 8px; border-top: 1px solid var(--am-border); padding-top: 8px; }
        .ec-toggle-advanced {
            background: none; border: none; color: var(--am-text-primary);
            cursor: pointer; font-size: 11px; text-decoration: underline; padding: 2px 0; margin-top: 4px;
        }
        .ec-toggle-advanced:hover { color: var(--am-text-link); }
        .ec-advanced-content { margin-top: 6px; }

        .ec-filter-label {
            display: inline-flex; align-items: center; gap: 5px;
            font-size: 12px; color: var(--am-text-secondary); font-weight: 500; cursor: pointer;
        }

        .ec-app-row:hover td { background: var(--am-bg-surface-hover); }
        .ec-app-row:hover td:first-child { background: var(--am-bg-surface-hover); }

        .ec-modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 1000;
            display: flex; align-items: center; justify-content: center;
        }
        .ec-modal-content {
            background: var(--am-bg-surface); padding: 24px; border-radius: var(--am-radius-lg);
            max-width: 600px; max-height: 80vh; overflow-y: auto;
            border: 1px solid var(--am-border); color: var(--am-text-primary);
            box-shadow: var(--am-shadow-lg);
        }
        .ec-modal-content h3 { font-size: 16px; margin-bottom: 12px; }
        .ec-modal-content h4 { font-size: 13px; margin: 12px 0 6px; color: var(--am-text-secondary); }
        .ec-modal-content ul { margin: 0 0 8px 20px; }
        .ec-modal-content li { margin-bottom: 4px; font-size: 13px; }
        .ec-modal-content code {
            background: var(--am-bg-secondary); padding: 2px 6px;
            border-radius: var(--am-radius-sm); font-size: 12px;
        }
    `;
}

async function exportEnvironmentComparisonData(comparisonData: any) {
  try {
    const csvContent = generateEnvironmentComparisonCSV(comparisonData);

    let defaultUri: vscode.Uri;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (workspaceFolders && workspaceFolders.length > 0) {
      defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'environment-comparison.csv');
    } else {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      defaultUri = vscode.Uri.file(`${homeDir}/environment-comparison.csv`);
    }

    const uri = await vscode.window.showSaveDialog({
      filters: { 'CSV Files': ['csv'] },
      saveLabel: 'Save Environment Comparison as CSV',
      defaultUri: defaultUri
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(csvContent, 'utf-8'));
      vscode.window.showInformationMessage(`Environment comparison exported to ${uri.fsPath}`);
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to export environment comparison: ${error.message}`);
  }
}

function generateEnvironmentComparisonCSV(comparisonData: any): string {
  if (!comparisonData || !comparisonData.applications) {
    return 'No data available to export';
  }

  const environments = comparisonData.environments || [];
  const applications = Object.values(comparisonData.applications) as any[];

  const baseHeaders = ['Application Name', 'Platform Type', 'Total Environments', 'Deployed Environments'];
  const envHeaders: string[] = [];
  environments.forEach((env: any) => {
    envHeaders.push(
      `${env.name} - Status`, `${env.name} - Version`, `${env.name} - Runtime`,
      `${env.name} - Filename`, `${env.name} - Region`,
      `${env.name} - Workers/Replicas`, `${env.name} - Worker Type/Resources`, `${env.name} - URL`
    );
  });

  const allHeaders = [...baseHeaders, ...envHeaders];
  const rows: string[][] = [];

  applications.forEach((app: any) => {
    const row: string[] = [];
    const deployedEnvCount = environments.filter((env: any) => app.environments && app.environments[env.id]).length;

    row.push(`"${app.name || 'N/A'}"`, `"${app.type || 'N/A'}"`, environments.length.toString(), deployedEnvCount.toString());

    environments.forEach((env: any) => {
      const deployment = app.environments ? app.environments[env.id] : null;
      if (deployment) {
        let workersOrReplicas = 'N/A';
        if (app.type === 'CH1' && deployment.workers) { workersOrReplicas = deployment.workers.toString(); }
        else if (app.type === 'CH2' && deployment.replicas) { workersOrReplicas = deployment.replicas.toString(); }

        let workerTypeOrResources = 'N/A';
        if (app.type === 'CH1' && deployment.workerType) { workerTypeOrResources = deployment.workerType; }
        else if (app.type === 'CH2' && deployment.cpuReserved && deployment.memoryReserved) {
          workerTypeOrResources = `${deployment.cpuReserved} CPU, ${deployment.memoryReserved} MB`;
        }

        let url = 'N/A';
        if (app.type === 'CH1' && deployment.fullDomain && deployment.fullDomain !== 'N/A') {
          url = `https://${deployment.fullDomain}`;
        }

        row.push(
          `"${deployment.status || 'N/A'}"`, `"${deployment.version || 'N/A'}"`,
          `"${deployment.runtime || 'N/A'}"`, `"${deployment.filename || 'N/A'}"`,
          `"${deployment.region || 'N/A'}"`, `"${workersOrReplicas}"`,
          `"${workerTypeOrResources}"`, `"${url}"`
        );
      } else {
        row.push('""', '""', '""', '""', '""', '""', '""', '""');
      }
    });

    rows.push(row);
  });

  return [allHeaders.join(','), ...rows.map(row => row.join(','))].join('\n');
}
