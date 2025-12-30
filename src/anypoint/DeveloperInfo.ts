/* ------------------------------------------------------------------
   extension.ts (or main entry point for your VS Code extension)
   This file demonstrates all the changes:
   - Refresh token on 401 for showEnvironmentAndOrgPanel
   - New approach for show/hide + copy secrets
   - Example commands (login, logout, user info, org info, etc.)
   ------------------------------------------------------------------ */

   import * as vscode from 'vscode';
   import axios, { AxiosError } from 'axios';
   import * as http from 'http';
   import * as path from 'path';
   import { ApiHelper } from '../controllers/apiHelper.js';
   import { getBaseUrl } from '../constants';
   import { AccountService } from '../controllers/accountService.js';

   // ------------------------------------------------------------------
   // CONSTANTS & CONFIG
   // ------------------------------------------------------------------
   // Note: BASE_URL is now dynamic based on active account's region
   // Use getBaseUrl(context) to get the region-specific URL

   // Example redirect URL (must match your MuleSoft OAuth app settings)
   const LOCAL_REDIRECT_URI = 'http://localhost:8082/callback';

   // Helper functions to build region-specific OAuth endpoints
   async function getAuthorizationEndpoint(context: vscode.ExtensionContext): Promise<string> {
       const baseUrl = await getBaseUrl(context);
       return `${baseUrl}/accounts/api/v2/oauth2/authorize`;
   }

   async function getTokenEndpoint(context: vscode.ExtensionContext): Promise<string> {
       const baseUrl = await getBaseUrl(context);
       return `${baseUrl}/accounts/api/v2/oauth2/token`;
   }

   async function getRevokeEndpoint(context: vscode.ExtensionContext): Promise<string> {
       const baseUrl = await getBaseUrl(context);
       return `${baseUrl}/accounts/api/v2/oauth2/revoke`;
   }
   
   // Use the same credentials as the main extension
   const CLIENT_ID = 'a7db79120339458da2d7ba979ee94a42';
   const CLIENT_SECRET = '339A336DA32446dFb8B2945400E607B8';
   
   // ------------------------------------------------------------------
   // INTERFACES
   // ------------------------------------------------------------------
   interface IEnvironment {
     id: string;
     name: string;
   }
   
   // ------------------------------------------------------------------
   // ACTIVATION
   // ------------------------------------------------------------------
   export function activate(context: vscode.ExtensionContext) {
   
     // 1) Login Command
     const loginCommand = vscode.commands.registerCommand('anypoint-monitor.login', async () => {
       try {
         await loginToAnypointWithOAuth(context);
       } catch (error: any) {
         vscode.window.showErrorMessage(`Login failed: ${error.message || error}`);
       }
     });
   
     // 2) Logout Command
     const revokeAccessCommand = vscode.commands.registerCommand('anypoint-monitor.logout', async () => {
       try {
         await revokeAnypointToken(context, 'access');
       } catch (err: any) {
         vscode.window.showErrorMessage(`Failed to revoke access token: ${err.message}`);
       }
     });
   
     // 3) Show user info
     const userInfoCmd = vscode.commands.registerCommand('anypoint-monitor.userInfo', async () => {
       try {
         await getUserInfo(context);
       } catch (error: any) {
         vscode.window.showErrorMessage(`Error: ${error.message || error}`);
       }
     });
   
     // 4) Show org info
     const orgInfoCmd = vscode.commands.registerCommand('anypoint-monitor.organizationInfo', async () => {
       try {
         await getOrganizationInfo(context);
       } catch (error: any) {
         vscode.window.showErrorMessage(`Error: ${error.message || error}`);
       }
     });
   
     // 5) Dev Utilities: environment & org panel (the code we updated)
     const devInfoCmd = vscode.commands.registerCommand('anypoint-monitor.developerUtilities', async () => {
       try {
         await developerInfo(context);
       } catch (error: any) {
         vscode.window.showErrorMessage(`Error: ${error.message || error}`);
       }
     });
   
     // Add them to subscriptions
     context.subscriptions.push(loginCommand);
     context.subscriptions.push(revokeAccessCommand);
     context.subscriptions.push(userInfoCmd);
     context.subscriptions.push(orgInfoCmd);
     context.subscriptions.push(devInfoCmd);
     // ... plus any other commands you may have
   }
   
   export function deactivate() {
     // Cleanup if needed
   }
   
   // ------------------------------------------------------------------
   //  Login & Logout Flows
   // ------------------------------------------------------------------
   export async function loginToAnypointWithOAuth(context: vscode.ExtensionContext) {
     // 1) Start a local server to handle the OAuth redirect
     const server = http.createServer(async (req, res) => {
       if (req.url && req.url.startsWith('/callback')) {
         // Extract 'code' from the query string
         const urlObj = new URL(req.url, 'http://localhost:8082');
         const code = urlObj.searchParams.get('code');
   
         if (!code) {
           res.writeHead(400);
           res.end('No code found in callback.');
           return;
         }
   
         try {
           // 2) Exchange the authorization code for tokens
           await exchangeAuthorizationCodeForTokens(context, code);
   
           res.writeHead(200);
           res.end('Login successful! You can close this window.');
           server.close();
         } catch (error: any) {
           vscode.window.showErrorMessage(`Token exchange error: ${error.message || error}`);
           res.writeHead(500);
           res.end('Error exchanging tokens. Check VS Code for details.');
           server.close();
         }
       }
     });
   
     server.listen(8082, async () => {
       // 2) Build the authorization URL
       const authorizationEndpoint = await getAuthorizationEndpoint(context);
       const authUrl = new URL(authorizationEndpoint);
       authUrl.searchParams.set('response_type', 'code');
       authUrl.searchParams.set('client_id', CLIENT_ID);
       authUrl.searchParams.set('redirect_uri', LOCAL_REDIRECT_URI);
       authUrl.searchParams.set('scope', 'offline_access full');
   
       // 3) Open the browser
       vscode.env.openExternal(vscode.Uri.parse(authUrl.toString())).then(success => {
         if (!success) {
           vscode.window.showErrorMessage('Failed to open browser for Anypoint login.');
         }
       });
     });
   }
   
   // Helper to exchange code -> tokens
   async function exchangeAuthorizationCodeForTokens(context: vscode.ExtensionContext, code: string) {
     const data = new URLSearchParams();
     data.append('code', code);
     data.append('redirect_uri', LOCAL_REDIRECT_URI);
     data.append('grant_type', 'authorization_code');
     data.append('client_id', CLIENT_ID);
     data.append('client_secret', CLIENT_SECRET);
   
     const base64Creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

     const tokenEndpoint = await getTokenEndpoint(context);
     const response = await axios.post(tokenEndpoint, data.toString(), {
       headers: {
         'Authorization': `Basic ${base64Creds}`,
         'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
       },
     });
   
     if (response.status !== 200) {
       throw new Error(`Token endpoint returned status ${response.status}`);
     }
   
     const result = response.data as {
       access_token?: string;
       refresh_token?: string;
       [key: string]: any;
     };
   
     if (!result.access_token) {
       throw new Error(`No access_token found in response: ${JSON.stringify(result)}`);
     }
   
     // Store tokens
     await context.secrets.store('anypoint.accessToken', result.access_token);
     if (result.refresh_token) {
       await context.secrets.store('anypoint.refreshToken', result.refresh_token);
     }
   
     vscode.window.showInformationMessage(`Received access token from Anypoint.`);
   
     // Optionally fetch user info & environment list right away
     await getUserInfo(context);
     await getEnvironments(context);
   }
   
   /**
    * Revokes the token and removes it from SecretStorage.
    */
   export async function revokeAnypointToken(context: vscode.ExtensionContext, tokenType: 'access' | 'refresh') {
     const storageKey = tokenType === 'access' ? 'anypoint.accessToken' : 'anypoint.refreshToken';
     const token = await context.secrets.get(storageKey);
   
     if (!token) {
       vscode.window.showWarningMessage(`No ${tokenType} token found to revoke.`);
       return;
     }
   
     const formData = new URLSearchParams();
     formData.append('token', token);
     formData.append('client_id', CLIENT_ID);
     formData.append('client_secret', CLIENT_SECRET);
   
     const base64Creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
   
     try {
       const revokeEndpoint = await getRevokeEndpoint(context);
       const response = await axios.post(revokeEndpoint, formData.toString(), {
         headers: {
           'Authorization': `Basic ${base64Creds}`,
           'Content-Type': 'application/x-www-form-urlencoded'
         }
       });
   
       if (response.status === 200) {
         vscode.window.showInformationMessage(`Successfully revoked the ${tokenType} token.`);
         await context.secrets.delete(storageKey);
       } else {
         throw new Error(`Revoke endpoint returned status ${response.status}`);
       }
     } catch (error: any) {
       vscode.window.showErrorMessage(`Error revoking token: ${error.message}`);
     }
   }
   
   // ------------------------------------------------------------------
   // REFRESH LOGIC
   // ------------------------------------------------------------------
   export async function refreshAccessToken(context: vscode.ExtensionContext): Promise<boolean> {
     const storedRefreshToken = await context.secrets.get('anypoint.refreshToken');
     if (!storedRefreshToken) {
       vscode.window.showErrorMessage('No refresh token found. Please log in again.');
       return false;
     }
   
     const refreshData = new URLSearchParams();
     refreshData.append('grant_type', 'refresh_token');
     refreshData.append('refresh_token', storedRefreshToken);
     refreshData.append('client_id', CLIENT_ID);
     refreshData.append('client_secret', CLIENT_SECRET);
   
     const base64Creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
   
     try {
       const tokenEndpoint = await getTokenEndpoint(context);
       const response = await axios.post(tokenEndpoint, refreshData.toString(), {
         headers: {
           'Authorization': `Basic ${base64Creds}`,
           'Content-Type': 'application/x-www-form-urlencoded'
         }
       });
   
       if (response.status !== 200) {
         throw new Error(`Refresh token request failed with status ${response.status}`);
       }
   
       const tokenData = response.data as {
         access_token?: string;
         refresh_token?: string;
       };
   
       if (!tokenData.access_token) {
         throw new Error(`No new access_token in refresh response: ${JSON.stringify(tokenData)}`);
       }
   
       // Store the new tokens
       await context.secrets.store('anypoint.accessToken', tokenData.access_token);
       if (tokenData.refresh_token) {
         await context.secrets.store('anypoint.refreshToken', tokenData.refresh_token);
       }
   
       //vscode.window.showInformationMessage('Access token refreshed successfully!');
       return true;
     } catch (err: any) {
       vscode.window.showErrorMessage(`Failed to refresh token: ${err.message}`);
       return false;
     }
   }
   
   // ------------------------------------------------------------------
   // GET USER INFO + Org info, with 401 auto-refresh
   // ------------------------------------------------------------------
   export async function getUserInfo(context: vscode.ExtensionContext) {
     // Get region-specific base URL
     const baseUrl = await getBaseUrl(context);
     const apiUrl = `${baseUrl}/accounts/api/me`;

     try {
       const apiHelper = new ApiHelper(context);
       const response = await apiHelper.get(apiUrl);
       const data = response.data;

       // Store user info if you like
       await context.secrets.store('anypoint.userInfo', JSON.stringify(data.user));

       // For demonstration, show a webview or a message
       vscode.window.showInformationMessage(`User Info: ${JSON.stringify(data.user)}`);

     } catch (error: any) {
       vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
     }
   }

   export async function getOrganizationInfo(context: vscode.ExtensionContext) {
     // Get region-specific base URL
     const baseUrl = await getBaseUrl(context);
     const apiUrl = `${baseUrl}/cloudhub/api/organization`;

     try {
       const apiHelper = new ApiHelper(context);
       const response = await apiHelper.get(apiUrl);
       const data = response.data;
       vscode.window.showInformationMessage(`Organization Info: ${JSON.stringify(data)}`);

     } catch (error: any) {
       vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
     }
   }
   
   // ------------------------------------------------------------------
   // GET ENVIRONMENTS
   // ------------------------------------------------------------------
   export async function getEnvironments(context: vscode.ExtensionContext) {
     const userInfoStr = await context.secrets.get('anypoint.userInfo');

     if (!userInfoStr) {
       throw new Error('No user info found. Please log in first.');
     }

     const userInfoData = JSON.parse(userInfoStr);
     const orgId = userInfoData.organization.id;

     // Get region-specific base URL
     const baseUrl = await getBaseUrl(context);
     const apiUrl = `${baseUrl}/accounts/api/organizations/${orgId}/environments`;
   
     try {
       const apiHelper = new ApiHelper(context);
       const response = await apiHelper.get(apiUrl);
       const data = response.data;
       
       // Store them in secrets for later
       await context.secrets.store('anypoint.environments', JSON.stringify(data));
       vscode.window.showInformationMessage('Environments saved successfully.');
   
     } catch (error: any) {
       vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
     }
   }
   
   // ------------------------------------------------------------------
   // SHOW ENVIRONMENT & ORG PANEL (Now with auto-refresh if 401)
   // ------------------------------------------------------------------
   export async function developerInfo(context: vscode.ExtensionContext) {
     // This command was originally called in your code to show the environment & org panel
     const storedUserInfo = await context.secrets.get('anypoint.userInfo');
     const storedEnvironments = await context.secrets.get('anypoint.environments');
   
     if (!storedUserInfo || !storedEnvironments) {
       vscode.window.showErrorMessage('User info or environment info not found. Please log in first.');
       return;
     }
   
     const userInfo = JSON.parse(storedUserInfo);
     const parsedEnvironments = JSON.parse(storedEnvironments); // { data: [...], total: N }
   
     await showEnvironmentAndOrgPanel(
       context,
       { orgName: '-', orgId: userInfo.organization.id },
       parsedEnvironments.data
     );
   }
   
   /**
    * showEnvironmentAndOrgPanel with 401 handling
    */
   export async function showEnvironmentAndOrgPanel(
     context: vscode.ExtensionContext,
     userInfo: { orgName: string; orgId: string },
     environments: IEnvironment[]
   ) {
     // Get region-specific base URL
     const baseUrl = await getBaseUrl(context);
     const url = `${baseUrl}/accounts/api/organizations/${userInfo.orgId}/clients`;
   
     try {
       const apiHelper = new ApiHelper(context);
       const response = await apiHelper.get(url);
   
       // 2) Separate clients into environment-specific and general clients
       const envClients: Array<{
         client_id: string;
         client_secret: string;
         name: string;
       }> = [];
       
       const generalClients: Array<{
         client_id: string;
         client_secret: string;
         name: string;
       }> = [];
   
       const allClients = response.data;
       for (const key of Object.keys(allClients)) {
         const c = allClients[key];
         if (c.name && c.name.includes('- Env:')) {
           envClients.push({
             client_id: c.client_id,
             client_secret: c.client_secret,
             name: c.name
           });
         } else if (c.name) {
           generalClients.push({
             client_id: c.client_id,
             client_secret: c.client_secret,
             name: c.name
           });
         }
       }
   
       // 3) Create the Webview
       const panel = vscode.window.createWebviewPanel(
         'environmentOrgView',
         'Environment & Organization Info',
         vscode.ViewColumn.One,
         { enableScripts: true }
       );
       panel.webview.html = getEnvironmentOrgHtml(
         panel.webview,
         context.extensionUri,
         userInfo,
         environments,
         envClients,
         generalClients
       );
   
     } catch (error: any) {
       vscode.window.showErrorMessage(`Error fetching clients: ${error.message}`);
     }
   }
   
/**
 * Builds the HTML for the environment/org panel
 * with separate Show/Hide and Copy buttons for client secrets,
 * using the dark theme + top navbar for consistency.
 */
function getEnvironmentOrgHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  userInfo: { orgName: string; orgId: string },
  environments: Array<{ id: string; name: string }>,
  envClients: Array<{ client_id: string; client_secret: string; name: string }>,
  generalClients: Array<{ client_id: string; client_secret: string; name: string }>
): string {
  // Build environment table
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);
  const environmentRows = environments.map(env => {
    return /*html*/`
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="status-indicator">
              <span class="status-dot"></span>
              Active
            </span>
            ${env.name || '(No Name)'}
          </div>
        </td>
        <td>
          <span class="copyable" data-copy="${env.id || ''}" title="Copy Environment ID">
            ${env.id || '(No ID)'}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  // Build environment-specific clients table
  const envClientRows = envClients.map(client => {
    return /*html*/`
      <tr>
        <td>${client.name}</td>
        <td>
          <span class="copyable" data-copy="${client.client_id}" title="Copy Client ID">
            ${client.client_id}
          </span>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <!-- The real secret is stored in data-secret; default hidden -->
            <span class="client-secret"
                  data-state="hidden"
                  data-secret="${client.client_secret}">
              *****
            </span>

            <!-- Toggle button to show/hide secret -->
            <button class="button toggle-secret">
              Show
            </button>

            <!-- Separate button to copy the real secret -->
            <button class="button copy-secret">
              Copy
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Build general clients table
  const generalClientRows = generalClients.map(client => {
    return /*html*/`
      <tr>
        <td>${client.name}</td>
        <td>
          <span class="copyable" data-copy="${client.client_id}" title="Copy Client ID">
            ${client.client_id}
          </span>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <!-- The real secret is stored in data-secret; default hidden -->
            <span class="client-secret"
                  data-state="hidden"
                  data-secret="${client.client_secret}">
              *****
            </span>

            <!-- Toggle button to show/hide secret -->
            <button class="button toggle-secret">
              Show
            </button>

            <!-- Separate button to copy the real secret -->
            <button class="button copy-secret">
              Copy
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Construct the HTML with the dark theme + top navbar
  return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Environment & Org Info</title>

  <!-- Fira Code for tech vibe -->
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap"
  />

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

    /* Card Styling */
    .data-card {
      background-color: var(--surface-primary);
      border: 1px solid var(--border-primary);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 32px;
    }

    .card-header {
      margin-bottom: 20px;
    }

    .card-header h2 {
      font-size: 20px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }

    .card-subtitle {
      display: block;
      font-size: 14px;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    thead th {
      background-color: var(--surface-secondary);
      color: var(--text-secondary);
      text-align: left;
      padding: 12px;
      border-bottom: 1px solid var(--border-primary);
      font-weight: 500;
      font-size: 13px;
    }

    tbody td {
      border-bottom: 1px solid var(--border-muted);
      padding: 12px;
      vertical-align: middle;
      color: var(--text-primary);
    }

    tbody tr:hover {
      background-color: var(--surface-secondary);
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    /* Buttons */
    .button {
      padding: 6px 12px;
      font-size: 12px;
      color: var(--text-primary);
      background-color: var(--accent-blue);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
      margin-left: 8px;
    }

    .button:hover {
      background-color: var(--accent-light);
      transform: translateY(-1px);
    }

    .button:active {
      transform: translateY(0);
    }

    /* Secret and Copyable Elements */
    .client-secret {
      font-family: 'Courier New', monospace;
      background-color: var(--surface-secondary);
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid var(--border-primary);
      min-width: 80px;
      display: inline-block;
    }

    .copyable {
      color: var(--accent-blue);
      cursor: pointer;
      font-family: 'Courier New', monospace;
      background-color: var(--surface-secondary);
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid var(--border-primary);
      transition: all 0.2s;
    }

    .copyable:hover {
      background-color: var(--surface-accent);
      border-color: var(--accent-blue);
      color: var(--accent-light);
    }

    .copy-feedback {
      display: none;
      color: var(--success);
      font-size: 12px;
      margin-left: 8px;
      font-weight: 500;
    }

    /* Status Indicators */
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      background-color: rgba(88, 166, 255, 0.15);
      color: var(--accent-blue);
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

      .button {
        margin-left: 4px;
        margin-top: 4px;
      }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-content">
      <h1>Developer Utilities</h1>
      <p>Environment information and organization client details for development use</p>
    </div>
  </div>

  <!-- Main Content -->
  <div class="container">
    <!-- Statistics Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-header">
          <h3 class="stat-title">Environments</h3>
        </div>
        <div class="stat-value">${environments.length}</div>
        <p class="stat-subtitle">Available environments</p>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <h3 class="stat-title">Client Credentials</h3>
        </div>
        <div class="stat-value">${envClients.length}</div>
        <p class="stat-subtitle">Environment-specific clients</p>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <h3 class="stat-title">General Clients</h3>
        </div>
        <div class="stat-value">${generalClients.length}</div>
        <p class="stat-subtitle">All other client credentials</p>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <h3 class="stat-title">Organization</h3>
        </div>
        <div class="stat-value copyable" style="font-size: 14px; cursor: pointer;" data-copy="${userInfo.orgId}" title="Click to copy Organization ID">${userInfo.orgId}</div>
        <p class="stat-subtitle">Organization ID (click to copy)</p>
      </div>
    </div>

    <!-- Environments Card -->
    <div class="data-card">
      <div class="card-header">
        <h2>Environments</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>Environment Name</th>
            <th>Environment ID</th>
          </tr>
        </thead>
        <tbody>
          ${environmentRows}
        </tbody>
      </table>
    </div>

    <!-- Environment-Specific Client Credentials Card -->
    <div class="data-card">
      <div class="card-header">
        <h2>Environment-Specific Client Credentials</h2>
        <span class="card-subtitle">Client credentials with "- Env:" designation</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Client Name</th>
            <th>Client ID</th>
            <th>Client Secret</th>
          </tr>
        </thead>
        <tbody>
          ${envClientRows}
        </tbody>
      </table>
    </div>

    <!-- General Client Credentials Card -->
    <div class="data-card">
      <div class="card-header">
        <h2>All Other Client Credentials</h2>
        <span class="card-subtitle">All other client credentials in the organization</span>
      </div>

      <!-- Filter Box -->
      <div style="margin-bottom: 16px;">
        <input
          type="text"
          id="generalClientsFilter"
          placeholder="Filter by client name, ID, or secret..."
          style="width: 100%; padding: 10px 12px; font-size: 14px; background-color: var(--surface-secondary); border: 1px solid var(--border-primary); border-radius: 6px; color: var(--text-primary); font-family: inherit;"
        />
      </div>

      <table id="generalClientsTable">
        <thead>
          <tr>
            <th>Client Name</th>
            <th>Client ID</th>
            <th>Client Secret</th>
          </tr>
        </thead>
        <tbody>
          ${generalClientRows}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    // Show "Copied!" feedback for ~1.2 seconds
    function showCopiedFeedback(el) {
      const feedback = document.createElement('span');
      feedback.className = 'copy-feedback';
      feedback.textContent = 'Copied!';
      el.insertAdjacentElement('afterend', feedback);
      feedback.style.display = 'inline';
      setTimeout(() => feedback.remove(), 1200);
    }

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;

      // Toggle-secret button
      if (target.classList.contains('toggle-secret')) {
        const secretSpan = target.closest('td')?.querySelector('.client-secret');
        if (!secretSpan) return;

        const state = secretSpan.getAttribute('data-state') || 'hidden';
        const realSecret = secretSpan.getAttribute('data-secret') || '';

        if (state === 'hidden') {
          // Reveal
          secretSpan.textContent = realSecret;
          secretSpan.setAttribute('data-state', 'visible');
          target.textContent = 'Hide';
        } else {
          // Hide
          secretSpan.textContent = '*****';
          secretSpan.setAttribute('data-state', 'hidden');
          target.textContent = 'Show';
        }
      }

      // Copy-secret button
      if (target.classList.contains('copy-secret')) {
        const secretSpan = target.closest('td')?.querySelector('.client-secret');
        if (!secretSpan) return;
        const realSecret = secretSpan.getAttribute('data-secret') || '';
        navigator.clipboard.writeText(realSecret)
          .then(() => showCopiedFeedback(target))
          .catch(err => console.error('Failed to copy secret:', err));
      }

      // Clickable client ID
      if (target.classList.contains('copyable')) {
        const toCopy = target.getAttribute('data-copy') || '';
        navigator.clipboard.writeText(toCopy)
          .then(() => showCopiedFeedback(target))
          .catch(err => console.error('Failed to copy ID:', err));
      }
    });

    // Filter functionality for general clients table
    const filterInput = document.getElementById('generalClientsFilter');
    const generalTable = document.getElementById('generalClientsTable');

    if (filterInput && generalTable) {
      filterInput.addEventListener('input', (e) => {
        const filterValue = e.target.value.toLowerCase().trim();
        const tbody = generalTable.querySelector('tbody');
        const rows = tbody ? tbody.querySelectorAll('tr') : [];

        rows.forEach(row => {
          // Get all text content from the row (name, ID, and secret)
          const cells = row.querySelectorAll('td');
          let rowText = '';

          cells.forEach(cell => {
            // For secret cells, check both visible text and the data-secret attribute
            const secretSpan = cell.querySelector('.client-secret');
            if (secretSpan) {
              const realSecret = secretSpan.getAttribute('data-secret') || '';
              rowText += ' ' + realSecret.toLowerCase();
            }
            // Add all visible text
            rowText += ' ' + cell.textContent.toLowerCase();
          });

          // Show row if it matches the filter, hide otherwise
          if (rowText.includes(filterValue)) {
            row.style.display = '';
          } else {
            row.style.display = 'none';
          }
        });
      });
    }
  </script>
</body>
</html>
  `;
}