import * as vscode from 'vscode';

/**
 * Example: getUserInfoWebviewContent
 * @param userObject The user JSON object
 * @param webview The VS Code Webview to render into
 * @param extensionUri The Uri of your VSCode extension (for loading local resources)
 */
export function getUserInfoWebviewContent(
  userObject: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  // Destructure for easy usage
  const user = userObject.user || {};
  const org = user.organization || {};

  // Basic user info
  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  const email = user.email ?? 'N/A';
  const phone = user.phoneNumber ?? 'N/A';
  const username = user.username ?? 'N/A';

  // Organization info
  const orgName = org.name ?? 'N/A';
  const orgType = org.orgType ?? 'N/A';
  const orgId = org.id ?? 'N/A';
  const orgDomain = org.domain ?? 'N/A';

  // Subscription info
  const subscriptionCategory = org.subscription?.category ?? 'N/A'; // Not displayed, but available
  const subscriptionType = org.subscription?.type ?? 'N/A';
  const subscriptionExpiration = org.subscription?.expiration ?? 'N/A';

  // Additional info JSON (Entitlements)
  const additionalInfo = JSON.stringify(org.entitlements, null, 2);

  // Construct the webview-safe URI for logo
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  const ldsPath = vscode.Uri.joinPath(extensionUri,'salesforce-lightning-design-system.min.css');
  const ldsSrc = webview.asWebviewUri(ldsPath);

  return /* html */ `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Anypoint Monitor Extension</title>
      <link rel="stylesheet" href="${ldsSrc}" />
      <style>
        /****************************************************************
         * Base / Global Styles
         ****************************************************************/
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
          color: #212529;
          background-color: #ffffff;
        }

        /****************************************************************
         * NAVBAR
         ****************************************************************/
        .navbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background-color: #1e1a41;
          padding: 0.75rem 1rem;
        }
        .navbar-left {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .navbar-left img {
          height: 32px;
          width: auto;
        }
        .navbar-left h1 {
          color: #ffffff;
          font-size: 1.25rem;
          margin: 0;
        }
        .navbar-right {
          display: flex;
          gap: 1.5rem;
        }
        .navbar-right a {
          color: #ffffff;
          text-decoration: none;
          font-weight: 500;
          font-size: 0.9rem;
        }
        .navbar-right a:hover {
          text-decoration: underline;
        }

        /****************************************************************
         * HERO SECTION
         ****************************************************************/
        .hero {
          background: linear-gradient(90deg, #262158 0%, #463f96 50%, #5d54b5 100%);
          color: #ffffff;
          padding: 2rem 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .hero-text {
          max-width: 60%;
        }
        .hero-text h2 {
          font-size: 2rem;
          margin-bottom: 0.5rem;
        }
        .hero-text p {
          margin-bottom: 0;
          font-size: 1rem;
          line-height: 1.4;
        }

        /****************************************************************
         * MAIN CONTAINER
         ****************************************************************/
        .container {
          max-width: 1100px;
          margin: 0 auto;
          padding: 1rem;
          background-color: #ffffff;
        }

        /****************************************************************
         * SECTION TITLES
         ****************************************************************/
        .section-title {
          font-size: 1.25rem;
          margin: 1rem 0 0.75rem 0;
        }

        /****************************************************************
         * TABLES
         ****************************************************************/
        .table-container {
          width: 100%;
          overflow-x: auto;
          margin-bottom: 1.5rem;
        }
        .app-table {
          border-collapse: collapse;
          background-color: #fff;
          box-shadow: 0 0 5px rgba(0,0,0,0.15);
          width: auto;
        }
        .app-table th,
        .app-table td {
          padding: 8px;
          border-bottom: 1px solid #e2e2e2;
          text-align: left;
          vertical-align: top;
          white-space: nowrap;
          font-size: 0.81rem;
        }
        .app-table th {
          background-color: #f4f4f4;
          font-weight: 600;
        }
        .app-table tr:hover {
          background-color: #f9f9f9;
        }

        /****************************************************************
         * PANELS / BOXES
         ****************************************************************/
        .panel {
          background-color: #f9f9f9;
          box-shadow: 0 0 5px rgba(0,0,0,0.05);
          margin-bottom: 1.5rem;
          border-radius: 4px;
          padding: 1rem;
        }

        /****************************************************************
         * BUTTONS
         ****************************************************************/
        .button {
          padding: 10px 16px;
          font-size: 14px;
          color: #ffffff;
          background-color: #5b44c0;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          text-decoration: none;
        }
        .button:hover {
          background-color: #49359a;
        }

        /****************************************************************
         * ADDITIONAL / ENTITLEMENTS SECTION
         ****************************************************************/
        .additional-section {
          background: #fff;
          border: 1px solid #ddd;
          padding: 1rem;
          border-radius: 4px;
          margin-top: 0.5rem;
        }
        pre {
          background: #eee;
          padding: 0.75rem;
          overflow: auto;
          margin: 0;
          font-size: 0.75rem;
        }
      </style>
    </head>
    <body>
      <!-- NAVBAR -->
      <nav class="navbar">
        <div class="navbar-left">
          <img src="${logoSrc}" alt="Anypoint Monitor Logo" />
          <h1>Anypoint Monitor Extension</h1>
        </div>
        <div class="navbar-right">
          <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor" target="_blank">
            About
          </a>
          <a href="https://www.buymeacoffee.com/yucelmoran" target="_blank">
            Buy Me a Coffee
          </a>
        </div>
      </nav>

      <!-- HERO -->
      <section class="hero">
        <div class="hero-text">
          <h2>Welcome, ${fullName}!</h2>
          <p>This extension allows you to interact with multiple APIs on the Platform.</p>
        </div>
      </section>

      <!-- MAIN CONTAINER -->
      <div class="container">

        <!-- USER DETAILS -->
        <h3 class="section-title">User Details</h3>
        <div class="panel">
          <div class="table-container">
            <table class="slds-table slds-table_cell-buffer slds-table_header-hidden slds-table_bordered">
              <tbody>
                <tr><th>Full Name</th><td>${fullName}</td></tr>
                <tr><th>Email</th><td>${email}</td></tr>
                <tr><th>Phone</th><td>${phone}</td></tr>
                <tr><th>Username</th><td>${username}</td></tr>
                <tr><th>Created At</th><td>${user.createdAt ?? ''}</td></tr>
                <tr><th>Last Login</th><td>${user.lastLogin ?? ''}</td></tr>
                <tr><th>Enabled</th><td>${user.enabled ?? ''}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ORGANIZATION DETAILS -->
        <h3 class="section-title">Organization Details</h3>
        <div class="panel">
          <div class="table-container">
            <table class="slds-table slds-table_cell-buffer slds-table_header-hidden slds-table_bordered">
              <tbody>
                <tr><th>Organization Name</th><td>${orgName}</td></tr>
                <tr><th>Organization ID</th><td>${orgId}</td></tr>
                <tr><th>Domain</th><td>${orgDomain}</td></tr>
                <tr><th>Org Type</th><td>${orgType}</td></tr>
                <tr><th>Subscription Type</th><td>${subscriptionType}</td></tr>
                <tr><th>Subscription Expiration</th><td>${subscriptionExpiration}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ENTITLEMENTS -->
        <h3 class="section-title">Additional Organization Entitlements</h3>
        <button id="toggleButton" class="button">Hide/Show Entitlements</button>
        <div id="entitlementsSection" class="additional-section">
          <pre>${additionalInfo}</pre>
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