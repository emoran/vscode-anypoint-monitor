import * as vscode from 'vscode';

/**
 * Example command (or function) that shows a WebView with:
 * - A Nav Bar
 * - An environment info card
 * - An organization info card
 */
export async function showEnvironmentAndOrgPanel(
  context: vscode.ExtensionContext,
  userInfo: { orgName: string; orgId: string }
) {
  // 1) Retrieve environment info from the secure store
  //    (Here, we assume you stored them as 'ENV_NAME' and 'ENV_ID'.)
  const environmentName = (await context.secrets.get('ENV_NAME')) ?? 'Unknown Env';
  const environmentId = (await context.secrets.get('ENV_ID')) ?? 'Unknown ID';

  // 2) Create a Webview Panel
  const panel = vscode.window.createWebviewPanel(
    'environmentOrgView',
    'Environment & Organization Info',
    vscode.ViewColumn.One,
    { enableScripts: true } // if you need scripts
  );

  // 3) Set the HTML content of that panel
  panel.webview.html = getEnvironmentOrgHtml(
    panel.webview,
    context.extensionUri,
    { environmentName, environmentId },
    userInfo
  );
}

/**
 * Returns the HTML string for the environment & organization layout.
 */
function getEnvironmentOrgHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  envData: { environmentName: string; environmentId: string },
  userInfo: { orgName: string; orgId: string }
): string {
  // If you have a logo.png in your extension,
  // convert it to a webview URI so you can reference it in <img src=...>
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // Basic CSS for layout & styling
  // (You can adapt the styling to match your extension’s theme.)
  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Environment & Org Info</title>
      <style>
        /* Reset / Base */
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
          background-color: #f7f7f7;
          color: #333;
        }

        /* Nav Bar */
        .navbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background-color: #1f2b3c;
          padding: 1rem;
        }
        .navbar-left,
        .navbar-right {
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
        .navbar-right a {
          color: #ffffff;
          text-decoration: none;
          font-size: 0.9rem;
        }

        /* Main container */
        .container {
          max-width: 1200px;
          margin: 1rem auto;
          padding: 1rem;
          background-color: #ffffff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        /* Card / Box styling */
        .card {
          background-color: #fff;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 1rem;
          margin-bottom: 1.5rem;
        }
        .card h2 {
          margin: 0 0 0.75rem 0;
          font-size: 1.15rem;
        }
        .card .info-row {
          display: flex;
          gap: 1rem;
          margin-top: 0.5rem;
        }
        .card .info-item {
          background-color: #f4f4f4;
          border-radius: 4px;
          padding: 0.5rem 0.75rem;
          flex: 0 0 auto;
        }
        .card .info-label {
          font-weight: 600;
          margin-bottom: 0.25rem;
          display: block;
        }

        /* Additional placeholders for text lines (like in your mockup) */
        .placeholder-line {
          height: 0.75rem;
          background-color: #eee;
          margin: 0.25rem 0;
          border-radius: 2px;
        }
      </style>
    </head>
    <body>
      <!-- NAV BAR -->
      <nav class="navbar">
        <div class="navbar-left">
          <img src="${logoSrc}" alt="Extension Logo" />
          <h1>Anypoint Monitor Extension</h1>
        </div>
        <div class="navbar-right">
          <a href="#">Menu Link</a>
          <a href="#">Another Link</a>
        </div>
      </nav>

      <!-- MAIN CONTAINER -->
      <div class="container">
        <!-- ENVIRONMENT INFO CARD -->
        <div class="card">
          <h2>Environment</h2>
          <div class="info-row">
            <div class="info-item">
              <span class="info-label">Environment Name</span>
              <span>${envData.environmentName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Environment ID</span>
              <span>${envData.environmentId}</span>
            </div>
          </div>
          <!-- Placeholder lines for extra environment details -->
          <div class="placeholder-line" style="width: 80%;"></div>
          <div class="placeholder-line" style="width: 60%;"></div>
        </div>

        <!-- ORGANIZATION INFO CARD -->
        <div class="card">
          <h2>Organization</h2>
          <div class="info-row">
            <div class="info-item">
              <span class="info-label">Organization Name</span>
              <span>${userInfo.orgName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Organization ID</span>
              <span>${userInfo.orgId}</span>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}