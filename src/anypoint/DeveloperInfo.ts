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
   
   // ------------------------------------------------------------------
   // CONSTANTS & CONFIG
   // ------------------------------------------------------------------
   const BASE_URL = 'https://anypoint.mulesoft.com';
   
   // MuleSoft OAuth Endpoints
   const AUTHORIZATION_ENDPOINT = BASE_URL + '/accounts/api/v2/oauth2/authorize';
   const TOKEN_ENDPOINT = BASE_URL + '/accounts/api/v2/oauth2/token';
   const REVOKE_ENDPOINT = BASE_URL + '/accounts/api/v2/oauth2/revoke';
   
   // Example redirect URL (must match your MuleSoft OAuth app settings)
   const LOCAL_REDIRECT_URI = 'http://localhost:8082/callback';
   
   // Hardcoded for demonstration. In production, store these securely or prompt user.
   const CLIENT_ID = '05ce4abd0fc047b4bcd512f15b3445c9';
   const CLIENT_SECRET = 'b5d7dBEe693c4C3fa50C183A3f6570D2';
   
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
   
     server.listen(8082, () => {
       // 2) Build the authorization URL
       const authUrl = new URL(AUTHORIZATION_ENDPOINT);
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
   
     const response = await axios.post(TOKEN_ENDPOINT, data.toString(), {
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
       const response = await axios.post(REVOKE_ENDPOINT, formData.toString(), {
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
       const response = await axios.post(TOKEN_ENDPOINT, refreshData.toString(), {
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
     let accessToken = await context.secrets.get('anypoint.accessToken');
     if (!accessToken) {
       throw new Error('No access token found. Please log in first.');
     }
   
     const apiUrl = `${BASE_URL}/accounts/api/me`;
   
     try {
       const response = await axios.get(apiUrl, {
         headers: { Authorization: `Bearer ${accessToken}` }
       });
   
       if (response.status !== 200) {
         throw new Error(`API request failed with status ${response.status}`);
       }
   
       const data = response.data;
       // Store user info if you like
       await context.secrets.store('anypoint.userInfo', JSON.stringify(data.user));
   
       // For demonstration, show a webview or a message
       vscode.window.showInformationMessage(`User Info: ${JSON.stringify(data.user)}`);
   
     } catch (error: any) {
       if (error.response?.status === 401) {
         vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
   
         const didRefresh = await refreshAccessToken(context);
         if (!didRefresh) {
           vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
           return;
         }
   
         // Retry
         accessToken = await context.secrets.get('anypoint.accessToken');
         if (!accessToken) {
           vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
           return;
         }
   
         try {
           const retryResp = await axios.get(apiUrl, {
             headers: { Authorization: `Bearer ${accessToken}` }
           });
           if (retryResp.status !== 200) {
             throw new Error(`Retry API request failed with status ${retryResp.status}`);
           }
           const data = retryResp.data;
           vscode.window.showInformationMessage(`User Info (refreshed): ${JSON.stringify(data.user)}`);
         } catch (retryError: any) {
           vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
         }
       } else {
         vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
       }
     }
   }
   
   export async function getOrganizationInfo(context: vscode.ExtensionContext) {
     let accessToken = await context.secrets.get('anypoint.accessToken');
     if (!accessToken) {
       throw new Error('No access token found. Please log in first.');
     }
   
     const apiUrl = `${BASE_URL}/cloudhub/api/organization`;
   
     try {
       const response = await axios.get(apiUrl, {
         headers: { Authorization: `Bearer ${accessToken}` }
       });
   
       if (response.status !== 200) {
         throw new Error(`API request failed with status ${response.status}`);
       }
   
       const data = response.data;
       vscode.window.showInformationMessage(`Organization Info: ${JSON.stringify(data)}`);
   
     } catch (error: any) {
       if (error.response?.status === 401) {
         vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
   
         const didRefresh = await refreshAccessToken(context);
         if (!didRefresh) {
           vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
           return;
         }
   
         // Retry
         accessToken = await context.secrets.get('anypoint.accessToken');
         if (!accessToken) {
           vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
           return;
         }
   
         try {
           const retryResp = await axios.get(apiUrl, {
             headers: { Authorization: `Bearer ${accessToken}` }
           });
           if (retryResp.status !== 200) {
             throw new Error(`Retry API request failed with status ${retryResp.status}`);
           }
           const data = retryResp.data;
           vscode.window.showInformationMessage(`Organization Info (refreshed): ${JSON.stringify(data)}`);
         } catch (retryError: any) {
           vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
         }
       } else {
         vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
       }
     }
   }
   
   // ------------------------------------------------------------------
   // GET ENVIRONMENTS
   // ------------------------------------------------------------------
   export async function getEnvironments(context: vscode.ExtensionContext) {
     let accessToken = await context.secrets.get('anypoint.accessToken');
     const userInfoStr = await context.secrets.get('anypoint.userInfo');
   
     if (!accessToken || !userInfoStr) {
       throw new Error('No access token or user info found. Please log in first.');
     }
   
     const userInfoData = JSON.parse(userInfoStr);
     const orgId = userInfoData.organization.id;
     const apiUrl = `${BASE_URL}/accounts/api/organizations/${orgId}/environments`;
   
     try {
       const response = await axios.get(apiUrl, {
         headers: { Authorization: `Bearer ${accessToken}` }
       });
   
       if (response.status !== 200) {
         throw new Error(`API request failed with status ${response.status}`);
       }
   
       const data = response.data;
       // Store them in secrets for later
       await context.secrets.store('anypoint.environments', JSON.stringify(data));
       vscode.window.showInformationMessage('Environments saved successfully.');
   
     } catch (error: any) {
       if (error.response?.status === 401) {
         vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
   
         const didRefresh = await refreshAccessToken(context);
         if (!didRefresh) {
           vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
           return;
         }
   
         // Retry
         accessToken = await context.secrets.get('anypoint.accessToken');
         if (!accessToken) {
           vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
           return;
         }
   
         try {
           const retryResp = await axios.get(apiUrl, {
             headers: { Authorization: `Bearer ${accessToken}` }
           });
           if (retryResp.status !== 200) {
             throw new Error(`Retry API request failed with status ${retryResp.status}`);
           }
           const data = retryResp.data;
           await context.secrets.store('anypoint.environments', JSON.stringify(data));
           vscode.window.showInformationMessage('Environments saved (after refresh).');
         } catch (retryError: any) {
           vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
         }
       } else {
         vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
       }
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
     let accessToken = await context.secrets.get('anypoint.accessToken');
     if (!accessToken) {
       vscode.window.showErrorMessage('No access token found. Please log in first.');
       return;
     }
   
     const url = `https://anypoint.mulesoft.com/accounts/api/organizations/${userInfo.orgId}/clients`;
   
     try {
       // 1) Try the request
       const response = await axios.get(url, {
         headers: { Authorization: `Bearer ${accessToken}` },
       });
   
       // 2) Filter for records where name includes '- Env:'
       const merakiClients: Array<{
         client_id: string;
         client_secret: string;
         name: string;
       }> = [];
   
       const allClients = response.data;
       for (const key of Object.keys(allClients)) {
         const c = allClients[key];
         if (c.name && c.name.includes('- Env:')) {
           merakiClients.push({
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
         merakiClients
       );
   
     } catch (error: any) {
       const axiosErr = error as AxiosError;
       if (axiosErr.response && axiosErr.response.status === 401) {
         vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
         const didRefresh = await refreshAccessToken(context);
         if (!didRefresh) {
           vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
           return;
         }
   
         accessToken = await context.secrets.get('anypoint.accessToken');
         if (!accessToken) {
           vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
           return;
         }
   
         // Retry once
         try {
           const retryResp = await axios.get(url, {
             headers: { Authorization: `Bearer ${accessToken}` },
           });
   
           const allClients = retryResp.data;
           const merakiClients: Array<{
             client_id: string;
             client_secret: string;
             name: string;
           }> = [];
   
           for (const key of Object.keys(allClients)) {
             const c = allClients[key];
             if (c.name && c.name.includes('- Env:')) {
               merakiClients.push({
                 client_id: c.client_id,
                 client_secret: c.client_secret,
                 name: c.name
               });
             }
           }
   
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
             merakiClients
           );
   
         } catch (retryErr: any) {
           vscode.window.showErrorMessage(`Retry after refresh failed: ${retryErr.message}`);
         }
       } else {
         vscode.window.showErrorMessage(`Error fetching clients: ${error.message}`);
       }
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
  merakiClients: Array<{ client_id: string; client_secret: string; name: string }>

): string {
  // Build environment table
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);
  const environmentRows = environments.map(env => {
    return /*html*/`
      <tr>
        <td>${env.name || '(No Name)'}</td>
        <td>${env.id || '(No ID)'}</td>
      </tr>
    `;
  }).join('');

  // Build clients table
  const clientRows = merakiClients.map(client => {
    return /*html*/`
      <tr>
        <td>${client.name}</td>
        <td>
          <span class="copyable" data-copy="${client.client_id}" title="Copy Client ID">
            ${client.client_id}
          </span>
        </td>
        <td>
          <!-- The real secret is stored in data-secret; default hidden -->
          <span class="client-secret"
                data-state="hidden"
                data-secret="${client.client_secret}">
            *****
          </span>

          <!-- Toggle button to show/hide secret -->
          <button class="button toggle-secret" style="margin-left:6px">
            Show
          </button>

          <!-- Separate button to copy the real secret -->
          <button class="button copy-secret" style="margin-left:6px">
            Copy
          </button>
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
      font-size: 12px;
    }

    /* NAVBAR (same style as your other pages) */
    .navbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: var(--navbar-color);
      padding: 0.5rem 1rem;
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
      gap: 0.75rem;
    }
    .navbar-right a {
      color: var(--navbar-text-color);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.75rem;
    }
    .navbar-right a:hover {
      text-decoration: underline;
    }

    /* CONTAINER */
    .container {
      width: 90%;
      max-width: 1200px;
      margin: 0.75rem auto;
    }

    /* CARD */
    .card {
      background-color: var(--card-color);
      border: 1px solid #30363D;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 1rem;
    }
    .card-header {
      margin-bottom: 0.75rem;
    }
    .card-header h2 {
      margin: 0;
      font-size: 0.9rem;
      color: var(--accent-color);
    }

    /* TABLES */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
    }
    thead th {
      background-color: #21262D; /* Slightly darker for table header */
      color: var(--accent-color);
      text-align: left;
      padding: 0.5rem;
      border-bottom: 1px solid #30363D;
      white-space: nowrap;
    }
    tbody td {
      border-bottom: 1px solid #30363D;
      padding: 0.5rem;
      vertical-align: middle;
    }
    tbody tr:hover {
      background-color: var(--table-hover-color);
    }

    /* BUTTON */
    .button {
      padding: 4px 8px;
      font-size: 0.75rem;
      color: #fff;
      background-color: var(--accent-color);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
    }
    .button:hover {
      background-color: var(--button-hover-color);
    }

    .client-secret {
      margin-left: 4px;
    }
    .copyable {
      text-decoration: underline;
      color: var(--accent-color);
      cursor: pointer;
    }
    .copyable:hover {
      color: #6FB8FF; /* slightly lighter on hover */
    }
    .copy-feedback {
      display: none;
      color: #98EE99; /* light green */
      font-size: 0.7rem;
      margin-left: 0.5rem;
    }
  </style>
</head>
<body>
  <!-- TOP NAVBAR (for consistent look) -->
  <nav class="navbar">
    <div class="navbar-left">
      <img src="${logoSrc}" alt="Logo"/>
      <h1>Anypoint Monitor Extension</h1>
    </div>
    <div class="navbar-right">
      <a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor">About</a>
      <a href="https://www.buymeacoffee.com/yucelmoran">Buy Me a Coffee</a>
    </div>
  </nav>

  <!-- MAIN CONTENT -->
  <div class="container">
    <!-- Card: Orgs & Envs -->
    <div class="card">
      <div class="card-header">
        <h2>Organization: ${userInfo.orgName} (ID: ${userInfo.orgId})</h2>
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

    <!-- Card: Clients -->
    <div class="card">
      <div class="card-header">
        <h2>Clients Environments</h2>
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
          ${clientRows}
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
  </script>
</body>
</html>
  `;
}