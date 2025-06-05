import * as vscode from 'vscode';
import axios from 'axios';
import * as http from 'http';
import { CLIENT_ID, CLIENT_SECRET, AUTHORIZATION_ENDPOINT, TOKEN_ENDPOINT, REVOKE_ENDPOINT, LOCAL_REDIRECT_URI } from '../constants';

export async function loginToAnypointWithOAuth(context: vscode.ExtensionContext): Promise<void> {
    const server = http.createServer(async (req, res) => {
        if (req.url && req.url.startsWith('/callback')) {
            const urlObj = new URL(req.url, 'http://localhost:8082');
            const code = urlObj.searchParams.get('code');

            if (!code) {
                res.writeHead(400);
                res.end('No code found in callback.');
                return;
            }

            try {
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
        const authUrl = new URL(AUTHORIZATION_ENDPOINT);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', LOCAL_REDIRECT_URI);
        authUrl.searchParams.set('scope', 'offline_access full');

        vscode.env.openExternal(vscode.Uri.parse(authUrl.toString())).then(success => {
            if (!success) {
                vscode.window.showErrorMessage('Failed to open browser for Anypoint login.');
            }
        });
    });
}

async function exchangeAuthorizationCodeForTokens(context: vscode.ExtensionContext, code: string): Promise<void> {
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
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        }
    });

    if (response.status !== 200) {
        throw new Error(`Token endpoint returned status ${response.status}`);
    }

    const result = response.data as { access_token?: string; refresh_token?: string; };
    if (!result.access_token) {
        throw new Error(`No access_token found in response: ${JSON.stringify(result)}`);
    }

    await context.secrets.store('anypoint.accessToken', result.access_token);
    if (result.refresh_token) {
        await context.secrets.store('anypoint.refreshToken', result.refresh_token);
    }
}

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

        const tokenData = response.data as { access_token?: string; refresh_token?: string; };
        if (!tokenData.access_token) {
            throw new Error(`No new access_token in refresh response: ${JSON.stringify(tokenData)}`);
        }

        await context.secrets.store('anypoint.accessToken', tokenData.access_token);
        if (tokenData.refresh_token) {
            await context.secrets.store('anypoint.refreshToken', tokenData.refresh_token);
        }

        vscode.window.showInformationMessage('Access token refreshed successfully!');
        return true;
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to refresh token: ${err.message}`);
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

