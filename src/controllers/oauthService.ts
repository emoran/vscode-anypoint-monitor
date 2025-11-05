import * as vscode from 'vscode';
import axios from 'axios';
import * as http from 'http';
import { CLIENT_ID, CLIENT_SECRET, AUTHORIZATION_ENDPOINT, TOKEN_ENDPOINT, REVOKE_ENDPOINT, LOCAL_REDIRECT_URI } from '../constants';

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

        server.listen(8082, () => {
            console.log('OAuth server started on port 8082');
            const authUrl = new URL(AUTHORIZATION_ENDPOINT);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('client_id', CLIENT_ID);
            authUrl.searchParams.set('redirect_uri', LOCAL_REDIRECT_URI);
            authUrl.searchParams.set('scope', 'offline_access full');

            console.log('OAuth Debug - CLIENT_ID:', CLIENT_ID ? CLIENT_ID.substring(0, 8) + '...' : 'MISSING');
            console.log('OAuth Debug - Authorization URL:', authUrl.toString());
            
            vscode.window.showInformationMessage('Opening browser for login...');

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
    console.log('Token endpoint:', TOKEN_ENDPOINT);
    
    const data = new URLSearchParams();
    data.append('code', code);
    data.append('redirect_uri', LOCAL_REDIRECT_URI);
    data.append('grant_type', 'authorization_code');
    data.append('client_id', CLIENT_ID);
    data.append('client_secret', CLIENT_SECRET);

    console.log('Token exchange parameters:', {
        redirect_uri: LOCAL_REDIRECT_URI,
        grant_type: 'authorization_code',
        client_id: CLIENT_ID ? CLIENT_ID.substring(0, 8) + '...' : 'MISSING',
        client_secret: CLIENT_SECRET ? CLIENT_SECRET.substring(0, 8) + '...' : 'MISSING'
    });

    const base64Creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    
    try {
        const response = await axios.post(TOKEN_ENDPOINT, data.toString(), {
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
        
        if (addNewAccount) {
            console.log('Storing as temporary tokens for new account');
            console.log('Access token length:', result.access_token.length);
            console.log('Refresh token exists:', !!result.refresh_token);
            
            await context.secrets.store('anypoint.tempAccessToken', result.access_token);
            if (result.refresh_token) {
                await context.secrets.store('anypoint.tempRefreshToken', result.refresh_token);
            }
            
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
            console.log('Main tokens stored successfully');
        }
        
    } catch (error: any) {
        console.error('Token exchange error details:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        throw error;
    }
}

export async function refreshAccessToken(context: vscode.ExtensionContext, accountId?: string): Promise<boolean> {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);
    
    let storedRefreshToken: string | undefined;
    
    if (accountId) {
        storedRefreshToken = await accountService.getAccountData(accountId, 'refreshToken');
    } else {
        const activeAccount = await accountService.getActiveAccount();
        if (activeAccount) {
            storedRefreshToken = await accountService.getAccountData(activeAccount.id, 'refreshToken');
        } else {
            storedRefreshToken = await context.secrets.get('anypoint.refreshToken');
        }
    }
    
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

        const tokenData = response.data as { access_token?: string; refresh_token?: string; };
        if (!tokenData.access_token) {
            throw new Error(`No new access_token in refresh response: ${JSON.stringify(tokenData)}`);
        }

        if (accountId) {
            await accountService.setAccountData(accountId, 'accessToken', tokenData.access_token);
            if (tokenData.refresh_token) {
                await accountService.setAccountData(accountId, 'refreshToken', tokenData.refresh_token);
            }
        } else {
            const activeAccount = await accountService.getActiveAccount();
            if (activeAccount) {
                await accountService.setAccountData(activeAccount.id, 'accessToken', tokenData.access_token);
                if (tokenData.refresh_token) {
                    await accountService.setAccountData(activeAccount.id, 'refreshToken', tokenData.refresh_token);
                }
            } else {
                await context.secrets.store('anypoint.accessToken', tokenData.access_token);
                if (tokenData.refresh_token) {
                    await context.secrets.store('anypoint.refreshToken', tokenData.refresh_token);
                }
            }
        }

        console.log('✅ Access token refreshed successfully');
        vscode.window.showInformationMessage('Access token refreshed successfully!');
        return true;
    } catch (err: any) {
        console.error('❌ Token refresh failed:', err);
        console.error('Status:', err.response?.status);
        console.error('Data:', err.response?.data);

        // Handle specific error cases
        if (err.response?.status === 400) {
            // 400 typically means the refresh token is invalid or expired
            const { AccountService } = await import('./accountService.js');
            const accountService = new AccountService(context);

            if (accountId) {
                await accountService.updateAccountStatus(accountId, 'expired');
            } else {
                const activeAccount = await accountService.getActiveAccount();
                if (activeAccount) {
                    await accountService.updateAccountStatus(activeAccount.id, 'expired');
                }
            }

            console.log('Refresh token expired or invalid (400 error)');
            vscode.window.showErrorMessage(
                'Your session has expired. Please log in again using "AM: Login into Anypoint Platform".',
                'Login Now'
            ).then(selection => {
                if (selection === 'Login Now') {
                    vscode.commands.executeCommand('anypoint-monitor.login');
                }
            });
        } else if (err.response?.status === 401) {
            // 401 means unauthorized
            console.log('Refresh token unauthorized (401 error)');
            vscode.window.showErrorMessage(
                'Authentication failed. Please log in again using "AM: Login into Anypoint Platform".',
                'Login Now'
            ).then(selection => {
                if (selection === 'Login Now') {
                    vscode.commands.executeCommand('anypoint-monitor.login');
                }
            });
        } else {
            // Other errors
            vscode.window.showErrorMessage(
                `Failed to refresh token: ${err.message}. Please try logging in again if the issue persists.`
            );
        }

        return false;
    }
}

export async function revokeAnypointToken(context: vscode.ExtensionContext, tokenType: 'access' | 'refresh'): Promise<void> {
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

