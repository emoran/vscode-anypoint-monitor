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
          // Handle export functionality if needed
          vscode.window.showInformationMessage('Export functionality can be implemented here');
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
            const content = button.nextElementSibling;
            const isVisible = content.style.display !== 'none';
            content.style.display = isVisible ? 'none' : 'block';
            button.textContent = isVisible ? '▶ Advanced Settings' : '▼ Advanced Settings';
        }
        
        
        // Filter functionality
        document.getElementById('statusFilter').addEventListener('change', applyFilters);
        document.getElementById('platformFilter').addEventListener('change', applyFilters);
        document.getElementById('showAdvanced').addEventListener('change', toggleAdvancedDisplay);
        document.getElementById('highlightDifferences').addEventListener('change', toggleHighlightDifferences);
        
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
            const showAdvanced = document.getElementById('showAdvanced').checked;
            const advancedSections = document.querySelectorAll('.advanced-details');
            advancedSections.forEach(section => {
                section.style.display = showAdvanced ? 'block' : 'none';
            });
        }
        
        function toggleHighlightDifferences() {
            const highlight = document.getElementById('highlightDifferences').checked;
            const badges = document.querySelectorAll('.comparison-badge');
            badges.forEach(badge => {
                badge.style.display = highlight ? 'inline-block' : 'none';
            });
        }
        
        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            // Apply initial filters
            applyFilters();
        });
    </script>
</body>
</html>
  `;
}