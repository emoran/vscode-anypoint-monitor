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
      <title>Anypoint Monitor Extension</title>

      <!-- Fira Code for a tech vibe -->
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
          padding: 1.5rem 2rem;
          color: #ffffff;
        }
        .hero h2 {
          font-size: 1.5rem;
          margin: 0 0 0.5rem;
        }
        .hero p {
          margin: 0;
          font-size: 0.9rem;
        }

        /* MAIN CONTAINER */
        .container {
          width: 90%;
          max-width: 1200px;
          margin: 1rem auto;
        }

        /* SECTION TITLE */
        .section-title {
          margin-bottom: 0.75rem;
          font-size: 1rem;
          border-bottom: 1px solid #30363D;
          padding-bottom: 0.5rem;
          color: var(--accent-color);
        }

        /* PANEL (Card) */
        .panel {
          background-color: var(--card-color);
          border: 1px solid #30363D;
          border-radius: 6px;
          padding: 1rem;
          margin-bottom: 1.5rem;
        }

        /* TABLES */
        .table-container {
          width: 100%;
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }
        th, td {
          padding: 0.5rem;
          border-bottom: 1px solid #30363D;
          text-align: left;
          vertical-align: top;
        }
        th {
          color: var(--accent-color);
          white-space: nowrap;
        }
        tr:hover {
          background-color: var(--table-hover-color);
        }

        /* BUTTON */
        .button {
          padding: 6px 12px;
          font-size: 0.8rem;
          color: #ffffff;
          background-color: var(--accent-color);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
        }
        .button:hover {
          background-color: var(--button-hover-color);
        }

        /* ENTITLEMENTS */
        .additional-section {
          background-color: #121212;
          border: 1px solid #30363D;
          padding: 0.75rem;
          border-radius: 4px;
          margin-top: 0.5rem;
          max-height: 300px;
          overflow-y: auto;
        }
        pre {
          margin: 0;
          font-size: 0.75rem;
          line-height: 1.3;
          white-space: pre-wrap;
          word-wrap: break-word;
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
        <h2>Welcome, ${fullName}!</h2>
        <p>This extension allows you to interact with multiple APIs on the Platform.</p>
      </section>

      <!-- MAIN CONTAINER -->
      <div class="container">
        <!-- USER DETAILS -->
        <h3 class="section-title">User Details</h3>
        <div class="panel">
          <div class="table-container">
            <table>
              <tbody>
                <tr><th>Full Name</th><td>${fullName}</td></tr>
                <tr><th>Email</th><td>${email}</td></tr>
                <tr><th>Phone</th><td>${phone}</td></tr>
                <tr><th>Username</th><td>${username}</td></tr>
                <tr><th>Created At</th><td>${createdAt}</td></tr>
                <tr><th>Last Login</th><td>${lastLogin}</td></tr>
                <tr><th>Enabled</th><td>${userEnabled}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ORGANIZATION DETAILS -->
        <h3 class="section-title">Organization Details</h3>
        <div class="panel">
          <div class="table-container">
            <table>
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