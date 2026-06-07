import * as vscode from 'vscode';
import { AccountService, AnypointAccount } from '../controllers/accountService';
import { loginToAnypointWithOAuth } from '../controllers/oauthService.js';
import { getUserInfo, getEnvironments } from '../controllers/anypointService';
import { RegionService } from '../controllers/regionService';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    badge,
    summaryCard,
    button,
    emptyState,
    escapeHtml,
    type BadgeVariant
} from '../webview/ui-kit';

export async function showAccountManagerWebview(context: vscode.ExtensionContext): Promise<void> {
    telemetryService.trackPageView('accountManager');
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

function statusToBadgeVariant(status: string): BadgeVariant {
    switch (status) {
        case 'authenticated':
            return 'success';
        case 'expired':
            return 'warning';
        case 'error':
            return 'error';
        default:
            return 'info';
    }
}

function renderAccountTableRow(
    account: AnypointAccount,
    opts: {
        isActive: boolean;
        lastUsedDate: string;
        regionDisplay: string;
        regionIcon: string;
    }
): string {
    const statusLabel = `${getStatusIcon(account.status)} ${account.status}`;
    const statusBadge = badge(statusLabel, statusToBadgeVariant(account.status), true);
    const activeBadgeHtml = opts.isActive ? badge('ACTIVE', 'info', true) : '';

    const switchBtn = !opts.isActive
        ? button('Switch', {
            variant: 'primary',
            onclick: `switchAccount(${JSON.stringify(account.id)}, ${JSON.stringify(account.organizationName)})`
        })
        : '';

    const refreshBtn =
        account.status === 'expired' || account.status === 'error'
            ? button('Refresh', {
                variant: 'secondary',
                onclick: `refreshAccount(${JSON.stringify(account.id)})`
            })
            : '';

    const rowClass = `am-row${opts.isActive ? ' account-row-active' : ''}`;

    return `
        <tr class="${rowClass}" data-account-id="${escapeHtml(account.id)}">
            <td class="account-cell-org">
                <div class="cell-org-name">${escapeHtml(account.organizationName)}</div>
                <div class="cell-org-user">${escapeHtml(account.userName)} (${escapeHtml(account.userEmail)})</div>
            </td>
            <td class="account-cell-mono">${escapeHtml(account.organizationId)}</td>
            <td title="Control Plane Region">${opts.regionIcon} ${escapeHtml(opts.regionDisplay)}</td>
            <td>
                <span class="account-status-badges" title="${escapeHtml(account.status)}">
                    ${statusBadge}
                    ${activeBadgeHtml}
                </span>
            </td>
            <td>${escapeHtml(opts.lastUsedDate)}</td>
            <td class="account-cell-actions">
                <div class="account-actions am-actions">
                    ${switchBtn}
                    ${refreshBtn}
                    ${button('Change Region', {
                        variant: 'secondary',
                        onclick: `changeRegion(${JSON.stringify(account.id)}, ${JSON.stringify(account.organizationName)})`
                    })}
                    ${button('Remove', {
                        variant: 'danger',
                        onclick: `removeAccount(${JSON.stringify(account.id)}, ${JSON.stringify(account.organizationName)})`
                    })}
                </div>
            </td>
        </tr>
    `;
}

async function getAccountManagerWebviewContent(
    context: vscode.ExtensionContext,
    _webview: vscode.Webview,
    accountService: AccountService
): Promise<string> {
    const accounts = await accountService.getAccounts();
    const regionService = new RegionService(context);

    const accountRows = await Promise.all(
        accounts.map(async (account) => {
            const isActive = account.isActive;
            const lastUsedDate = new Date(account.lastUsed).toLocaleDateString();

            const regionId = account.region || (await accountService.getAccountData(account.id, 'region')) || 'us';
            const region = regionService.getRegionById(regionId);
            const regionDisplay = region ? region.displayName : 'US (Default)';
            const regionIcon = getRegionIcon(regionId);

            return renderAccountTableRow(account, {
                isActive,
                lastUsedDate,
                regionDisplay,
                regionIcon
            });
        })
    );

    const accountsTableBody = accountRows.join('');

    const authenticatedCount = accounts.filter((a) => a.status === 'authenticated').length;
    const needsAttentionCount = accounts.filter((a) => a.status === 'expired' || a.status === 'error').length;
    const attentionVariant: 'warning' | 'healthy' =
        needsAttentionCount > 0 ? 'warning' : 'healthy';

    const summarySection =
        accounts.length > 0
            ? `
        <div class="am-summary-cards account-summary-cards">
            ${summaryCard({
                icon: '👤',
                value: accounts.length,
                label: 'Accounts',
                animationDelay: '0s'
            })}
            ${summaryCard({
                icon: '✓',
                value: authenticatedCount,
                label: 'Authenticated',
                variant: 'healthy',
                animationDelay: '0.05s'
            })}
            ${summaryCard({
                icon: '⚠',
                value: needsAttentionCount,
                label: 'Needs refresh',
                variant: attentionVariant,
                animationDelay: '0.1s'
            })}
        </div>
    `
            : '';

    const mainContent =
        accounts.length > 0
            ? `
        <div class="am-card account-list-card">
            <div class="am-table-container">
                <table class="am-table account-table">
                    <thead>
                        <tr>
                            <th>Account</th>
                            <th>Org ID</th>
                            <th>Region</th>
                            <th>Status</th>
                            <th>Last used</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${accountsTableBody}
                    </tbody>
                </table>
            </div>
        </div>
            `
            : emptyState({
                icon: '👤',
                title: 'No Accounts Found',
                description: 'Get started by adding your first Anypoint Platform account.',
                actionHtml: button('Add your first account', { variant: 'primary', onclick: 'addAccount()', icon: '+' })
            });

    const body = `
        <div class="am-container">
            <div class="am-page-header">
                <div>
                    <h1>Anypoint Account Manager</h1>
                    <p class="am-account-header-desc">Manage multiple Anypoint Platform accounts and switch between organizations</p>
                </div>
                <div class="am-page-header-right account-header-actions">
                    ${button('Add New Account', { variant: 'primary', onclick: 'addAccount()', icon: '+' })}
                    ${button('Refresh', { variant: 'secondary', onclick: 'refreshView()', icon: '🔄' })}
                </div>
            </div>
            ${summarySection}
            ${mainContent}
        </div>
    `;

    const scripts = `
        const vscode = acquireVsCodeApi();
        let isProcessing = false;

        function addAccount() {
            if (isProcessing) {
                console.log('Add account already in progress, ignoring click');
                return;
            }
            console.log('Add account button clicked');
            isProcessing = true;
            vscode.postMessage({ command: 'addAccount' });
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
    `;

    const extraStyles = `
        .am-account-header-desc {
            margin-top: 6px;
            font-size: 14px;
            color: var(--am-text-secondary);
            max-width: 520px;
        }

        .account-header-actions {
            flex-wrap: wrap;
        }

        .account-summary-cards {
            margin-bottom: 24px;
        }

        .account-list-card {
            padding: 0;
            overflow: hidden;
        }

        .account-list-card .am-table-container {
            border: none;
            border-radius: 0;
            background: transparent;
        }

        .account-list-card:hover {
            transform: none;
        }

        .account-table .account-cell-mono {
            font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
            font-size: 12px;
            color: var(--am-text-secondary);
        }

        .cell-org-name {
            font-size: 14px;
            font-weight: 600;
            color: var(--am-text-primary);
            margin-bottom: 4px;
        }

        .cell-org-user {
            font-size: 12px;
            color: var(--am-text-muted);
        }

        .account-row-active td {
            background: color-mix(in srgb, var(--am-info) 8%, transparent);
        }

        .account-table .account-cell-actions {
            vertical-align: top;
            min-width: 220px;
        }

        .account-actions {
            flex-wrap: wrap;
            gap: 8px;
        }

        .account-status-badges {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 6px;
        }

        @media (max-width: 900px) {
            .account-table thead {
                display: none;
            }

            .account-table tr.am-row {
                display: block;
                border-bottom: 1px solid var(--am-border);
                padding: 12px 0;
            }

            .account-table tr.am-row td {
                display: block;
                border: none;
                padding: 6px 16px;
            }

            .account-table tr.am-row td.account-cell-actions {
                padding-top: 12px;
            }
        }
    `;

    return wrapWebviewHtml({
        title: 'Anypoint Account Manager',
        body,
        scripts,
        extraStyles
    });
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
