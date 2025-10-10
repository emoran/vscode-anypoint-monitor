import * as vscode from 'vscode';

/**
 * Example: getOrgInfoWebviewContent
 * Reverts "Usage vs Plan" to a progress bar style (Used vs Remaining),
 * while keeping the dark theme + navbar layout.
 */
export function getOrgInfoWebviewContent(
  orgObject: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  // Destructure top-level org data
  const orgName = orgObject.name ?? 'N/A';
  const orgId = orgObject.id ?? 'N/A';
  const orgCsId = orgObject.csId ?? 'N/A';
  const orgEnabled = orgObject.enabled ?? false;

  // Global Deployment info
  const globalDeployment = orgObject.globalDeployment ?? {};
  const defaultRegion = globalDeployment.defaultRegion ?? 'N/A';

  // Additional boolean flags
  const downloadAppsEnabled = orgObject.downloadApplicationsEnabled ?? false;
  const persistentQueuesEncryptionEnabled = orgObject.persistentQueuesEncryptionEnabled ?? false;
  const osV1Disabled = orgObject.osV1Disabled ?? false;
  const deploymentGroupEnabled = orgObject.deploymentGroupEnabled ?? false;
  const loggingCustomLog4jEnabled = orgObject.loggingCustomLog4jEnabled ?? false;
  const multitenancy = orgObject.multitenancy?.enabled ?? false;

  // Plan & Usage objects
  const plan = orgObject.plan || {};
  const usage = orgObject.usage || {};

  // Construct the webview-safe URI for logo
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  /**
   * Renders a progress bar showing used vs. remaining.
   * - If planVal = 0 => Show "N/A"
   * - Else => Show usageVal / planVal with a bar
   */
  function renderUsageBar(usageVal: number, planVal: number): string {
    if (!planVal || planVal === 0) {
      return /* html */ `
        <p><strong>Usage:</strong> ${usageVal} / <em>N/A</em></p>
        <div class="bar-container">
          <div class="bar" style="width: 0%;"></div>
        </div>
      `;
    }

    const used = usageVal || 0;
    const total = planVal;
    const percent = Math.min((used / total) * 100, 100).toFixed(1);

    return /* html */ `
      <p><strong>Usage:</strong> ${used} / ${total}</p>
      <div class="bar-container">
        <div class="bar" style="width: ${percent}%"></div>
      </div>
    `;
  }

  // We'll build an array of usage items so we can loop over them
  // Each item: { label: string, usageVal: number, planVal: number }
  const usageItems = [
    {
      label: 'Production Workers',
      usageVal: usage.productionWorkers ?? 0,
      planVal: plan.maxProductionWorkers ?? 0
    },
    {
      label: 'Sandbox Workers',
      usageVal: usage.sandboxWorkers ?? 0,
      planVal: plan.maxSandboxWorkers ?? 0
    },
    {
      label: 'Standard Connectors',
      usageVal: usage.standardConnectors ?? 0,
      planVal: plan.maxStandardConnectors ?? 0
    },
    {
      label: 'Premium Connectors',
      usageVal: usage.premiumConnectors ?? 0,
      planVal: plan.maxPremiumConnectors ?? 0
    },
    {
      label: 'Static IPs',
      usageVal: usage.staticIps ?? 0,
      planVal: plan.maxStaticIps ?? 0
    },
    {
      label: 'Deployment Groups',
      usageVal: usage.deploymentGroups ?? 0,
      planVal: plan.maxDeploymentGroups ?? 0
    }
  ];

  // Generate the usage cards with progress bars
  const usageCardsHtml = usageItems
    .map((item) => {
      return /* html */ `
        <div class="usage-card">
          <h3>${item.label}</h3>
          ${renderUsageBar(item.usageVal, item.planVal)}
        </div>
      `;
    })
    .join('');

  // Build the entire HTML for the webview
  return /* html */ `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Organization Dashboard</title>

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


      /* Statistics Grid */
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
        margin-bottom: 32px;
      }

      .stat-card {
        background-color: var(--surface-primary);
        border: 1px solid var(--border-primary);
        border-radius: 12px;
        padding: 24px;
        position: relative;
        transition: all 0.2s;
      }

      .stat-card:hover {
        border-color: var(--border-muted);
        transform: translateY(-1px);
      }

      .stat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .stat-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-secondary);
        margin: 0;
      }

      .stat-icon {
        width: 16px;
        height: 16px;
        opacity: 0.6;
      }

      .stat-value {
        font-size: 32px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 8px 0;
        line-height: 1.2;
      }

      .stat-subtitle {
        font-size: 13px;
        color: var(--text-muted);
        margin: 0;
      }

      .stat-trend {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        margin-top: 8px;
      }

      .trend-up { color: var(--success); }
      .trend-down { color: var(--error); }
      .trend-neutral { color: var(--text-muted); }

      /* Usage Progress Bars */
      .usage-card {
        background-color: var(--surface-primary);
        border: 1px solid var(--border-primary);
        border-radius: 12px;
        padding: 24px;
      }

      .usage-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }

      .usage-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }

      .usage-subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0 0 20px 0;
      }

      .usage-items {
        display: grid;
        gap: 20px;
      }

      .usage-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 0;
        border-bottom: 1px solid var(--border-muted);
      }

      .usage-item:last-child {
        border-bottom: none;
      }

      .usage-info {
        flex: 1;
      }

      .usage-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        margin: 0 0 4px 0;
      }

      .usage-details {
        font-size: 13px;
        color: var(--text-secondary);
        margin: 0;
      }

      .usage-progress {
        width: 120px;
        margin-left: 16px;
      }

      .progress-bar {
        width: 100%;
        height: 6px;
        background-color: var(--surface-secondary);
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 4px;
      }

      .progress-fill {
        height: 100%;
        background-color: var(--accent-blue);
        transition: width 0.3s ease;
      }

      .progress-text {
        font-size: 12px;
        color: var(--text-muted);
        text-align: right;
      }

      /* Organization Details Table */
      .details-card {
        background-color: var(--surface-primary);
        border: 1px solid var(--border-primary);
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 32px;
      }

      .details-table {
        width: 100%;
        border-collapse: collapse;
      }

      .details-table tr {
        border-bottom: 1px solid var(--border-muted);
      }

      .details-table tr:last-child {
        border-bottom: none;
      }

      .details-table th,
      .details-table td {
        padding: 12px 0;
        text-align: left;
      }

      .details-table th {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
        width: 200px;
      }

      .details-table td {
        font-size: 14px;
        color: var(--text-primary);
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

      .status-enabled {
        background-color: rgba(63, 185, 80, 0.15);
        color: var(--success);
      }

      .status-disabled {
        background-color: rgba(248, 81, 73, 0.15);
        color: var(--error);
      }

      .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: currentColor;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .container {
          padding: 16px;
        }
        
        .header {
          padding: 16px;
        }
        
        .stats-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <!-- Header -->
    <div class="header">
      <div class="header-content">
        <h1>${orgName}</h1>
        <p>Organization Dashboard</p>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container">

      <!-- Statistics Grid -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header">
            <h3 class="stat-title">Production Workers</h3>
          </div>
          <div class="stat-value">${usage.productionWorkers || 0}</div>
          <p class="stat-subtitle">of ${plan.maxProductionWorkers || 'unlimited'} available</p>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <h3 class="stat-title">Sandbox Workers</h3>
          </div>
          <div class="stat-value">${usage.sandboxWorkers || 0}</div>
          <p class="stat-subtitle">of ${plan.maxSandboxWorkers || 'unlimited'} available</p>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <h3 class="stat-title">Static IPs</h3>
          </div>
          <div class="stat-value">${usage.staticIps || 0}</div>
          <p class="stat-subtitle">of ${plan.maxStaticIps || 'unlimited'} available</p>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <h3 class="stat-title">Default Region</h3>
          </div>
          <div class="stat-value" style="font-size: 18px;">${defaultRegion}</div>
          <p class="stat-subtitle">Primary deployment region</p>
        </div>
      </div>

      <!-- Usage Details -->
      <div class="usage-card">
        <div class="usage-header">
          <h2 class="usage-title">Resource Usage</h2>
        </div>
        <p class="usage-subtitle">Current usage across all resource types</p>
        
        <div class="usage-items">
          ${usageItems.map(item => {
            const used = item.usageVal || 0;
            const total = item.planVal || 0;
            const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
            
            return `
              <div class="usage-item">
                <div class="usage-info">
                  <h4 class="usage-label">${item.label}</h4>
                  <p class="usage-details">${used} of ${total > 0 ? total : 'unlimited'} used</p>
                </div>
                <div class="usage-progress">
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: ${percentage}%"></div>
                  </div>
                  <div class="progress-text">${percentage.toFixed(0)}%</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Organization Details -->
      <div class="details-card">
        <h2 class="usage-title" style="margin-bottom: 20px;">Organization Details</h2>
        <table class="details-table">
          <tr>
            <th>Organization ID</th>
            <td>${orgId}</td>
          </tr>
          <tr>
            <th>CS ID</th>
            <td>${orgCsId}</td>
          </tr>
          <tr>
            <th>Status</th>
            <td>
              <span class="status-badge ${orgEnabled ? 'status-enabled' : 'status-disabled'}">
                <span class="status-dot"></span>
                ${orgEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </td>
          </tr>
          <tr>
            <th>Application Downloads</th>
            <td>
              <span class="status-badge ${downloadAppsEnabled ? 'status-enabled' : 'status-disabled'}">
                <span class="status-dot"></span>
                ${downloadAppsEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </td>
          </tr>
          <tr>
            <th>Queue Encryption</th>
            <td>
              <span class="status-badge ${persistentQueuesEncryptionEnabled ? 'status-enabled' : 'status-disabled'}">
                <span class="status-dot"></span>
                ${persistentQueuesEncryptionEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </td>
          </tr>
          <tr>
            <th>Deployment Groups</th>
            <td>
              <span class="status-badge ${deploymentGroupEnabled ? 'status-enabled' : 'status-disabled'}">
                <span class="status-dot"></span>
                ${deploymentGroupEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </td>
          </tr>
          <tr>
            <th>Custom Log4j</th>
            <td>
              <span class="status-badge ${loggingCustomLog4jEnabled ? 'status-enabled' : 'status-disabled'}">
                <span class="status-dot"></span>
                ${loggingCustomLog4jEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </td>
          </tr>
          <tr>
            <th>Multitenancy</th>
            <td>
              <span class="status-badge ${multitenancy ? 'status-enabled' : 'status-disabled'}">
                <span class="status-dot"></span>
                ${multitenancy ? 'Enabled' : 'Disabled'}
              </span>
            </td>
          </tr>
        </table>
      </div>
    </div>
  </body>
  </html>
`;
}