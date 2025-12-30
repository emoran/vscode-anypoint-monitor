import * as vscode from 'vscode';
import axios from 'axios';
import * as http from 'http';
import { CLIENT_ID, CLIENT_SECRET, LOCAL_REDIRECT_URI, getCredentialsForRegion } from '../constants';
import { RegionService } from './regionService';

// Global variable to track if a server is running
let globalOAuthServer: http.Server | null = null;

// Function to kill any process using port 8082
async function killPortProcess(port: number): Promise<void> {
    return new Promise((resolve) => {
        // Try to find and kill the process using the port (Unix/Mac)
        const { exec } = require('child_process');
        exec(`lsof -ti:${port} | xargs kill -9`, (error: any) => {
            // Ignore errors (port might not be in use)
            console.log(`Attempted to kill process on port ${port}`);
            resolve();
        });
    });
}

export async function loginToAnypointWithOAuth(context: vscode.ExtensionContext, addNewAccount: boolean = false): Promise<void> {
    console.log('Starting OAuth login, addNewAccount:', addNewAccount);

    // Clear any stale temp region from previous failed attempts
    const regionService = new RegionService(context);
    await regionService.clearTempRegion();

    // Prompt user to select region first
    const selectedRegion = await regionService.selectRegion();

    if (!selectedRegion) {
        vscode.window.showInformationMessage('Region selection cancelled.');
        return;
    }

    console.log(`Selected region: ${selectedRegion.name} (${selectedRegion.baseUrl})`);

    // Store temporary region for use during the OAuth flow
    await regionService.setTempRegion(selectedRegion.id);
    console.log(`Stored temp region: ${selectedRegion.id}`);

    // Close any existing OAuth server first
    if (globalOAuthServer) {
        console.log('Closing existing OAuth server...');
        globalOAuthServer.close();
        globalOAuthServer = null;
    }

    // Try to kill any process using port 8082
    await killPortProcess(8082);

    // Wait a bit for the port to be released
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return new Promise<void>((resolve, reject) => {
        let server: http.Server;
        
        // Set a timeout for the OAuth process
        const timeout = setTimeout(() => {
            if (server) {
                server.close();
                globalOAuthServer = null;
            }
            reject(new Error('OAuth process timed out'));
        }, 300000); // 5 minutes timeout

        server = http.createServer(async (req, res) => {
            console.log('OAuth callback received:', req.url);
        
        if (req.url && req.url.startsWith('/callback')) {
            const urlObj = new URL(req.url, 'http://localhost:8082');
            const code = urlObj.searchParams.get('code');
            const error = urlObj.searchParams.get('error');

            if (error) {
                console.error('OAuth callback error:', error);
                vscode.window.showErrorMessage(`OAuth error: ${error}`);
                res.writeHead(400);
                res.end(`OAuth error: ${error}`);
                server.close();
                globalOAuthServer = null;
                clearTimeout(timeout);
                reject(new Error(`OAuth error: ${error}`));
                return;
            }

            if (!code) {
                console.error('No authorization code in callback');
                res.writeHead(400);
                res.end('No code found in callback.');
                server.close();
                globalOAuthServer = null;
                clearTimeout(timeout);
                reject(new Error('No authorization code in callback'));
                return;
            }

            console.log('Authorization code received:', code.substring(0, 10) + '...');

            try {
                await exchangeAuthorizationCodeForTokens(context, code, addNewAccount);
                console.log('Token exchange successful');
                
                // Verify tokens are accessible immediately after storage
                if (addNewAccount) {
                    const immediateCheck = await context.secrets.get('anypoint.tempAccessToken');
                    console.log('Immediate verification after exchange - temp token exists:', !!immediateCheck);
                }
                res.writeHead(200);
                res.end('Login successful! You can close this window.');
                vscode.window.showInformationMessage('Successfully logged into Anypoint Platform!');
                server.close();
                globalOAuthServer = null;
                clearTimeout(timeout);
                resolve();
            } catch (error: any) {
                console.error('Token exchange failed:', error);
                vscode.window.showErrorMessage(`Token exchange error: ${error.message || error}`);
                res.writeHead(500);
                res.end('Error exchanging tokens. Check VS Code for details.');
                server.close();
                globalOAuthServer = null;
                clearTimeout(timeout);
                reject(error);
            }
        } else {
            console.log('Non-callback request:', req.url);
            res.writeHead(404);
            res.end('Not found');
        }
        });

        // Set the global reference
        globalOAuthServer = server;

        // Add error handler for server
        server.on('error', (err: any) => {
            console.error('OAuth server error:', err);
            globalOAuthServer = null;
            clearTimeout(timeout);
            if (err.code === 'EADDRINUSE') {
                reject(new Error('Port 8082 is still in use. Please wait 10 seconds and try again, or restart VSCode if the issue persists.'));
            } else {
                reject(err);
            }
        });

        server.listen(8082, async () => {
            console.log('OAuth server started on port 8082');

            // Get region-specific authorization endpoint
            const regionService = new RegionService(context);
            const tempRegion = await regionService.getTempRegion();
            const regionId = tempRegion?.id || 'us';
            const authorizationEndpoint = regionService.getAuthorizationEndpoint(regionId);

            // Get region-specific credentials
            const credentials = getCredentialsForRegion(regionId);

            const authUrl = new URL(authorizationEndpoint);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('client_id', credentials.clientId);
            authUrl.searchParams.set('redirect_uri', LOCAL_REDIRECT_URI);
            authUrl.searchParams.set('scope', 'offline_access full');

            console.log('=== AUTHORIZATION REQUEST DEBUG ===');
            console.log('CLIENT_ID:', credentials.clientId ? credentials.clientId.substring(0, 10) + '...' : 'MISSING');
            console.log('Region:', tempRegion?.name || 'US (default)', `(ID: ${regionId})`);
            console.log('Authorization endpoint:', authorizationEndpoint);
            console.log('Full authorization URL:', authUrl.toString());
            console.log('Redirect URI:', LOCAL_REDIRECT_URI);
            console.log('===================================');

            vscode.window.showInformationMessage(`Opening browser for ${tempRegion?.displayName || 'US'} login...`);

            vscode.env.openExternal(vscode.Uri.parse(authUrl.toString())).then(success => {
                if (!success) {
                    vscode.window.showErrorMessage('Failed to open browser for Anypoint login.');
                    server.close();
                    globalOAuthServer = null;
                    clearTimeout(timeout);
                    reject(new Error('Failed to open browser for Anypoint login.'));
                } else {
                    console.log('Browser opened successfully');
                }
            });
        });
    });
}

async function exchangeAuthorizationCodeForTokens(context: vscode.ExtensionContext, code: string, addNewAccount: boolean = false): Promise<void> {
    console.log('Starting token exchange...');

    // Get region-specific token endpoint
    const regionService = new RegionService(context);
    const tempRegion = await regionService.getTempRegion();
    const regionId = tempRegion?.id || 'us';
    const tokenEndpoint = regionService.getTokenEndpoint(regionId);

    // Get region-specific credentials
    const credentials = getCredentialsForRegion(regionId);

    console.log('=== TOKEN EXCHANGE DEBUG ===');
    console.log('Token endpoint:', tokenEndpoint);
    console.log('Region from tempRegion:', tempRegion?.name || 'US (default)', `(ID: ${regionId})`);
    console.log('Authorization code (first 20 chars):', code.substring(0, 20) + '...');
    console.log('Redirect URI:', LOCAL_REDIRECT_URI);
    console.log('Client ID:', credentials.clientId ? `${credentials.clientId.substring(0, 10)}...` : 'MISSING');
    console.log('Client Secret:', credentials.clientSecret ? `${credentials.clientSecret.substring(0, 10)}...` : 'MISSING');
    console.log('===========================');

    const data = new URLSearchParams();
    data.append('code', code);
    data.append('redirect_uri', LOCAL_REDIRECT_URI);
    data.append('grant_type', 'authorization_code');
    data.append('client_id', credentials.clientId);
    data.append('client_secret', credentials.clientSecret);

    console.log('Token exchange parameters:', {
        redirect_uri: LOCAL_REDIRECT_URI,
        grant_type: 'authorization_code',
        client_id: credentials.clientId ? credentials.clientId.substring(0, 8) + '...' : 'MISSING',
        client_secret: credentials.clientSecret ? credentials.clientSecret.substring(0, 8) + '...' : 'MISSING'
    });

    const base64Creds = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');

    try {
        const response = await axios.post(tokenEndpoint, data.toString(), {
            headers: {
                'Authorization': `Basic ${base64Creds}`,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            }
        });

        console.log('Token response status:', response.status);

        if (response.status !== 200) {
            throw new Error(`Token endpoint returned status ${response.status}`);
        }

        const result = response.data as { access_token?: string; refresh_token?: string; };
        console.log('Token response keys:', Object.keys(result));
        
        if (!result.access_token) {
            throw new Error(`No access_token found in response: ${JSON.stringify(result)}`);
        }

        console.log('Storing tokens in VSCode secrets...');

        // Store region information alongside tokens
        const regionService = new RegionService(context);
        const tempRegion = await regionService.getTempRegion();
        const regionId = tempRegion?.id || 'us'; // Default to US if not found

        if (addNewAccount) {
            console.log('Storing as temporary tokens for new account');
            console.log('Access token length:', result.access_token.length);
            console.log('Refresh token exists:', !!result.refresh_token);
            console.log('Region:', regionId);

            await context.secrets.store('anypoint.tempAccessToken', result.access_token);
            if (result.refresh_token) {
                await context.secrets.store('anypoint.tempRefreshToken', result.refresh_token);
            }

            // Store temporary region (will be saved to account later)
            await context.secrets.store('anypoint.tempRegionId', regionId);

            // Verify tokens were stored
            const verifyAccess = await context.secrets.get('anypoint.tempAccessToken');
            const verifyRefresh = await context.secrets.get('anypoint.tempRefreshToken');
            console.log('Verification - temp access token stored:', !!verifyAccess);
            console.log('Verification - temp refresh token stored:', !!verifyRefresh);
            console.log('Temporary tokens stored successfully');
        } else {
            console.log('Storing as main account tokens');
            await context.secrets.store('anypoint.accessToken', result.access_token);
            if (result.refresh_token) {
                await context.secrets.store('anypoint.refreshToken', result.refresh_token);
            }

            // Store region for the active account
            const { AccountService } = await import('./accountService.js');
            const accountService = new AccountService(context);
            const activeAccount = await accountService.getActiveAccount();
            if (activeAccount) {
                await accountService.setAccountRegion(activeAccount.id, regionId);
                console.log(`Region ${regionId} stored for account ${activeAccount.id}`);
            }

            console.log('Main tokens stored successfully');
        }

        // Clear temporary region after storing
        await regionService.clearTempRegion();
        
    } catch (error: any) {
        console.error('=== TOKEN EXCHANGE ERROR ===');
        console.error('Error message:', error.message);
        console.error('HTTP status:', error.response?.status);
        console.error('HTTP status text:', error.response?.statusText);
        console.error('Response data:', JSON.stringify(error.response?.data, null, 2));
        console.error('Token endpoint used:', tokenEndpoint);
        console.error('Has CLIENT_ID:', !!CLIENT_ID);
        console.error('Has CLIENT_SECRET:', !!CLIENT_SECRET);
        console.error('Has code:', !!code);
        console.error('Redirect URI:', LOCAL_REDIRECT_URI);
        console.error('===========================');

        // Clear temp region on error
        await regionService.clearTempRegion();

        // Show more detailed error to user
        let errorMsg = 'Token exchange failed';
        const responseData = error.response?.data;

        if (error.response?.status === 401 && responseData?.error_description?.includes("organization doesn't exist")) {
            errorMsg = 'Connected App organization mismatch: The CLIENT_ID/SECRET in config/secrets.json is registered to a different Anypoint organization. ' +
                      'You must authenticate with the same organization where the Connected App is registered, or create a new Connected App in the target organization.';
        } else if (error.response?.status === 401) {
            errorMsg = 'Invalid OAuth credentials. Please verify your CLIENT_ID and CLIENT_SECRET in config/secrets.json';
        } else if (error.response?.status === 400) {
            const apiError = error.response?.data?.error_description || error.response?.data?.error || 'Bad request';
            errorMsg = `OAuth error: ${apiError}`;
        } else if (error.message) {
            errorMsg = error.message;
        }

        vscode.window.showErrorMessage(`OAuth Error: ${errorMsg}`, 'View Console').then(selection => {
            if (selection === 'View Console') {
                vscode.commands.executeCommand('workbench.action.toggleDevTools');
            }
        });

        throw new Error(errorMsg);
    }
}

export async function refreshAccessToken(context: vscode.ExtensionContext, accountId?: string): Promise<boolean> {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);

    let storedRefreshToken: string | undefined;
    let regionId: string | undefined;

    if (accountId) {
        storedRefreshToken = await accountService.getAccountData(accountId, 'refreshToken');
        regionId = await accountService.getAccountData(accountId, 'region');
    } else {
        const activeAccount = await accountService.getActiveAccount();
        if (activeAccount) {
            storedRefreshToken = await accountService.getAccountData(activeAccount.id, 'refreshToken');
            regionId = await accountService.getAccountData(activeAccount.id, 'region');
        } else {
            storedRefreshToken = await context.secrets.get('anypoint.refreshToken');
        }
    }

    if (!storedRefreshToken) {
        vscode.window.showErrorMessage('No refresh token found. Please log in again.');
        return false;
    }

    // Get region-specific token endpoint and credentials
    const regionService = new RegionService(context);
    const effectiveRegionId = regionId || 'us';
    const tokenEndpoint = regionService.getTokenEndpoint(effectiveRegionId);
    const credentials = getCredentialsForRegion(effectiveRegionId);

    console.log(`Refreshing access token for region: ${effectiveRegionId}`);
    console.log(`Token endpoint: ${tokenEndpoint}`);

    const refreshData = new URLSearchParams();
    refreshData.append('grant_type', 'refresh_token');
    refreshData.append('refresh_token', storedRefreshToken);
    refreshData.append('client_id', credentials.clientId);
    refreshData.append('client_secret', credentials.clientSecret);

    const base64Creds = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    try {
        const response = await axios.post(tokenEndpoint, refreshData.toString(), {
            headers: {
                'Authorization': `Basic ${base64Creds}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (response.status !== 200) {
            throw new Error(`Refresh token request failed with status ${response.status}`);
        }

        const tokenData = response.data as { access_token?: string; refresh_token?: string; };

        console.log('=== TOKEN REFRESH RESPONSE ===');
        console.log('Full response data:', JSON.stringify(tokenData, null, 2));
        console.log('access_token exists:', !!tokenData.access_token);
        console.log('access_token value:', tokenData.access_token);
        console.log('access_token length:', tokenData.access_token?.length);
        console.log('==============================');

        if (!tokenData.access_token) {
            throw new Error(`No new access_token in refresh response: ${JSON.stringify(tokenData)}`);
        }

        if (accountId) {
            await accountService.setAccountData(accountId, 'accessToken', tokenData.access_token);
            console.log(`Token refresh: Saved new access token for account ${accountId} (length: ${tokenData.access_token.length})`);
            if (tokenData.refresh_token) {
                await accountService.setAccountData(accountId, 'refreshToken', tokenData.refresh_token);
                console.log(`Token refresh: Saved new refresh token for account ${accountId}`);
            }
        } else {
            const activeAccount = await accountService.getActiveAccount();
            if (activeAccount) {
                await accountService.setAccountData(activeAccount.id, 'accessToken', tokenData.access_token);
                console.log(`Token refresh: Saved new access token for active account ${activeAccount.id} (length: ${tokenData.access_token.length})`);
                if (tokenData.refresh_token) {
                    await accountService.setAccountData(activeAccount.id, 'refreshToken', tokenData.refresh_token);
                    console.log(`Token refresh: Saved new refresh token for active account ${activeAccount.id}`);
                }
            } else {
                await context.secrets.store('anypoint.accessToken', tokenData.access_token);
                console.log(`Token refresh: Saved new access token to legacy storage (length: ${tokenData.access_token.length})`);
                if (tokenData.refresh_token) {
                    await context.secrets.store('anypoint.refreshToken', tokenData.refresh_token);
                    console.log(`Token refresh: Saved new refresh token to legacy storage`);
                }
            }
        }

        console.log('Token refresh: All tokens saved successfully');
        vscode.window.showInformationMessage('Access token refreshed successfully!');
        return true;
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to refresh token: ${err.message}`);
        return false;
    }
}

export async function revokeAnypointToken(context: vscode.ExtensionContext, tokenType: 'access' | 'refresh'): Promise<void> {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);

    let token: string | undefined;
    let regionId: string | undefined;

    const activeAccount = await accountService.getActiveAccount();
    if (activeAccount) {
        token = await accountService.getAccountData(
            activeAccount.id,
            tokenType === 'access' ? 'accessToken' : 'refreshToken'
        );
        regionId = await accountService.getAccountData(activeAccount.id, 'region');
    } else {
        // Fallback to legacy storage
        const storageKey = tokenType === 'access' ? 'anypoint.accessToken' : 'anypoint.refreshToken';
        token = await context.secrets.get(storageKey);
    }

    if (!token) {
        vscode.window.showWarningMessage(`No ${tokenType} token found to revoke.`);
        return;
    }

    // Get region-specific revoke endpoint and credentials
    const regionService = new RegionService(context);
    const effectiveRegionId = regionId || 'us';
    const revokeEndpoint = regionService.getRevokeEndpoint(effectiveRegionId);
    const credentials = getCredentialsForRegion(effectiveRegionId);

    console.log(`Revoking ${tokenType} token for region: ${effectiveRegionId}`);
    console.log(`Revoke endpoint: ${revokeEndpoint}`);

    const formData = new URLSearchParams();
    formData.append('token', token);
    formData.append('client_id', credentials.clientId);
    formData.append('client_secret', credentials.clientSecret);

    const base64Creds = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    try {
        const response = await axios.post(revokeEndpoint, formData.toString(), {
            headers: {
                'Authorization': `Basic ${base64Creds}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (response.status === 200) {
            vscode.window.showInformationMessage(`Successfully revoked the ${tokenType} token.`);

            // Delete token from appropriate storage
            if (activeAccount) {
                await accountService.deleteAccountData(
                    activeAccount.id,
                    tokenType === 'access' ? 'accessToken' : 'refreshToken'
                );
            } else {
                const storageKey = tokenType === 'access' ? 'anypoint.accessToken' : 'anypoint.refreshToken';
                await context.secrets.delete(storageKey);
            }
        } else {
            throw new Error(`Revoke endpoint returned status ${response.status}`);
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error revoking token: ${error.message}`);
    }
}

