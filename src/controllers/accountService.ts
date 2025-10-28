import * as vscode from 'vscode';

export interface AnypointAccount {
    id: string;
    organizationId: string;
    organizationName: string;
    userEmail: string;
    userName: string;
    isActive: boolean;
    lastUsed: string;
    status: 'authenticated' | 'expired' | 'error';
}

export class AccountService {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async migrateExistingAccount(): Promise<void> {
        const existingToken = await this.context.secrets.get('anypoint.accessToken');
        const existingUserInfo = await this.context.secrets.get('anypoint.userInfo');
        
        if (existingToken && existingUserInfo) {
            const userInfo = JSON.parse(existingUserInfo);
            const orgId = userInfo.organization.id;
            
            const existingAccounts = await this.getAccounts();
            
            const existingAccount = existingAccounts.find(account => account.organizationId === orgId);
            if (!existingAccount) {
                const accountId = `account_${orgId}_${Date.now()}`;
                
                const account: AnypointAccount = {
                    id: accountId,
                    organizationId: orgId,
                    organizationName: userInfo.organization.name || 'Unknown Organization',
                    userEmail: userInfo.email || 'unknown@email.com',
                    userName: userInfo.username || userInfo.firstName + ' ' + userInfo.lastName || 'Unknown User',
                    isActive: true,
                    lastUsed: new Date().toISOString(),
                    status: 'authenticated'
                };

                await this.migrateAccountData(accountId);
                await this.addAccount(account);
                await this.setActiveAccount(accountId);
            }
        }
    }

    private async migrateAccountData(accountId: string): Promise<void> {
        const dataToMigrate = [
            { old: 'anypoint.accessToken', new: `anypoint.account.${accountId}.accessToken` },
            { old: 'anypoint.refreshToken', new: `anypoint.account.${accountId}.refreshToken` },
            { old: 'anypoint.userInfo', new: `anypoint.account.${accountId}.userInfo` },
            { old: 'anypoint.environments', new: `anypoint.account.${accountId}.environments` },
            { old: 'anypoint.selectedEnvironment', new: `anypoint.account.${accountId}.selectedEnvironment` }
        ];

        for (const { old, new: newKey } of dataToMigrate) {
            const value = await this.context.secrets.get(old);
            if (value) {
                await this.context.secrets.store(newKey, value);
            }
        }
    }

    async getAccounts(): Promise<AnypointAccount[]> {
        const accountsData = await this.context.secrets.get('anypoint.accounts');
        return accountsData ? JSON.parse(accountsData) : [];
    }

    async addAccount(account: AnypointAccount): Promise<void> {
        const accounts = await this.getAccounts();
        
        const existingIndex = accounts.findIndex(acc => acc.organizationId === account.organizationId);
        if (existingIndex >= 0) {
            accounts[existingIndex] = account;
        } else {
            accounts.push(account);
        }
        
        await this.context.secrets.store('anypoint.accounts', JSON.stringify(accounts));
    }

    async removeAccount(accountId: string): Promise<void> {
        const accounts = await this.getAccounts();
        const filteredAccounts = accounts.filter(acc => acc.id !== accountId);
        
        await this.context.secrets.store('anypoint.accounts', JSON.stringify(filteredAccounts));
        
        const keysToDelete = [
            `anypoint.account.${accountId}.accessToken`,
            `anypoint.account.${accountId}.refreshToken`,
            `anypoint.account.${accountId}.userInfo`,
            `anypoint.account.${accountId}.environments`,
            `anypoint.account.${accountId}.selectedEnvironment`
        ];

        for (const key of keysToDelete) {
            await this.context.secrets.delete(key);
        }

        const activeAccountId = await this.getActiveAccountId();
        if (activeAccountId === accountId) {
            const remainingAccounts = filteredAccounts;
            if (remainingAccounts.length > 0) {
                await this.setActiveAccount(remainingAccounts[0].id);
            } else {
                await this.context.secrets.delete('anypoint.activeAccountId');
            }
        }
    }

    async getActiveAccountId(): Promise<string | undefined> {
        return await this.context.secrets.get('anypoint.activeAccountId');
    }

    async setActiveAccount(accountId: string): Promise<void> {
        const accounts = await this.getAccounts();
        const updatedAccounts = accounts.map(acc => ({
            ...acc,
            isActive: acc.id === accountId,
            lastUsed: acc.id === accountId ? new Date().toISOString() : acc.lastUsed
        }));

        await this.context.secrets.store('anypoint.accounts', JSON.stringify(updatedAccounts));
        await this.context.secrets.store('anypoint.activeAccountId', accountId);
    }

    async getActiveAccount(): Promise<AnypointAccount | undefined> {
        const activeAccountId = await this.getActiveAccountId();
        if (!activeAccountId) return undefined;

        const accounts = await this.getAccounts();
        return accounts.find(acc => acc.id === activeAccountId);
    }

    async getAccountById(accountId: string): Promise<AnypointAccount | undefined> {
        const accounts = await this.getAccounts();
        return accounts.find(account => account.id === accountId);
    }

    async updateAccountStatus(accountId: string, status: 'authenticated' | 'expired' | 'error'): Promise<void> {
        const accounts = await this.getAccounts();
        const updatedAccounts = accounts.map(acc => 
            acc.id === accountId ? { ...acc, status } : acc
        );

        await this.context.secrets.store('anypoint.accounts', JSON.stringify(updatedAccounts));
        
        // If account is expired or has errors, clear cached data to force refresh
        if (status === 'expired' || status === 'error') {
            console.log(`Account ${accountId} marked as ${status}, clearing cached data`);
            await this.setAccountData(accountId, 'environments', '');
            await this.setAccountData(accountId, 'userInfo', '');
        }
    }

    async getAccountData(accountId: string, dataType: 'accessToken' | 'refreshToken' | 'userInfo' | 'environments' | 'selectedEnvironment'): Promise<string | undefined> {
        return await this.context.secrets.get(`anypoint.account.${accountId}.${dataType}`);
    }

    async setAccountData(accountId: string, dataType: 'accessToken' | 'refreshToken' | 'userInfo' | 'environments' | 'selectedEnvironment', data: string): Promise<void> {
        await this.context.secrets.store(`anypoint.account.${accountId}.${dataType}`, data);
    }

    async deleteAccountData(accountId: string, dataType: 'accessToken' | 'refreshToken' | 'userInfo' | 'environments' | 'selectedEnvironment'): Promise<void> {
        await this.context.secrets.delete(`anypoint.account.${accountId}.${dataType}`);
    }

    async getActiveAccountAccessToken(): Promise<string | undefined> {
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            return undefined;
        }

        return await this.getAccountData(activeAccount.id, 'accessToken');
    }

    async getActiveAccountRefreshToken(): Promise<string | undefined> {
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            return undefined;
        }

        return await this.getAccountData(activeAccount.id, 'refreshToken');
    }

    async getActiveAccountUserInfo(): Promise<string | undefined> {
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            return undefined;
        }

        return await this.getAccountData(activeAccount.id, 'userInfo');
    }

    async getActiveAccountEnvironments(): Promise<string | undefined> {
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            return undefined;
        }

        return await this.getAccountData(activeAccount.id, 'environments');
    }

    async refreshAllAccountStatuses(): Promise<void> {
        const accounts = await this.getAccounts();
        const { ApiHelper } = await import('./apiHelper.js');
        
        for (const account of accounts) {
            try {
                // Temporarily set this account as active for the API test
                const originalActive = await this.getActiveAccountId();
                await this.setActiveAccount(account.id);
                
                const apiHelper = new ApiHelper(this.context);
                await apiHelper.get('https://anypoint.mulesoft.com/accounts/api/me');
                
                // If successful, mark as authenticated
                await this.updateAccountStatus(account.id, 'authenticated');
                
                // Restore original active account
                if (originalActive) {
                    await this.setActiveAccount(originalActive);
                }
            } catch (error: any) {
                // Mark as expired if authentication failed
                if (error.message.includes('Authentication failed')) {
                    await this.updateAccountStatus(account.id, 'expired');
                } else {
                    await this.updateAccountStatus(account.id, 'error');
                }
            }
        }
    }

    /**
     * Migrate legacy account data to multi-account system
     * This helps existing users transition to the new system automatically
     */
    async migrateLegacyAccount(): Promise<{ migrated: boolean, accountId?: string, error?: string }> {
        try {
            console.log('🔄 Checking for legacy account data to migrate...');

            // Check if we already have accounts in the new system
            const existingAccounts = await this.getAccounts();
            if (existingAccounts.length > 0) {
                console.log('✅ Multi-account system already has accounts, no migration needed');
                return { migrated: false };
            }

            // Check for legacy data
            const legacyToken = await this.context.secrets.get('anypoint.accessToken');
            const legacyUserInfo = await this.context.secrets.get('anypoint.userInfo');
            const legacyEnvironments = await this.context.secrets.get('anypoint.environments');
            const legacyRefreshToken = await this.context.secrets.get('anypoint.refreshToken');

            if (!legacyToken || !legacyUserInfo) {
                console.log('ℹ️ No legacy account data found to migrate');
                return { migrated: false };
            }

            console.log('🎯 Found legacy account data, starting migration...');

            // Parse user info to get organization details
            const userInfo = JSON.parse(legacyUserInfo);
            const orgId = userInfo.organization.id;
            const accountId = `account_${orgId}_migrated_${Date.now()}`;

            console.log(`📝 Creating migrated account with ID: ${accountId}`);

            // Create the account object
            const account = {
                id: accountId,
                organizationId: orgId,
                organizationName: userInfo.organization.name || 'Unknown Organization',
                userEmail: userInfo.email || 'unknown@email.com',
                userName: userInfo.username || userInfo.firstName + ' ' + userInfo.lastName || 'Unknown User',
                isActive: true, // Make it active immediately
                lastUsed: new Date().toISOString(),
                status: 'authenticated' as const
            };

            // Store account data
            await this.setAccountData(accountId, 'accessToken', legacyToken);
            await this.setAccountData(accountId, 'userInfo', legacyUserInfo);
            
            if (legacyRefreshToken) {
                await this.setAccountData(accountId, 'refreshToken', legacyRefreshToken);
            }
            
            if (legacyEnvironments) {
                await this.setAccountData(accountId, 'environments', legacyEnvironments);
            }

            // Add to accounts list and set as active
            await this.addAccount(account);
            await this.setActiveAccount(accountId);

            console.log('✅ Legacy account migration completed successfully');
            console.log(`📧 Migrated account: ${account.userEmail} (${account.organizationName})`);

            return { 
                migrated: true, 
                accountId: accountId 
            };

        } catch (error: any) {
            console.error('❌ Legacy account migration failed:', error);
            return { 
                migrated: false, 
                error: error.message 
            };
        }
    }

    /**
     * Check if migration is needed and display appropriate message to user
     */
    async checkAndPromptMigration(): Promise<boolean> {
        try {
            const migrationResult = await this.migrateLegacyAccount();
            
            if (migrationResult.migrated && migrationResult.accountId) {
                // Show success message to user
                const account = await this.getAccountById(migrationResult.accountId);
                if (account) {
                    console.log(`🎉 Migration successful for ${account.userEmail}`);
                    
                    // Import vscode dynamically to show user notification
                    const vscode = await import('vscode');
                    vscode.window.showInformationMessage(
                        `✅ Your legacy account has been migrated to the new multi-account system! ` +
                        `Welcome ${account.userEmail} (${account.organizationName})`
                    );
                    
                    return true;
                }
            }
            
            return false;
        } catch (error: any) {
            console.error('Migration check failed:', error);
            return false;
        }
    }
}