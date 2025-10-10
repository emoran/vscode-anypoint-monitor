import * as vscode from 'vscode';

/**
 * Example: getUserInfoWebviewContent
 * A dark-themed webview displaying user & org details, consistent with
 * your other "I love it!" pages. 
 */
export function getUserInfoWebviewContent(
  userObject: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  // Destructure user info
  const user = userObject.user || {};
  const org = user.organization || {};

  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  const email = user.email ?? 'N/A';
  const phone = user.phoneNumber ?? 'N/A';
  const username = user.username ?? 'N/A';
  const createdAt = user.createdAt ?? '';
  const lastLogin = user.lastLogin ?? '';
  const userEnabled = user.enabled ?? '';

  // Organization info
  const orgName = org.name ?? 'N/A';
  const orgType = org.orgType ?? 'N/A';
  const orgId = org.id ?? 'N/A';
  const orgDomain = org.domain ?? 'N/A';
  const subscriptionType = org.subscription?.type ?? 'N/A';
  const subscriptionExpiration = org.subscription?.expiration ?? 'N/A';

  // Additional info JSON (Entitlements)
  const additionalInfo = JSON.stringify(org.entitlements, null, 2);

  // Construct the webview-safe URI for logo
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  return /* html */ `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>User Dashboard</title>

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

      .stat-value {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 8px 0;
        line-height: 1.2;
        word-break: break-all;
      }

      .stat-subtitle {
        font-size: 13px;
        color: var(--text-muted);
        margin: 0;
      }

      /* Details Card */
      .details-card {
        background-color: var(--surface-primary);
        border: 1px solid var(--border-primary);
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 32px;
      }

      .details-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 20px 0;
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
        word-break: break-word;
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

      /* Button */
      .toggle-button {
        background-color: var(--accent-blue);
        color: var(--text-primary);
        border: none;
        border-radius: 8px;
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        margin-bottom: 16px;
      }

      .toggle-button:hover {
        background-color: var(--accent-light);
      }

      /* Entitlements Section */
      .entitlements-section {
        background-color: var(--surface-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 8px;
        padding: 16px;
        max-height: 400px;
        overflow-y: auto;
      }

      .entitlements-section pre {
        margin: 0;
        font-size: 12px;
        line-height: 1.4;
        color: var(--text-secondary);
        white-space: pre-wrap;
        word-wrap: break-word;
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
        <h1>Welcome, ${fullName}!</h1>
        <p>User Dashboard</p>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container">
      <!-- User Summary Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header">
            <h3 class="stat-title">Email</h3>
          </div>
          <div class="stat-value" style="font-size: 18px;">${email}</div>
          <p class="stat-subtitle">Primary contact</p>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <h3 class="stat-title">Username</h3>
          </div>
          <div class="stat-value" style="font-size: 18px;">${username}</div>
          <p class="stat-subtitle">Account identifier</p>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <h3 class="stat-title">Organization</h3>
          </div>
          <div class="stat-value" style="font-size: 18px;">${orgName}</div>
          <p class="stat-subtitle">${orgType}</p>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <h3 class="stat-title">Status</h3>
          </div>
          <div class="stat-value" style="font-size: 18px;">
            <span class="status-badge ${userEnabled ? 'status-enabled' : 'status-disabled'}">
              <span class="status-dot"></span>
              ${userEnabled ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p class="stat-subtitle">Account status</p>
        </div>
      </div>

      <!-- User Details -->
      <div class="details-card">
        <h2 class="details-title">User Details</h2>
        <table class="details-table">
          <tr>
            <th>Full Name</th>
            <td>${fullName}</td>
          </tr>
          <tr>
            <th>Email</th>
            <td>${email}</td>
          </tr>
          <tr>
            <th>Phone</th>
            <td>${phone}</td>
          </tr>
          <tr>
            <th>Username</th>
            <td>${username}</td>
          </tr>
          <tr>
            <th>Created At</th>
            <td>${createdAt}</td>
          </tr>
          <tr>
            <th>Last Login</th>
            <td>${lastLogin}</td>
          </tr>
          <tr>
            <th>Status</th>
            <td>
              <span class="status-badge ${userEnabled ? 'status-enabled' : 'status-disabled'}">
                <span class="status-dot"></span>
                ${userEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Organization Details -->
      <div class="details-card">
        <h2 class="details-title">Organization Details</h2>
        <table class="details-table">
          <tr>
            <th>Organization Name</th>
            <td>${orgName}</td>
          </tr>
          <tr>
            <th>Organization ID</th>
            <td>${orgId}</td>
          </tr>
          <tr>
            <th>Domain</th>
            <td>${orgDomain}</td>
          </tr>
          <tr>
            <th>Organization Type</th>
            <td>${orgType}</td>
          </tr>
          <tr>
            <th>Subscription Type</th>
            <td>${subscriptionType}</td>
          </tr>
          <tr>
            <th>Subscription Expiration</th>
            <td>${subscriptionExpiration}</td>
          </tr>
        </table>
      </div>

      <!-- Entitlements -->
      <div class="details-card">
        <h2 class="details-title">Organization Entitlements</h2>
        <button id="toggleButton" class="toggle-button">Toggle Entitlements</button>
        <div id="entitlementsSection" class="entitlements-section">
          <pre>${additionalInfo}</pre>
        </div>
      </div>
    </div>

    <!-- Toggle Script -->
    <script>
      const toggleButton = document.getElementById('toggleButton');
      const entitlementsSection = document.getElementById('entitlementsSection');
      let isVisible = true;

      toggleButton.addEventListener('click', () => {
        isVisible = !isVisible;
        entitlementsSection.style.display = isVisible ? 'block' : 'none';
      });
    </script>
  </body>
  </html>
  `;
}