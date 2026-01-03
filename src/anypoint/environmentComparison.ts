import * as vscode from 'vscode';

export async function showEnvironmentComparisonWebview(
  context: vscode.ExtensionContext,
  comparisonData: any
) {
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
      console.log('Environment Comparison Message:', message);
      
      switch (message.command) {
        case 'exportData':
          await exportEnvironmentComparisonData(comparisonData);
          break;
        case 'refreshData':
          // Refresh the comparison data
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
  if (value === 'N/A' || value === undefined) return '';
  const boolValue = value === true || value === 'true';
  const className = boolValue ? 'boolean-true' : 'boolean-false';
  const displayValue = boolValue ? 'YES' : 'NO';
  return `
    <div class="detail-row">
      <span class="detail-label">${label}:</span>
      <span class="boolean-value ${className}">${displayValue}</span>
    </div>
  `;
}

function formatDate(dateString: string): string {
  if (!dateString || dateString === 'N/A') return 'N/A';
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return dateString;
  }
}

function generateComparisonBadges(app: any, environments: any[]): string[] {
  const badges: string[] = [];
  const deployments = Object.values(app.environments) as any[];
  
  if (deployments.length < 2) return badges;
  
  // Check for version differences
  const versions = [...new Set(deployments.map(d => d.version))];
  if (versions.length > 1) badges.push('version-diff');
  
  // Check for runtime differences
  const runtimes = [...new Set(deployments.map(d => d.runtime))];
  if (runtimes.length > 1) badges.push('config-diff');
  
  // Check for resource differences (CloudHub specific)
  if (app.type === 'CH1') {
    const workers = [...new Set(deployments.map(d => d.workers))];
    const workerTypes = [...new Set(deployments.map(d => d.workerType))];
    if (workers.length > 1 || workerTypes.length > 1) badges.push('resource-diff');
    
    // Check for configuration differences
    const configs = ['monitoringEnabled', 'objectStoreV1', 'persistentQueues', 'autoRestart'];
    for (const config of configs) {
      const values = [...new Set(deployments.map(d => d[config]))];
      if (values.length > 1) badges.push('config-diff');
    }
  } else if (app.type === 'CH2') {
    const replicas = [...new Set(deployments.map(d => d.replicas))];
    const cpus = [...new Set(deployments.map(d => d.cpuReserved))];
    const memories = [...new Set(deployments.map(d => d.memoryReserved))];
    if (replicas.length > 1 || cpus.length > 1 || memories.length > 1) badges.push('resource-diff');
  }
  
  return [...new Set(badges)]; // Remove duplicates
}

function getEnvironmentComparisonHtml(
  comparisonData: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const applications = Object.values(comparisonData.applications) as any[];
  const environments = comparisonData.environments || [];

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Environment Comparison Table</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .title {
            font-size: 24px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        
        .actions {
            display: flex;
            gap: 10px;
        }
        
        .btn {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: background-color 0.2s;
        }
        
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .btn-primary {
            background-color: var(--vscode-button-background);
            border-color: var(--vscode-button-background);
        }
        
        .comparison-table-container {
            overflow-x: auto;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            background-color: var(--vscode-panel-background);
        }
        
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            min-width: 800px;
        }
        
        .comparison-table th,
        .comparison-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
            vertical-align: top;
        }
        
        .comparison-table th {
            background-color: var(--vscode-panel-background);
            color: var(--vscode-foreground);
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            border-bottom: 2px solid var(--vscode-panel-border);
        }
        
        .comparison-table th:first-child {
            position: sticky;
            left: 0;
            z-index: 11;
            background-color: var(--vscode-panel-background);
            border-right: 1px solid var(--vscode-panel-border);
            min-width: 200px;
        }
        
        .comparison-table td:first-child {
            position: sticky;
            left: 0;
            background-color: var(--vscode-panel-background);
            font-weight: 500;
            border-right: 1px solid var(--vscode-panel-border);
            min-width: 200px;
        }
        
        .status-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .status-started {
            background-color: #28a745;
            color: white;
        }
        
        .status-stopped {
            background-color: #dc3545;
            color: white;
        }
        
        .status-undeployed {
            background-color: #6c757d;
            color: white;
        }
        
        .status-deployed {
            background-color: #007bff;
            color: white;
        }
        
        .status-updating {
            background-color: #ffc107;
            color: black;
        }
        
        .app-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .app-name {
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        
        .app-type {
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 3px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            width: fit-content;
        }
        
        .env-cell {
            min-width: 200px;
        }
        
        .env-details {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        
        .detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
        }
        
        .detail-label {
            color: var(--vscode-descriptionForeground);
            font-weight: 500;
        }
        
        .detail-value {
            color: var(--vscode-foreground);
        }
        
        .version-highlight {
            background-color: var(--vscode-editor-selectionBackground);
            padding: 2px 4px;
            border-radius: 3px;
            font-weight: 600;
        }
        
        .no-deployment {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            text-align: center;
            padding: 20px;
        }
        
        .summary {
            margin-bottom: 20px;
            padding: 15px;
            background-color: var(--vscode-panel-background);
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border);
        }
        
        .summary h3 {
            margin: 0 0 10px 0;
            color: var(--vscode-foreground);
        }
        
        .summary-stats {
            display: flex;
            gap: 30px;
            flex-wrap: wrap;
        }
        
        .stat {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        
        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .stat-value {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        
        .advanced-details {
            margin-top: 8px;
            border-top: 1px solid var(--vscode-panel-border);
            padding-top: 8px;
        }
        
        .toggle-advanced {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 11px;
            text-decoration: underline;
            padding: 2px 0;
            margin-top: 4px;
        }
        
        .toggle-advanced:hover {
            color: var(--vscode-textLink-foreground);
        }
        
        .comparison-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            margin-left: 4px;
        }
        
        .badge-version-diff {
            background-color: #ff6b6b;
            color: white;
        }
        
        .badge-config-diff {
            background-color: #ffa726;
            color: white;
        }
        
        .badge-resource-diff {
            background-color: #42a5f5;
            color: white;
        }
        
        .badge-security-diff {
            background-color: #ab47bc;
            color: white;
        }
        
        .boolean-value {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .boolean-true {
            background-color: #4caf50;
            color: white;
        }
        
        .boolean-false {
            background-color: #f44336;
            color: white;
        }
        
        .url-link {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            font-size: 11px;
        }
        
        .url-link:hover {
            text-decoration: underline;
        }
        
        .filters-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            padding: 10px;
            background-color: var(--vscode-panel-background);
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
            flex-wrap: wrap;
            align-items: center;
        }
        
        .filter-group {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .filter-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-weight: 500;
        }
        
        .filter-select {
            padding: 4px 8px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 12px;
        }
        
        .filter-checkbox {
            margin-left: 4px;
        }
        
        .original-names {
            margin-top: 4px;
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
            font-style: italic;
            word-break: break-all;
        }
        
        .original-names small {
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">Environment Comparison Table</div>
        <div class="actions">
            <button class="btn" onclick="refreshData()">🔄 Refresh</button>
            <button class="btn btn-primary" onclick="exportData()">📊 Export</button>
        </div>
    </div>
    
    <div class="summary">
        <h3>Summary</h3>
        <div class="summary-stats">
            <div class="stat">
                <div class="stat-label">Total Applications</div>
                <div class="stat-value">${applications.length}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Environments</div>
                <div class="stat-value">${environments.length}</div>
            </div>
            <div class="stat">
                <div class="stat-label">CloudHub 1.0 Apps</div>
                <div class="stat-value">${applications.filter(app => app.type === 'CH1').length}</div>
            </div>
            <div class="stat">
                <div class="stat-label">CloudHub 2.0 Apps</div>
                <div class="stat-value">${applications.filter(app => app.type === 'CH2').length}</div>
            </div>
        </div>
        <div style="margin-top: 10px; font-size: 12px; color: var(--vscode-descriptionForeground); font-style: italic;">
            📝 Note: Design environment excluded from comparison (used for API design, not deployments)
        </div>
    </div>
    
    <div class="filters-bar">
        <div class="filter-group">
            <span class="filter-label">Show:</span>
            <select class="filter-select" id="statusFilter">
                <option value="all">All Statuses</option>
                <option value="version-diff">Version Differences</option>
                <option value="config-diff">Config Differences</option>
                <option value="running">Running Only</option>
                <option value="stopped">Stopped Only</option>
            </select>
        </div>
        <div class="filter-group">
            <span class="filter-label">Platform:</span>
            <select class="filter-select" id="platformFilter">
                <option value="all">All Platforms</option>
                <option value="CH1">CloudHub 1.0</option>
                <option value="CH2">CloudHub 2.0</option>
            </select>
        </div>
        <div class="filter-group">
            <label class="filter-label">
                <input type="checkbox" id="showAdvanced" class="filter-checkbox" checked>
                Show Advanced Details
            </label>
        </div>
        <div class="filter-group">
            <label class="filter-label">
                <input type="checkbox" id="highlightDifferences" class="filter-checkbox" checked>
                Highlight Differences
            </label>
        </div>
        <div class="filter-group">
            <button class="btn" onclick="showNameMatchingHelp()">📋 Name Matching Help</button>
        </div>
    </div>
    
    <div class="comparison-table-container">
        <table class="comparison-table">
            <thead>
                <tr>
                    <th>Application Name</th>
                    ${environments.map((env: any) => `<th class="env-cell">${env.name}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${applications.map(app => {
                    // Generate comparison badges for this app
                    const badges = generateComparisonBadges(app, environments);
                    
                    return `
                        <tr class="app-row" data-app-type="${app.type}" data-badges="${badges.join(',')}">
                            <td>
                                <div class="app-info">
                                    <div class="app-name">
                                        ${app.name}
                                        ${badges.map(badge => `<span class="comparison-badge badge-${badge}">${badge.replace('-', ' ').toUpperCase()}</span>`).join('')}
                                    </div>
                                    <div class="app-type">${app.type}</div>
                                    ${app.originalNames && app.originalNames.length > 1 ? `
                                        <div class="original-names">
                                            <small title="Original application names across environments">
                                                📝 ${app.originalNames.join(', ')}
                                            </small>
                                        </div>
                                    ` : ''}
                                </div>
                            </td>
                            ${environments.map((env: any) => {
                                const deployment = app.environments[env.id];
                                if (!deployment) {
                                    return `<td class="env-cell"><div class="no-deployment">Not deployed</div></td>`;
                                }
                                
                                return `
                                    <td class="env-cell">
                                        <div class="env-details">
                                            <!-- Basic Information -->
                                            <div class="detail-row">
                                                <span class="detail-label">Status:</span>
                                                <span class="status-badge status-${deployment.status.toLowerCase()}">${deployment.status}</span>
                                            </div>
                                            <div class="detail-row">
                                                <span class="detail-label">Version:</span>
                                                <span class="detail-value version-highlight">${deployment.version}</span>
                                            </div>
                                            <div class="detail-row">
                                                <span class="detail-label">Runtime:</span>
                                                <span class="detail-value">${deployment.runtime}</span>
                                            </div>
                                            
                                            ${app.type === 'CH1' ? `
                                                <!-- CloudHub 1.0 Specific Fields -->
                                                <div class="detail-row">
                                                    <span class="detail-label">Artifact:</span>
                                                    <span class="detail-value">${deployment.filename}</span>
                                                </div>
                                                <div class="detail-row">
                                                    <span class="detail-label">Region:</span>
                                                    <span class="detail-value">${deployment.region}</span>
                                                </div>
                                                <div class="detail-row">
                                                    <span class="detail-label">Workers:</span>
                                                    <span class="detail-value">${deployment.workers} × ${deployment.workerType}</span>
                                                </div>
                                                ${deployment.fullDomain !== 'N/A' ? `
                                                    <div class="detail-row">
                                                        <span class="detail-label">URL:</span>
                                                        <a href="https://${deployment.fullDomain}" target="_blank" class="url-link">${deployment.fullDomain}</a>
                                                    </div>
                                                ` : ''}
                                                
                                                <!-- Advanced CH1 Details -->
                                                <div class="advanced-details advanced-ch1" style="display: block;">
                                                    <button class="toggle-advanced" onclick="toggleAdvanced(this)">▼ Advanced Settings</button>
                                                    <div class="advanced-content" style="display: none;">
                                                        ${renderBooleanField('Monitoring', deployment.monitoringEnabled)}
                                                        ${renderBooleanField('ObjectStore V1', deployment.objectStoreV1)}
                                                        ${renderBooleanField('Persistent Queues', deployment.persistentQueues)}
                                                        ${renderBooleanField('Multiple Workers', deployment.multipleWorkers)}
                                                        ${renderBooleanField('Auto Restart', deployment.autoRestart)}
                                                        ${renderBooleanField('Static IPs', deployment.staticIPsEnabled)}
                                                        ${renderBooleanField('Secure Data Gateway', deployment.secureDataGateway)}
                                                        ${renderBooleanField('VPN', deployment.vpn)}
                                                        <div class="detail-row">
                                                            <span class="detail-label">Properties:</span>
                                                            <span class="detail-value">${deployment.propertiesCount} configured</span>
                                                        </div>
                                                        ${deployment.applicationSize !== 'N/A' ? `
                                                            <div class="detail-row">
                                                                <span class="detail-label">App Size:</span>
                                                                <span class="detail-value">${deployment.applicationSize}</span>
                                                            </div>
                                                        ` : ''}
                                                    </div>
                                                </div>
                                            ` : `
                                                <!-- CloudHub 2.0 Specific Fields -->
                                                <div class="detail-row">
                                                    <span class="detail-label">Replicas:</span>
                                                    <span class="detail-value">${deployment.replicas}</span>
                                                </div>
                                                <div class="detail-row">
                                                    <span class="detail-label">Resources:</span>
                                                    <span class="detail-value">${deployment.cpuReserved} CPU, ${deployment.memoryReserved} MB</span>
                                                </div>
                                                ${deployment.filename !== 'N/A' ? `
                                                    <div class="detail-row">
                                                        <span class="detail-label">Artifact:</span>
                                                        <span class="detail-value">${deployment.filename}</span>
                                                    </div>
                                                ` : ''}
                                                ${deployment.creationDate !== 'N/A' ? `
                                                    <div class="detail-row">
                                                        <span class="detail-label">Created:</span>
                                                        <span class="detail-value">${formatDate(deployment.creationDate)}</span>
                                                    </div>
                                                ` : ''}
                                                
                                                <!-- Advanced CH2 Details -->
                                                <div class="advanced-details advanced-ch2" style="display: block;">
                                                    <button class="toggle-advanced" onclick="toggleAdvanced(this)">▼ Advanced Settings</button>
                                                    <div class="advanced-content" style="display: none;">
                                                        ${deployment.autoScalingEnabled !== 'N/A' ? `
                                                            ${renderBooleanField('Auto Scaling', deployment.autoScalingEnabled)}
                                                            <div class="detail-row">
                                                                <span class="detail-label">Scaling Range:</span>
                                                                <span class="detail-value">${deployment.minReplicas} - ${deployment.maxReplicas} replicas</span>
                                                            </div>
                                                        ` : ''}
                                                        ${deployment.cpuLimit !== 'N/A' ? `
                                                            <div class="detail-row">
                                                                <span class="detail-label">CPU Limit:</span>
                                                                <span class="detail-value">${deployment.cpuLimit}</span>
                                                            </div>
                                                        ` : ''}
                                                        ${deployment.memoryLimit !== 'N/A' ? `
                                                            <div class="detail-row">
                                                                <span class="detail-label">Memory Limit:</span>
                                                                <span class="detail-value">${deployment.memoryLimit}</span>
                                                            </div>
                                                        ` : ''}
                                                        ${deployment.networkType !== 'N/A' ? `
                                                            <div class="detail-row">
                                                                <span class="detail-label">Network:</span>
                                                                <span class="detail-value">${deployment.networkType}</span>
                                                            </div>
                                                        ` : ''}
                                                        ${renderBooleanField('Public Endpoints', deployment.publicEndpoints)}
                                                        ${renderBooleanField('Persistent Storage', deployment.persistentStorage)}
                                                        ${renderBooleanField('Clustered', deployment.clustered)}
                                                        ${renderBooleanField('Monitoring', deployment.monitoring)}
                                                        ${deployment.javaVersion !== 'N/A' ? `
                                                            <div class="detail-row">
                                                                <span class="detail-label">Java Version:</span>
                                                                <span class="detail-value">${deployment.javaVersion}</span>
                                                            </div>
                                                        ` : ''}
                                                        ${deployment.updateStrategy !== 'N/A' ? `
                                                            <div class="detail-row">
                                                                <span class="detail-label">Update Strategy:</span>
                                                                <span class="detail-value">${deployment.updateStrategy}</span>
                                                            </div>
                                                        ` : ''}
                                                    </div>
                                                </div>
                                            `}
                                        </div>
                                    </td>
                                `;
                            }).join('')}
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function refreshData() {
            vscode.postMessage({
                command: 'refreshData'
            });
        }
        
        function exportData() {
            vscode.postMessage({
                command: 'exportData'
            });
        }
        
        function toggleAdvanced(button) {
            try {
                const content = button.nextElementSibling;
                if (!content) {
                    console.error('Advanced content element not found');
                    return;
                }
                
                const isVisible = content.style.display !== 'none';
                content.style.display = isVisible ? 'none' : 'block';
                button.textContent = isVisible ? '▶ Advanced Settings' : '▼ Advanced Settings';
                
                console.log('Advanced settings toggled:', isVisible ? 'hidden' : 'shown');
            } catch (error) {
                console.error('Error toggling advanced settings:', error);
            }
        }
        
        
        // Filter functionality - will be attached in DOMContentLoaded
        
        function applyFilters() {
            const statusFilter = document.getElementById('statusFilter').value;
            const platformFilter = document.getElementById('platformFilter').value;
            const rows = document.querySelectorAll('.app-row');
            
            rows.forEach(row => {
                let show = true;
                
                // Platform filter
                if (platformFilter !== 'all') {
                    const appType = row.getAttribute('data-app-type');
                    if (appType !== platformFilter) show = false;
                }
                
                // Status filter
                if (statusFilter !== 'all') {
                    const badges = row.getAttribute('data-badges').split(',');
                    switch (statusFilter) {
                        case 'version-diff':
                            if (!badges.includes('version-diff')) show = false;
                            break;
                        case 'config-diff':
                            if (!badges.includes('config-diff')) show = false;
                            break;
                        case 'running':
                            const runningStatuses = row.querySelectorAll('.status-badge');
                            if (![...runningStatuses].some(badge => 
                                badge.textContent.toLowerCase().includes('running') || 
                                badge.textContent.toLowerCase().includes('started'))) show = false;
                            break;
                        case 'stopped':
                            const stoppedStatuses = row.querySelectorAll('.status-badge');
                            if (![...stoppedStatuses].some(badge => 
                                badge.textContent.toLowerCase().includes('stopped') || 
                                badge.textContent.toLowerCase().includes('undeployed'))) show = false;
                            break;
                    }
                }
                
                row.style.display = show ? '' : 'none';
            });
        }
        
        function toggleAdvancedDisplay() {
            try {
                const checkbox = document.getElementById('showAdvanced');
                if (!checkbox) {
                    console.error('Show advanced checkbox not found');
                    return;
                }
                
                const showAdvanced = checkbox.checked;
                const advancedSections = document.querySelectorAll('.advanced-details');
                
                console.log('Toggle advanced display:', showAdvanced, 'Found sections:', advancedSections.length);
                
                advancedSections.forEach(section => {
                    section.style.display = showAdvanced ? 'block' : 'none';
                });
            } catch (error) {
                console.error('Error toggling advanced display:', error);
            }
        }
        
        function toggleHighlightDifferences() {
            const highlight = document.getElementById('highlightDifferences').checked;
            const badges = document.querySelectorAll('.comparison-badge');
            badges.forEach(badge => {
                badge.style.display = highlight ? 'inline-block' : 'none';
            });
        }
        
        function showNameMatchingHelp() {
            const helpContent = \`
            <h3>📋 Intelligent Application Name Matching</h3>
            <p>This feature automatically groups applications with similar names across environments:</p>
            
            <h4>✅ Supported Patterns:</h4>
            <ul>
                <li><strong>Environment Suffixes:</strong> myapp-dev, myapp-qa, myapp-prod</li>
                <li><strong>Environment Prefixes:</strong> dev-myapp, qa-myapp, prod-myapp</li>
                <li><strong>Complex Names:</strong> fabe-loyalty-program-exapi-sandbox → fabe-loyalty-program-exapi-prod</li>
                <li><strong>Abbreviations:</strong> myapp-stg, myapp-prd, myapp-sbx</li>
            </ul>
            
            <h4>🔍 Recognized Environment Keywords:</h4>
            <p><code>dev, develop, development, test, testing, qa, quality, uat, stage, staging, 
            prod, production, sandbox, demo, preview, integration, sit, perf, performance</code></p>
            
            <h4>📝 How It Works:</h4>
            <p>The system normalizes application names by removing environment-specific prefixes and suffixes, 
            then groups applications with the same normalized name together.</p>
            
            <h4>💡 Examples:</h4>
            <table style="margin-top: 10px; border-collapse: collapse; width: 100%;">
                <tr style="background: var(--vscode-panel-background);">
                    <td style="padding: 8px; border: 1px solid var(--vscode-panel-border);"><strong>Original Names</strong></td>
                    <td style="padding: 8px; border: 1px solid var(--vscode-panel-border);"><strong>Grouped As</strong></td>
                </tr>
                <tr>
                    <td style="padding: 8px; border: 1px solid var(--vscode-panel-border);">customer-api-dev, customer-api-prod</td>
                    <td style="padding: 8px; border: 1px solid var(--vscode-panel-border);">customer-api</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border: 1px solid var(--vscode-panel-border);">fabe-loyalty-exapi-sandbox, fabe-loyalty-exapi-staging</td>
                    <td style="padding: 8px; border: 1px solid var(--vscode-panel-border);">fabe-loyalty-exapi</td>
                </tr>
            </table>
            \`;
            
            // Create modal overlay
            const modal = document.createElement('div');
            modal.style.cssText = \`
                position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
                background: rgba(0,0,0,0.5); z-index: 1000; 
                display: flex; align-items: center; justify-content: center;
            \`;
            
            const content = document.createElement('div');
            content.style.cssText = \`
                background: var(--vscode-panel-background); 
                padding: 20px; border-radius: 8px; max-width: 600px; 
                max-height: 80vh; overflow-y: auto;
                border: 1px solid var(--vscode-panel-border);
                color: var(--vscode-foreground);
            \`;
            content.innerHTML = helpContent + \`
                <div style="text-align: right; margin-top: 20px;">
                    <button onclick="this.closest('.modal-overlay').remove()" 
                            style="padding: 8px 16px; background: var(--vscode-button-background); 
                                   color: var(--vscode-button-foreground); border: none; border-radius: 4px;">
                        Close
                    </button>
                </div>
            \`;
            
            modal.className = 'modal-overlay';
            modal.appendChild(content);
            document.body.appendChild(modal);
            
            // Close on outside click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
        }
        
        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Environment Comparison Table initializing...');
            
            // Attach event listeners
            try {
                document.getElementById('statusFilter').addEventListener('change', applyFilters);
                document.getElementById('platformFilter').addEventListener('change', applyFilters);
                document.getElementById('showAdvanced').addEventListener('change', toggleAdvancedDisplay);
                document.getElementById('highlightDifferences').addEventListener('change', toggleHighlightDifferences);
                
                console.log('Event listeners attached successfully');
                
                // Check how many advanced sections exist
                const advancedSections = document.querySelectorAll('.advanced-details');
                console.log('Found advanced sections:', advancedSections.length);
                
                // Apply initial filters
                applyFilters();
                
                console.log('Environment Comparison Table initialized successfully');
            } catch (error) {
                console.error('Error during initialization:', error);
            }
        });
    </script>
</body>
</html>
  `;
}

/**
 * Export environment comparison data to CSV
 */
async function exportEnvironmentComparisonData(comparisonData: any) {
  try {
    const csvContent = generateEnvironmentComparisonCSV(comparisonData);

    // Determine default save location
    let defaultUri: vscode.Uri;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (workspaceFolders && workspaceFolders.length > 0) {
      // Use workspace folder if available
      defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'environment-comparison.csv');
    } else {
      // Fallback to home directory
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      defaultUri = vscode.Uri.file(`${homeDir}/environment-comparison.csv`);
    }

    // Prompt for save location
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

/**
 * Generate CSV content from environment comparison data
 */
function generateEnvironmentComparisonCSV(comparisonData: any): string {
  if (!comparisonData || !comparisonData.applications) {
    return 'No data available to export';
  }

  const environments = comparisonData.environments || [];
  const applications = Object.values(comparisonData.applications) as any[];

  // Create headers
  const baseHeaders = [
    'Application Name',
    'Platform Type',
    'Total Environments',
    'Deployed Environments'
  ];

  // Add environment-specific headers
  const envHeaders: string[] = [];
  environments.forEach((env: any) => {
    envHeaders.push(
      `${env.name} - Status`,
      `${env.name} - Version`,
      `${env.name} - Runtime`,
      `${env.name} - Filename`,
      `${env.name} - Region`,
      `${env.name} - Workers/Replicas`,
      `${env.name} - Worker Type/Resources`,
      `${env.name} - URL`
    );
  });

  const allHeaders = [...baseHeaders, ...envHeaders];

  // Generate rows
  const rows: string[][] = [];

  applications.forEach((app: any) => {
    const row: string[] = [];

    // Count deployed environments
    const deployedEnvCount = environments.filter((env: any) => app.environments && app.environments[env.id]).length;

    // Base information
    row.push(
      `"${app.name || 'N/A'}"`,
      `"${app.type || 'N/A'}"`,
      environments.length.toString(),
      deployedEnvCount.toString()
    );

    // Environment-specific data
    environments.forEach((env: any) => {
      const deployment = app.environments ? app.environments[env.id] : null;

      if (deployment) {
        // Extract workers/replicas info
        let workersOrReplicas = 'N/A';
        if (app.type === 'CH1' && deployment.workers) {
          workersOrReplicas = deployment.workers.toString();
        } else if (app.type === 'CH2' && deployment.replicas) {
          workersOrReplicas = deployment.replicas.toString();
        }

        // Extract worker type or resources
        let workerTypeOrResources = 'N/A';
        if (app.type === 'CH1' && deployment.workerType) {
          workerTypeOrResources = deployment.workerType;
        } else if (app.type === 'CH2' && deployment.cpuReserved && deployment.memoryReserved) {
          workerTypeOrResources = `${deployment.cpuReserved} CPU, ${deployment.memoryReserved} MB`;
        }

        // Extract URL
        let url = 'N/A';
        if (app.type === 'CH1' && deployment.fullDomain && deployment.fullDomain !== 'N/A') {
          url = `https://${deployment.fullDomain}`;
        }

        row.push(
          `"${deployment.status || 'N/A'}"`,
          `"${deployment.version || 'N/A'}"`,
          `"${deployment.runtime || 'N/A'}"`,
          `"${deployment.filename || 'N/A'}"`,
          `"${deployment.region || 'N/A'}"`,
          `"${workersOrReplicas}"`,
          `"${workerTypeOrResources}"`,
          `"${url}"`
        );
      } else {
        // No deployment in this environment - add empty columns
        row.push('""', '""', '""', '""', '""', '""', '""', '""');
      }
    });

    rows.push(row);
  });

  // Combine headers and rows
  const csvLines = [
    allHeaders.join(','),
    ...rows.map(row => row.join(','))
  ];

  return csvLines.join('\n');
}

/**
 * Format date for CSV export
 */
function formatDateForCSV(dateString: string): string {
  if (!dateString || dateString === 'N/A') return 'N/A';
  
  try {
    const date = new Date(dateString);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  } catch {
    return dateString;
  }
}