import * as vscode from 'vscode';
import { AccountService, AnypointAccount } from '../controllers/accountService';
import { loginToAnypointWithOAuth } from '../controllers/oauthService.js';
import { getUserInfo, getEnvironments } from '../controllers/anypointService';
import { RegionService } from '../controllers/regionService';

export async function showAccountManagerWebview(context: vscode.ExtensionContext): Promise<void> {
    console.log('Creating account manager webview...');
    const accountService = new AccountService(context);

    const panel = vscode.window.createWebviewPanel(
        'accountManager',
        'Anypoint Account Manager',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    console.log('Account manager webview panel created');

    const updateWebview = async () => {
        panel.webview.html = await getAccountManagerWebviewContent(context, panel.webview, accountService);
    };

    panel.webview.onDidReceiveMessage(
        async (message) => {
            console.log('Received message in account manager:', message);
            switch (message.command) {
                case 'addAccount':
                    try {
                        console.log('Account Manager: Starting OAuth flow...');
                        await loginToAnypointWithOAuth(context, true);
                        console.log('Account Manager: OAuth flow completed successfully');

                        // Check if account was actually added by refreshing and checking account list
                        await updateWebview();
                        const accounts = await accountService.getAccounts();
                        const accountCountBefore = accounts.length;

                        try {
                            console.log('Account Manager: Getting user info...');
                            await getUserInfo(context, true);
                            console.log('Account Manager: Getting environments...');
                            await getEnvironments(context, true);
                        } catch (userInfoError: any) {
                            console.log('Account Manager: User info/environment fetch failed, but checking if account was still created...');
                            // Account might have been created even if getUserInfo failed
                            await updateWebview();
                            const accountsAfter = await accountService.getAccounts();

                            if (accountsAfter.length > accountCountBefore) {
                                console.log('Account Manager: Account was created successfully despite error');

                                // Update status bar after successful account addition
                                const { updateAccountStatusBar } = await import('../extension.js');
                                await updateAccountStatusBar(context);

                                vscode.window.showInformationMessage('New account added successfully!');
                                break; // Exit without showing error
                            } else {
                                throw userInfoError; // Re-throw if account wasn't actually created
                            }
                        }

                        await updateWebview();

                        // Update status bar after successful account addition
                        const { updateAccountStatusBar } = await import('../extension.js');
                        await updateAccountStatusBar(context);

                        vscode.window.showInformationMessage('New account added successfully!');
                    } catch (error: any) {
                        // Clean up temp data on error
                        await context.secrets.delete('anypoint.tempAccessToken');
                        await context.secrets.delete('anypoint.tempRefreshToken');
                        await context.secrets.delete('anypoint.tempUserInfo');
                        await context.secrets.delete('anypoint.tempEnvironments');
                        await context.secrets.delete('anypoint.tempRegionId');

                        // Check one more time if account was actually created
                        await updateWebview();
                        const finalAccounts = await accountService.getAccounts();

                        if (finalAccounts.length > 0) {
                            // Update status bar after successful account addition
                            const { updateAccountStatusBar } = await import('../extension.js');
                            await updateAccountStatusBar(context);

                            vscode.window.showInformationMessage('Account added successfully!');
                        } else {
                            vscode.window.showErrorMessage(`Failed to add account: ${error.message}`);
                        }
                    }
                    break;

                case 'switchAccount':
                    try {
                        console.log('Account Manager: Switching to account:', message.accountId);
                        await accountService.setActiveAccount(message.accountId);

                        // Test the account by making a simple API call
                        try {
                            const { ApiHelper } = await import('../controllers/apiHelper.js');
                            const { getBaseUrl } = await import('../constants.js');
                            const apiHelper = new ApiHelper(context);
                            const baseUrl = await getBaseUrl(context);
                            await apiHelper.get(`${baseUrl}/accounts/api/me`);

                            // Update account status to authenticated
                            await accountService.updateAccountStatus(message.accountId, 'authenticated');
                            console.log('Account Manager: Account switch successful, tokens are valid');

                            // Refresh environments for the switched account
                            console.log('Account Manager: Refreshing environments for switched account');
                            const { getEnvironments } = await import('../controllers/anypointService.js');
                            await getEnvironments(context, false);
                            console.log('Account Manager: Environments refreshed successfully');

                            // Update status bar to show the new active account
                            const { updateAccountStatusBar } = await import('../extension.js');
                            await updateAccountStatusBar(context);
                        } catch (testError: any) {
                            console.log('Account Manager: Account switch completed but tokens may need refresh');
                            if (testError.message.includes('Authentication failed')) {
                                await accountService.updateAccountStatus(message.accountId, 'expired');
                            }
                        }

                        await updateWebview();
                        vscode.window.showInformationMessage(`Switched to account: ${message.accountName}`);
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Failed to switch account: ${error.message}`);
                    }
                    break;

                case 'removeAccount':
                    const confirm = await vscode.window.showWarningMessage(
                        `Are you sure you want to remove the account "${message.accountName}"?`,
                        'Yes', 'No'
                    );

                    if (confirm === 'Yes') {
                        try {
                            await accountService.removeAccount(message.accountId);
                            await updateWebview();

                            // Update status bar after account removal
                            const { updateAccountStatusBar } = await import('../extension.js');
                            await updateAccountStatusBar(context);

                            vscode.window.showInformationMessage(`Account "${message.accountName}" removed successfully!`);
                        } catch (error: any) {
                            vscode.window.showErrorMessage(`Failed to remove account: ${error.message}`);
                        }
                    }
                    break;

                case 'refreshAccount':
                    try {
                        await accountService.setActiveAccount(message.accountId);
                        const refreshModule = await import('../controllers/oauthService.js');
                        const refreshed = await refreshModule.refreshAccessToken(context);

                        if (refreshed) {
                            await accountService.updateAccountStatus(message.accountId, 'authenticated');

                            // Also refresh environments and user info for the account
                            console.log('Account Manager: Refreshing environments and user info for refreshed account');
                            try {
                                const { getEnvironments, getUserInfo } = await import('../controllers/anypointService.js');
                                await getUserInfo(context, false);
                                await getEnvironments(context, false);
                                console.log('Account Manager: Environments and user info refreshed successfully');
                            } catch (envError: any) {
                                console.log('Account Manager: Failed to refresh environments/user info:', envError.message);
                            }

                            await updateWebview();

                            // Update status bar to reflect refreshed account
                            const { updateAccountStatusBar } = await import('../extension.js');
                            await updateAccountStatusBar(context);

                            vscode.window.showInformationMessage('Account refreshed successfully! Environments and permissions updated.');
                        } else {
                            await accountService.updateAccountStatus(message.accountId, 'expired');
                            await updateWebview();
                            vscode.window.showErrorMessage('Failed to refresh account. Please re-authenticate.');
                        }
                    } catch (error: any) {
                        await accountService.updateAccountStatus(message.accountId, 'error');
                        await updateWebview();
                        vscode.window.showErrorMessage(`Failed to refresh account: ${error.message}`);
                    }
                    break;

                case 'changeRegion':
                    try {
                        console.log('Account Manager: Changing region for account:', message.accountId);

                        // Show region selection
                        const regionService = new RegionService(context);
                        const selectedRegion = await regionService.selectRegion();

                        if (selectedRegion) {
                            // Update the account's region
                            await accountService.setAccountRegion(message.accountId, selectedRegion.id);

                            // IMPORTANT: Mark account as expired since tokens are region-specific
                            // The user will need to re-authenticate to get tokens for the new region
                            await accountService.updateAccountStatus(message.accountId, 'expired');

                            // Show message that re-authentication is required
                            const activeAccount = await accountService.getActiveAccount();
                            if (activeAccount?.id === message.accountId) {
                                vscode.window.showWarningMessage(
                                    `Region updated to ${selectedRegion.displayName}. You must re-authenticate to get new tokens for this region.`,
                                    'Refresh Account'
                                ).then(selection => {
                                    if (selection === 'Refresh Account') {
                                        vscode.commands.executeCommand('anypoint-monitor.accountManager');
                                    }
                                });
                            } else {
                                vscode.window.showWarningMessage(
                                    `Region updated to ${selectedRegion.displayName} for ${message.accountName}. ` +
                                    `This account will need to be re-authenticated before use.`
                                );
                            }

                            await updateWebview();
                        } else {
                            vscode.window.showInformationMessage('Region change cancelled.');
                        }
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Failed to change region: ${error.message}`);
                    }
                    break;

                case 'refresh':
                    try {
                        console.log('Account Manager: Refreshing all account statuses...');
                        await accountService.refreshAllAccountStatuses();
                        await updateWebview();
                        vscode.window.showInformationMessage('Account statuses refreshed');
                    } catch (error: any) {
                        console.error('Account Manager: Error refreshing statuses:', error);
                        await updateWebview();
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    await updateWebview();
}

async function getAccountManagerWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
    accountService: AccountService
): Promise<string> {
    const accounts = await accountService.getAccounts();
    const activeAccount = await accountService.getActiveAccount();
    const regionService = new RegionService(context);

    const accountsHtml = await Promise.all(accounts.map(async (account) => {
        const statusIcon = getStatusIcon(account.status);
        const statusColor = getStatusColor(account.status);
        const isActive = account.isActive;
        const lastUsedDate = new Date(account.lastUsed).toLocaleDateString();

        // Get region information for this account
        const regionId = account.region || await accountService.getAccountData(account.id, 'region') || 'us';
        const region = regionService.getRegionById(regionId);
        const regionDisplay = region ? region.displayName : 'US (Default)';
        const regionIcon = getRegionIcon(regionId);

        return `
            <div class="account-card ${isActive ? 'active' : ''}" data-account-id="${account.id}">
                <div class="account-header">
                    <div class="account-info">
                        <h3 class="account-org-name">${account.organizationName}</h3>
                        <p class="account-details">
                            <span class="account-user">${account.userName} (${account.userEmail})</span>
                        </p>
                        <p class="account-meta">
                            <span class="org-id">Org ID: ${account.organizationId}</span>
                            <span class="region-info" title="Control Plane Region">${regionIcon} ${regionDisplay}</span>
                            <span class="last-used">Last used: ${lastUsedDate}</span>
                        </p>
                    </div>
                    <div class="account-status">
                        <span class="status-indicator ${account.status}" title="${account.status}">
                            ${statusIcon}
                        </span>
                        ${isActive ? '<span class="active-badge">ACTIVE</span>' : ''}
                    </div>
                </div>
                <div class="account-actions">
                    ${!isActive ? `<button class="btn btn-primary" onclick="switchAccount('${account.id}', '${account.organizationName}')">Switch</button>` : ''}
                    ${account.status === 'expired' || account.status === 'error' ?
                        `<button class="btn btn-secondary" onclick="refreshAccount('${account.id}')">Refresh</button>` : ''}
                    <button class="btn btn-secondary" onclick="changeRegion('${account.id}', '${account.organizationName}')">Change Region</button>
                    <button class="btn btn-danger" onclick="removeAccount('${account.id}', '${account.organizationName}')">Remove</button>
                </div>
            </div>
        `;
    }));

    const accountsHtmlString = accountsHtml.join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Anypoint Account Manager</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    padding: 20px;
                    margin: 0;
                }

                .header {
                    margin-bottom: 30px;
                    padding-bottom: 20px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }

                .header h1 {
                    color: var(--vscode-editor-foreground);
                    margin: 0 0 10px 0;
                    font-size: 24px;
                }

                .header p {
                    color: var(--vscode-descriptionForeground);
                    margin: 0;
                    font-size: 14px;
                }

                .actions-bar {
                    margin-bottom: 30px;
                    display: flex;
                    gap: 15px;
                    align-items: center;
                }

                .account-card {
                    background-color: var(--vscode-list-hoverBackground);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 8px;
                    padding: 20px;
                    margin-bottom: 15px;
                    transition: all 0.2s ease;
                }

                .account-card:hover {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    border-color: var(--vscode-focusBorder);
                }

                .account-card.active {
                    border-color: var(--vscode-button-background);
                    background-color: var(--vscode-button-hoverBackground);
                }

                .account-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 15px;
                }

                .account-info h3 {
                    margin: 0 0 8px 0;
                    color: var(--vscode-editor-foreground);
                    font-size: 18px;
                    font-weight: 600;
                }

                .account-details {
                    margin: 0 0 8px 0;
                    color: var(--vscode-descriptionForeground);
                    font-size: 14px;
                }

                .account-meta {
                    margin: 0;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .account-status {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: 8px;
                }

                .status-indicator {
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: bold;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .status-indicator.authenticated {
                    background-color: var(--vscode-testing-iconPassed);
                    color: white;
                }

                .status-indicator.expired {
                    background-color: var(--vscode-testing-iconQueued);
                    color: white;
                }

                .status-indicator.error {
                    background-color: var(--vscode-testing-iconFailed);
                    color: white;
                }

                .active-badge {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: bold;
                }

                .account-actions {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }

                .btn {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 500;
                    transition: background-color 0.2s ease;
                }

                .btn:hover:not(:disabled) {
                    background-color: var(--vscode-button-hoverBackground);
                }

                .btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .btn.btn-primary {
                    background-color: var(--vscode-button-background);
                }

                .btn.btn-secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }

                .btn.btn-secondary:hover:not(:disabled) {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }

                .btn.btn-danger {
                    background-color: var(--vscode-testing-iconFailed);
                    color: white;
                }

                .btn.btn-danger:hover:not(:disabled) {
                    background-color: #dc3545;
                }

                .btn.btn-add {
                    background-color: var(--vscode-testing-iconPassed);
                    color: white;
                }

                .btn.btn-add:hover {
                    background-color: #28a745;
                }

                .empty-state {
                    text-align: center;
                    padding: 60px 20px;
                    color: var(--vscode-descriptionForeground);
                }

                .empty-state h2 {
                    margin-bottom: 15px;
                    color: var(--vscode-editor-foreground);
                }

                .empty-state p {
                    margin-bottom: 30px;
                    line-height: 1.6;
                }

                @media (max-width: 600px) {
                    .account-header {
                        flex-direction: column;
                        align-items: stretch;
                    }

                    .account-status {
                        flex-direction: row;
                        align-items: center;
                        justify-content: space-between;
                        margin-top: 15px;
                    }

                    .actions-bar {
                        flex-direction: column;
                        align-items: stretch;
                    }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Anypoint Account Manager</h1>
                <p>Manage multiple Anypoint Platform accounts and switch between organizations</p>
            </div>

            <div class="actions-bar">
                <button class="btn btn-add" onclick="addAccount()">+ Add New Account</button>
                <button class="btn btn-secondary" onclick="refreshView()">🔄 Refresh</button>
            </div>

            ${accounts.length > 0 ? `
                <div class="accounts-container">
                    ${accountsHtmlString}
                </div>
            ` : `
                <div class="empty-state">
                    <h2>No Accounts Found</h2>
                    <p>Get started by adding your first Anypoint Platform account.</p>
                    <button class="btn btn-add" onclick="addAccount()">+ Add Your First Account</button>
                </div>
            `}

            <script>
                const vscode = acquireVsCodeApi();
                let isProcessing = false; // Prevent double-clicks

                function addAccount() {
                    if (isProcessing) {
                        console.log('Add account already in progress, ignoring click');
                        return;
                    }
                    console.log('Add account button clicked');
                    isProcessing = true;
                    vscode.postMessage({ command: 'addAccount' });

                    // Reset after 30 seconds in case of timeout
                    setTimeout(() => {
                        isProcessing = false;
                    }, 30000);
                }

                function switchAccount(accountId, accountName) {
                    console.log('Switch account clicked:', accountId, accountName);
                    vscode.postMessage({
                        command: 'switchAccount',
                        accountId: accountId,
                        accountName: accountName
                    });
                }

                function removeAccount(accountId, accountName) {
                    console.log('Remove account clicked:', accountId, accountName);
                    vscode.postMessage({
                        command: 'removeAccount',
                        accountId: accountId,
                        accountName: accountName
                    });
                }

                function refreshAccount(accountId) {
                    console.log('Refresh account clicked:', accountId);
                    vscode.postMessage({
                        command: 'refreshAccount',
                        accountId: accountId
                    });
                }

                function changeRegion(accountId, accountName) {
                    console.log('Change region clicked:', accountId, accountName);
                    vscode.postMessage({
                        command: 'changeRegion',
                        accountId: accountId,
                        accountName: accountName
                    });
                }

                function refreshView() {
                    console.log('Refresh view clicked');
                    vscode.postMessage({ command: 'refresh' });
                }
            </script>
        </body>
        </html>
    `;
}

function getStatusIcon(status: string): string {
    switch (status) {
        case 'authenticated':
            return '✅';
        case 'expired':
            return '⏰';
        case 'error':
            return '❌';
        default:
            return '❓';
    }
}

function getStatusColor(status: string): string {
    switch (status) {
        case 'authenticated':
            return '#28a745';
        case 'expired':
            return '#ffc107';
        case 'error':
            return '#dc3545';
        default:
            return '#6c757d';
    }
}

function getRegionIcon(regionId: string): string {
    switch (regionId) {
        case 'us':
            return '🇺🇸';
        case 'eu':
            return '🇪🇺';
        case 'gov':
            return '🏛️';
        default:
            return '🌍';
    }
}
