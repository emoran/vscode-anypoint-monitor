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
    <title>Organization Info</title>

    <!-- Fira Code for tech vibe -->
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap"
    />

    <style>
      /* Dark Theme Variables (same as your other webviews) */
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

      body {
        margin: 0;
        padding: 0;
        background-color: var(--background-color);
        color: var(--text-color);
        font-family: 'Fira Code', monospace, sans-serif;
        font-size: 13px;
      }

      /* NAVBAR */
      .navbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: var(--navbar-color);
        padding: 0.75rem 1rem;
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
        gap: 1rem;
      }
      .navbar-right a {
        color: var(--navbar-text-color);
        text-decoration: none;
        font-weight: 500;
        font-size: 0.85rem;
      }
      .navbar-right a:hover {
        text-decoration: underline;
      }

      /* HERO SECTION */
      .hero {
        background: linear-gradient(180deg, #2c3e50 0%, #4a5965 50%, #67737b 100%);
        padding: 1rem 2rem;
        color: #ffffff;
      }
      .hero h2 {
        font-size: 1.25rem;
        margin: 0 0 0.5rem;
      }
      .hero p {
        margin: 0;
        font-size: 0.9rem;
      }

      /* CONTAINER */
      .container {
        width: 90%;
        max-width: 1200px;
        margin: 1rem auto;
      }

      /* SECTION TITLE */
      .section-title {
        margin-bottom: 1rem;
        font-size: 1rem;
        border-bottom: 1px solid #30363D;
        padding-bottom: 0.5rem;
        color: var(--accent-color);
      }

      /* INFO PANEL (Org details) */
      .info-panel {
        background-color: var(--card-color);
        border: 1px solid #30363D;
        border-radius: 6px;
        padding: 1rem;
        margin-bottom: 2rem;
      }
      .info-table {
        width: 100%;
        border-collapse: collapse;
      }
      .info-table th,
      .info-table td {
        text-align: left;
        padding: 0.5rem;
        border-bottom: 1px solid #30363D;
      }
      .info-table tr:hover {
        background-color: var(--table-hover-color);
      }
      .info-table th {
        color: var(--accent-color);
        white-space: nowrap;
      }

      /* USAGE SECTION */
      .usage-container {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
      }
      .usage-card {
        background-color: var(--card-color);
        border: 1px solid #30363D;
        border-radius: 6px;
        padding: 0.75rem;
        flex: 1;
        min-width: 220px;
      }
      .usage-card h3 {
        margin: 0 0 0.5rem;
        font-size: 0.95rem;
        color: var(--accent-color);
      }
      .usage-card p {
        font-size: 0.85rem;
      }

      /* PROGRESS BAR */
      .bar-container {
        width: 100%;
        background-color: #30363D;
        border-radius: 4px;
        overflow: hidden;
        height: 8px;
        margin-top: 8px;
      }
      .bar {
        height: 8px;
        background-color: var(--accent-color);
      }
    </style>
  </head>
  <body>
    <!-- NAVBAR -->
    <nav class="navbar">
      <div class="navbar-left">
        <img src="${logoSrc}" alt="Anypoint Monitor" />
        <h1>Anypoint Monitor Extension</h1>
      </div>
      <div class="navbar-right">
        <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor" target="_blank">About the Extension</a>
        <a href="https://www.buymeacoffee.com/yucelmoran" target="_blank">Buy Me a Coffee</a>
      </div>
    </nav>

    <!-- HERO SECTION -->
    <div class="hero">
      <h2>${orgName} Organization</h2>
      <p>View real-time usage metrics and manage resources all in one place.</p>
    </div>

    <!-- MAIN CONTENT -->
    <div class="container">
      <!-- ORG DETAILS -->
      <h3 class="section-title">Organization Details</h3>
      <div class="info-panel">
        <table class="info-table">
          <tr><th>Name</th><td>${orgName}</td></tr>
          <tr><th>ID</th><td>${orgId}</td></tr>
          <tr><th>CS ID</th><td>${orgCsId}</td></tr>
          <tr><th>Enabled</th><td>${orgEnabled}</td></tr>
          <tr><th>Default Region</th><td>${defaultRegion}</td></tr>
          <tr><th>Download Apps Enabled</th><td>${downloadAppsEnabled}</td></tr>
          <tr><th>Persistent Queues Encryption</th><td>${persistentQueuesEncryptionEnabled}</td></tr>
          <tr><th>OS V1 Disabled</th><td>${osV1Disabled}</td></tr>
          <tr><th>Deployment Group Enabled</th><td>${deploymentGroupEnabled}</td></tr>
          <tr><th>Custom Log4j Enabled</th><td>${loggingCustomLog4jEnabled}</td></tr>
          <tr><th>Multitenancy Enabled</th><td>${multitenancy}</td></tr>
        </table>
      </div>

      <!-- USAGE vs PLAN -->
      <h3 class="section-title">Usage vs Plan</h3>
      <div class="usage-container">
        ${usageCardsHtml}
      </div>
    </div>
  </body>
  </html>
`;
}