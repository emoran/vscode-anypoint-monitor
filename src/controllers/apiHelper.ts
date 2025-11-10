import * as vscode from 'vscode';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { AccountService } from './accountService.js';
import { refreshAccessToken } from './oauthService.js';

export class ApiHelper {
    private context: vscode.ExtensionContext;
    private accountService: AccountService;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.accountService = new AccountService(context);
    }

    // Static helper method for quick upgrade of existing axios calls
    static async makeRequestWithAutoRefresh(
        context: vscode.ExtensionContext,
        requestFn: () => Promise<AxiosResponse>
    ): Promise<AxiosResponse> {
        try {
            return await requestFn();
        } catch (error: any) {
            if (error.response?.status === 401) {
                console.log('API Helper Static: 401 error detected, attempting token refresh...');
                
                const accountService = new AccountService(context);
                const activeAccount = await accountService.getActiveAccount();
                const refreshSuccess = await refreshAccessToken(context, activeAccount?.id);
                
                if (refreshSuccess) {
                    console.log('API Helper Static: Token refreshed successfully, retrying request...');
                    return await requestFn();
                } else {
                    if (activeAccount) {
                        await accountService.updateAccountStatus(activeAccount.id, 'expired');
                    }
                    throw new Error('Authentication failed. Please log in again.');
                }
            } else if (error.response?.status === 403) {
                console.log('API Helper Static: 403 error detected - permission denied');
                
                const accountService = new AccountService(context);
                const activeAccount = await accountService.getActiveAccount();
                const accountInfo = activeAccount ? ` for account ${activeAccount.userName || activeAccount.id}` : '';
                
                throw new Error(`Access denied${accountInfo}. Your account may not have the required permissions, subscription, or role to access this resource. Please check with your administrator or try a different account.`);
            }
            throw error;
        }
    }

    async makeRequest(config: AxiosRequestConfig, useActiveAccount: boolean = true): Promise<AxiosResponse> {
        let accessToken: string | undefined;
        
        if (useActiveAccount) {
            accessToken = await this.accountService.getActiveAccountAccessToken();
            if (!accessToken) {
                accessToken = await this.context.secrets.get('anypoint.accessToken');
            }
        } else {
            accessToken = await this.context.secrets.get('anypoint.accessToken');
        }

        if (!accessToken) {
            throw new Error('No access token found. Please log in first.');
        }

        // Add authorization header
        const requestConfig = {
            ...config,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...config.headers
            }
        };

        try {
            const response = await axios(requestConfig);
            return response;
        } catch (error: any) {
            if (error.response?.status === 401) {
                console.log('API Helper: 401 error detected, attempting token refresh...');
                
                // Try to refresh the token
                const activeAccount = await this.accountService.getActiveAccount();
                const refreshSuccess = await refreshAccessToken(this.context, activeAccount?.id);
                
                if (refreshSuccess) {
                    console.log('API Helper: Token refreshed successfully, retrying request...');
                    
                    // Get the new token
                    let newAccessToken: string | undefined;
                    if (useActiveAccount && activeAccount) {
                        newAccessToken = await this.accountService.getAccountData(activeAccount.id, 'accessToken');
                    } else {
                        newAccessToken = await this.context.secrets.get('anypoint.accessToken');
                    }

                    if (newAccessToken) {
                        // Retry the request with the new token
                        const retryConfig = {
                            ...config,
                            headers: {
                                'Authorization': `Bearer ${newAccessToken}`,
                                ...config.headers
                            }
                        };

                        return await axios(retryConfig);
                    }
                }
                
                // If refresh failed, update account status
                if (activeAccount) {
                    await this.accountService.updateAccountStatus(activeAccount.id, 'expired');
                }
                
                throw new Error('Authentication failed. Please log in again.');
            } else if (error.response?.status === 403) {
                console.log('API Helper: 403 error detected - permission denied');
                
                const activeAccount = await this.accountService.getActiveAccount();
                console.log('🔍 Active account details for 403 error:', JSON.stringify(activeAccount, null, 2));
                const accountInfo = activeAccount ? ` for account ${activeAccount.userName || activeAccount.id}` : '';
                
                throw new Error(`Access denied${accountInfo}. Your account may not have the required permissions, subscription, or role to access this resource. Please check with your administrator or try a different account.`);
            }
            
            throw error;
        }
    }

    async get(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.makeRequest({ ...config, method: 'GET', url });
    }

    async post(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.makeRequest({ ...config, method: 'POST', url, data });
    }

    async put(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.makeRequest({ ...config, method: 'PUT', url, data });
    }

    async delete(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.makeRequest({ ...config, method: 'DELETE', url });
    }

    async patch(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.makeRequest({ ...config, method: 'PATCH', url, data });
    }
}
