import * as vscode from 'vscode';

/**
 * Example: getOrgInfoWebviewContent
 * @param orgObject The organization JSON object
 * @param extensionUri The Uri of your VSCode extension (needed to load local resources)
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

  // Helper to render usage vs plan with a progress bar
  const renderUsageCard = (usageVal: number, planVal: number): string => {
    // If plan is 0 or undefined, show "N/A"
    if (!planVal || planVal === 0) {
      return /* html */`
        <p><strong>Usage:</strong> ${usageVal ?? 0} / <em>N/A</em></p>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: 0%"></div>
        </div>
      `;
    }

    // Calculate usage percentage
    const percentage = usageVal ? (usageVal / planVal) * 100 : 0;
    const limitedPercentage = percentage > 100 ? 100 : percentage; // cap at 100%

    return /* html */`
      <p><strong>Usage:</strong> ${usageVal ?? 0} / ${planVal}</p>
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: ${limitedPercentage}%;"></div>
      </div>
    `;
  };

  // Construct the webview-safe URI for logo
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // Build the entire HTML for the webview
  return /* html */ `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Organization Info</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
        background-color: #ffffff;
        color: #333;
      }

      /* Navigation Bar (Top Header) */
      .navbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 2rem;
        background-color: #1c164e; /* Dark purple/blue */
      }
      .navbar .nav-logo {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .navbar .nav-logo img {
        height: 32px; /* Adjust as needed */
        width: auto;
      }
      .navbar .nav-logo span {
        font-size: 1.25rem;
        font-weight: bold;
        color: #fff;
      }
      .navbar .nav-menu {
        display: flex;
        gap: 2rem;
        list-style: none;
      }
      .navbar .nav-menu li a {
        color: #fff;
        cursor: pointer;
        font-weight: 500;
        text-decoration: none;
      }
      .navbar .nav-menu li a:hover {
        text-decoration: underline;
      }

      /* Hero Section with wave/gradient background */
      .hero {
        position: relative;
        width: 100%;
        height: 360px; /* adjust as needed */
        background: linear-gradient(180deg, #2a2086 0%, #3f37a6 50%, #4d47bd 100%);
        overflow: hidden;
      }
      /* Simulated wave shapes (multiple layering) */
      .hero::before,
      .hero::after {
        content: "";
        position: absolute;
        width: 150%;
        height: 100%;
        top: 0;
        left: -25%;
        background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.2) 20%, transparent 40%);
        opacity: 0.4;
        animation: wave-animation 8s ease-in-out infinite alternate;
      }
      .hero::after {
        animation-delay: -4s;
      }
      @keyframes wave-animation {
        0% { transform: translateY(0%) }
        100% { transform: translateY(20%) }
      }

      .hero-content {
        position: absolute;
        top: 50%;
        right: 10%;
        transform: translateY(-50%);
        color: #fff;
        max-width: 400px;
      }
      .hero-content h1 {
        font-size: 2rem;
        margin-bottom: 1rem;
      }
      .hero-content p {
        line-height: 1.5;
      }

      /* Main content area */
      .content-container {
        max-width: 1200px;
        margin: 2rem auto;
        padding: 0 2rem;
      }
      .section-title {
        margin-bottom: 1rem;
        font-size: 1.5rem;
        border-bottom: 2px solid #ddd;
        padding-bottom: 0.5rem;
      }
      .info-panel {
        background-color: #f9f9f9;
        padding: 1rem;
        border: 1px solid #ddd;
        border-radius: 4px;
        margin-bottom: 2rem;
      }
      .info-table {
        width: 100%;
        border-collapse: collapse;
      }
      .info-table th,
      .info-table td {
        text-align: left;
        padding: 8px;
        border-bottom: 1px solid #ddd;
      }

      /* Usage Cards Section */
      .usage-container {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 2rem;
      }
      .usage-card {
        flex: 1;
        min-width: 250px;
        background-color: #f9f9f9;
        padding: 1rem;
        border: 1px solid #ddd;
        border-radius: 4px;
      }
      .usage-card h3 {
        font-size: 1.15rem;
        margin-bottom: 0.5rem;
      }
      .progress-bar-container {
        width: 100%;
        background-color: #ddd;
        border-radius: 8px;
        overflow: hidden;
        height: 8px;
        margin-top: 8px;
      }
      .progress-bar {
        height: 8px;
        background-color: #3f37a6;
      }
    </style>
  </head>
  <body>
    <!-- Top Header -->
    <nav class="navbar">
      <div class="nav-logo">
        <img src="${logoSrc}" alt="Anypoint Monitor" />
        <span>Anypoint Monitor Extension</span>
      </div>
      <ul class="nav-menu">
        <li><a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor" target="_blank">About the Extension</a></li>
        <li><a href="https://www.buymeacoffee.com/yucelmoran" target="_blank">Buy Me a Coffee</a></li>
      </ul>
    </nav>

    <!-- Hero Section -->
  

    <!-- Main Content -->
    <div class="content-container">
      <!-- Organization Details Panel -->
      <h2 class="section-title">Organization Details</h2>
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

      <!-- Usage vs Plan Section -->
      <h2 class="section-title">Usage vs Plan</h2>
      <div class="usage-container">
        <!-- Production Workers -->
        <div class="usage-card">
          <h3>Production Workers</h3>
          ${renderUsageCard(usage.productionWorkers, plan.maxProductionWorkers)}
        </div>
        <!-- Sandbox Workers -->
        <div class="usage-card">
          <h3>Sandbox Workers</h3>
          ${renderUsageCard(usage.sandboxWorkers, plan.maxSandboxWorkers)}
        </div>
        <!-- Standard Connectors -->
        <div class="usage-card">
          <h3>Standard Connectors</h3>
          ${renderUsageCard(usage.standardConnectors, plan.maxStandardConnectors)}
        </div>
        <!-- Premium Connectors -->
        <div class="usage-card">
          <h3>Premium Connectors</h3>
          ${renderUsageCard(usage.premiumConnectors, plan.maxPremiumConnectors)}
        </div>
        <!-- Static IPs -->
        <div class="usage-card">
          <h3>Static IPs</h3>
          ${renderUsageCard(usage.staticIps, plan.maxStaticIps)}
        </div>
        <!-- Deployment Groups -->
        <div class="usage-card">
          <h3>Deployment Groups</h3>
          ${renderUsageCard(usage.deploymentGroups, plan.maxDeploymentGroups)}
        </div>
      </div>
    </div>
  </body>
  </html>
`;
}