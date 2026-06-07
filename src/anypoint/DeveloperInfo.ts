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
   import {
     wrapWebviewHtml,
     badge,
     summaryCard,
     escapeHtml,
     escapeAttr,
   } from '../webview/ui-kit';

   // Track open Developer Utilities panel
   let developerUtilitiesPanel: vscode.WebviewPanel | undefined;

   /**
    * Close the Developer Utilities panel if it's open
    */
   export function closeDeveloperUtilitiesPanel(): void {
     if (developerUtilitiesPanel) {
       console.log('Closing Developer Utilities panel due to business group change');
       developerUtilitiesPanel.dispose();
       developerUtilitiesPanel = undefined;
     }
   }

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
     // Use multi-account system to get active account data
     const accountService = new AccountService(context);
     const activeAccount = await accountService.getActiveAccount();

     if (!activeAccount) {
       vscode.window.showErrorMessage('No active account found. Please log in first.');
       return;
     }

     // Get user info and environments from active account
     let storedUserInfo = await accountService.getActiveAccountUserInfo();
     let storedEnvironments = await accountService.getActiveAccountEnvironments();

     // Fallback to legacy storage if needed (for backward compatibility)
     if (!storedUserInfo) {
       storedUserInfo = await context.secrets.get('anypoint.userInfo');
     }
     if (!storedEnvironments) {
       storedEnvironments = await context.secrets.get('anypoint.environments');
     }

     if (!storedUserInfo || !storedEnvironments) {
       vscode.window.showErrorMessage('User info or environment info not found. Please log in first.');
       return;
     }

     const userInfo = JSON.parse(storedUserInfo);
     const parsedEnvironments = JSON.parse(storedEnvironments); // { data: [...], total: N }

     // Get effective organization ID (business group if selected, otherwise root org)
     const effectiveOrgId = await accountService.getEffectiveOrganizationId();
     const businessGroup = await accountService.getActiveAccountBusinessGroup();

     console.log(`Developer Utilities - Business Group: ${businessGroup?.name} (${businessGroup?.id})`);
     console.log(`Developer Utilities - Effective Org ID: ${effectiveOrgId}`);
     console.log(`Developer Utilities - Environments count: ${parsedEnvironments.data?.length || 0}`);
     console.log(`Developer Utilities - Environments:`, parsedEnvironments.data?.map((e: any) => e.name).join(', '));

     await showEnvironmentAndOrgPanel(
       context,
       {
         orgName: businessGroup?.name || userInfo.organization.name || '-',
         orgId: effectiveOrgId || userInfo.organization.id
       },
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
   
       // 3) Close existing panel if open (to refresh with new BG data)
       if (developerUtilitiesPanel) {
         developerUtilitiesPanel.dispose();
       }

       // 4) Create the Webview
       developerUtilitiesPanel = vscode.window.createWebviewPanel(
         'environmentOrgView',
         'Environment & Organization Info',
         vscode.ViewColumn.One,
         { enableScripts: true }
       );

       // Track when panel is closed
       developerUtilitiesPanel.onDidDispose(() => {
         developerUtilitiesPanel = undefined;
       });

       developerUtilitiesPanel.webview.html = getEnvironmentOrgHtml(
         developerUtilitiesPanel.webview,
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
  _webview: vscode.Webview,
  _extensionUri: vscode.Uri,
  userInfo: { orgName: string; orgId: string },
  environments: Array<{ id: string; name: string }>,
  envClients: Array<{ client_id: string; client_secret: string; name: string }>,
  generalClients: Array<{ client_id: string; client_secret: string; name: string }>
): string {
  const environmentRows = environments
    .map(
      env => /*html*/ `
      <tr class="am-row">
        <td>
          <div class="dev-env-name-cell">
            ${badge('Active', 'success', true)}
            <span>${escapeHtml(env.name || '(No Name)')}</span>
          </div>
        </td>
        <td>
          <span class="copyable" data-copy="${escapeAttr(env.id || '')}" title="Copy Environment ID">
            ${escapeHtml(env.id || '(No ID)')}
          </span>
        </td>
      </tr>
    `
    )
    .join('');

  const secretButtons = /*html*/ `
    <div class="dev-secret-actions">
      <span class="client-secret" data-state="hidden" data-secret="__SECRET__">*****</span>
      <button type="button" class="am-btn am-btn-secondary toggle-secret">Show</button>
      <button type="button" class="am-btn am-btn-secondary copy-secret">Copy</button>
    </div>
  `;

  const envClientRows = envClients
    .map(client => {
      const actions = secretButtons.replace('__SECRET__', escapeAttr(client.client_secret));
      return /*html*/ `
      <tr class="am-row">
        <td>${escapeHtml(client.name)}</td>
        <td>
          <span class="copyable" data-copy="${escapeAttr(client.client_id)}" title="Copy Client ID">
            ${escapeHtml(client.client_id)}
          </span>
        </td>
        <td>${actions}</td>
      </tr>
    `;
    })
    .join('');

  const generalClientRows = generalClients
    .map(client => {
      const actions = secretButtons.replace('__SECRET__', escapeAttr(client.client_secret));
      return /*html*/ `
      <tr class="am-row">
        <td>${escapeHtml(client.name)}</td>
        <td>
          <span class="copyable" data-copy="${escapeAttr(client.client_id)}" title="Copy Client ID">
            ${escapeHtml(client.client_id)}
          </span>
        </td>
        <td>${actions}</td>
      </tr>
    `;
    })
    .join('');

  const summaryCardsHtml = `
    ${summaryCard({
      icon: '🌍',
      value: environments.length,
      label: 'Available environments',
      animationDelay: '0s',
    })}
    ${summaryCard({
      icon: '🔑',
      value: envClients.length,
      label: 'Environment-specific clients',
      animationDelay: '0.05s',
    })}
    ${summaryCard({
      icon: '📋',
      value: generalClients.length,
      label: 'All other client credentials',
      animationDelay: '0.1s',
    })}
    <div class="am-summary-card" style="animation-delay: 0.15s">
      <div class="am-card-icon">🏢</div>
      <div
        class="am-card-value dev-org-id-value copyable"
        data-copy="${escapeAttr(userInfo.orgId)}"
        title="Click to copy Organization ID"
      >${escapeHtml(userInfo.orgId)}</div>
      <div class="am-card-label">Organization ID (click to copy)</div>
    </div>
  `;

  const extraStyles = `
    .dev-page-subtitle {
      font-size: 13px;
      color: var(--am-text-secondary);
      margin-top: 6px;
      max-width: 640px;
      line-height: 1.45;
    }
    .dev-section-card {
      margin-bottom: 24px;
    }
    .dev-section-card h2 {
      font-size: 16px;
      font-weight: 600;
      color: var(--am-text-primary);
      margin-bottom: 4px;
    }
    .dev-card-subtitle {
      display: block;
      font-size: 13px;
      color: var(--am-text-secondary);
      margin-bottom: 16px;
    }
    .dev-env-name-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .dev-secret-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .client-secret {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--am-bg-secondary);
      padding: 4px 8px;
      border-radius: var(--am-radius-sm);
      border: 1px solid var(--am-border);
      min-width: 80px;
      display: inline-block;
      font-size: 12px;
    }
    .copyable {
      color: var(--am-info);
      cursor: pointer;
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--am-bg-secondary);
      padding: 4px 8px;
      border-radius: var(--am-radius-sm);
      border: 1px solid var(--am-border);
      transition: border-color 0.2s, background 0.2s;
      font-size: 12px;
    }
    .copyable:hover {
      background: var(--am-bg-surface-hover);
      border-color: var(--am-info);
      color: var(--am-text-link-active);
    }
    .copy-feedback {
      display: none;
      color: var(--am-success);
      font-size: 12px;
      margin-left: 8px;
      font-weight: 500;
    }
    .dev-org-id-value {
      font-size: 14px;
      font-weight: 600;
      word-break: break-all;
      line-height: 1.3;
    }
    .dev-filter-wrap {
      margin-bottom: 16px;
    }
    .dev-filter-wrap .am-input {
      width: 100%;
      box-sizing: border-box;
    }
  `;

  const scripts = `
    function showCopiedFeedback(el) {
      const feedback = document.createElement('span');
      feedback.className = 'copy-feedback';
      feedback.textContent = 'Copied!';
      el.insertAdjacentElement('afterend', feedback);
      feedback.style.display = 'inline';
      setTimeout(function () { feedback.remove(); }, 1200);
    }

    document.addEventListener('click', function (e) {
      const target = e.target;
      if (!target) return;

      if (target.classList.contains('toggle-secret')) {
        const secretSpan = target.closest('td') && target.closest('td').querySelector('.client-secret');
        if (!secretSpan) return;

        const state = secretSpan.getAttribute('data-state') || 'hidden';
        const realSecret = secretSpan.getAttribute('data-secret') || '';

        if (state === 'hidden') {
          secretSpan.textContent = realSecret;
          secretSpan.setAttribute('data-state', 'visible');
          target.textContent = 'Hide';
        } else {
          secretSpan.textContent = '*****';
          secretSpan.setAttribute('data-state', 'hidden');
          target.textContent = 'Show';
        }
      }

      if (target.classList.contains('copy-secret')) {
        const secretSpan = target.closest('td') && target.closest('td').querySelector('.client-secret');
        if (!secretSpan) return;
        const realSecret = secretSpan.getAttribute('data-secret') || '';
        navigator.clipboard.writeText(realSecret)
          .then(function () { showCopiedFeedback(target); })
          .catch(function (err) { console.error('Failed to copy secret:', err); });
      }

      if (target.classList.contains('copyable')) {
        const toCopy = target.getAttribute('data-copy') || '';
        navigator.clipboard.writeText(toCopy)
          .then(function () { showCopiedFeedback(target); })
          .catch(function (err) { console.error('Failed to copy ID:', err); });
      }
    });

    const filterInput = document.getElementById('generalClientsFilter');
    const generalTable = document.getElementById('generalClientsTable');

    if (filterInput && generalTable) {
      filterInput.addEventListener('input', function (e) {
        const filterValue = e.target.value.toLowerCase().trim();
        const tbody = generalTable.querySelector('tbody');
        const rows = tbody ? tbody.querySelectorAll('tr') : [];

        rows.forEach(function (row) {
          const cells = row.querySelectorAll('td');
          let rowText = '';

          cells.forEach(function (cell) {
            const secretSpan = cell.querySelector('.client-secret');
            if (secretSpan) {
              const realSecret = secretSpan.getAttribute('data-secret') || '';
              rowText += ' ' + realSecret.toLowerCase();
            }
            rowText += ' ' + cell.textContent.toLowerCase();
          });

          if (rowText.includes(filterValue)) {
            row.style.display = '';
          } else {
            row.style.display = 'none';
          }
        });
      });
    }
  `;

  const body = `
    <div class="am-container">
      <header class="am-page-header">
        <div>
          <h1>Developer Utilities</h1>
          <p class="dev-page-subtitle">
            Environment information and organization client details for development use
          </p>
        </div>
      </header>

      <div class="am-summary-cards">
        ${summaryCardsHtml}
      </div>

      <section class="am-card dev-section-card">
        <h2>Environments</h2>
        <div class="am-table-container">
          <table class="am-table">
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
      </section>

      <section class="am-card dev-section-card">
        <h2>Environment-Specific Client Credentials</h2>
        <span class="dev-card-subtitle">Client credentials with "- Env:" designation</span>
        <div class="am-table-container">
          <table class="am-table">
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
      </section>

      <section class="am-card dev-section-card">
        <h2>All Other Client Credentials</h2>
        <span class="dev-card-subtitle">All other client credentials in the organization</span>

        <div class="dev-filter-wrap">
          <input
            type="text"
            class="am-input"
            id="generalClientsFilter"
            placeholder="Filter by client name, ID, or secret..."
          />
        </div>

        <div class="am-table-container">
          <table class="am-table" id="generalClientsTable">
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
      </section>
    </div>
  `;

  return wrapWebviewHtml({
    title: 'Environment & Org Info',
    body,
    scripts,
    extraStyles,
  });
}