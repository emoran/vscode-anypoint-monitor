import * as vscode from 'vscode';
import { BusinessGroupService, BusinessGroup, FlatBusinessGroup } from '../controllers/businessGroupService';
import { AccountService } from '../controllers/accountService';
import { telemetryService } from '../services/telemetryService';
import { wrapWebviewHtml, badge, button, emptyState, escapeHtml } from '../webview/ui-kit';

export async function showBusinessGroupSelectorWebview(context: vscode.ExtensionContext): Promise<void> {
    telemetryService.trackPageView('businessGroupSelector');
    console.log('Creating business group selector webview...');
    const accountService = new AccountService(context);
    const businessGroupService = new BusinessGroupService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        vscode.window.showErrorMessage('No active account found. Please log in first.');
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'businessGroupSelector',
        'Select Business Group',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    console.log('Business group selector webview panel created');

    let hierarchy: BusinessGroup | undefined;
    let flattenedGroups: FlatBusinessGroup[] = [];

    const updateWebview = async (loading: boolean = false, errorMessage?: string) => {
        panel.webview.html = await getBusinessGroupSelectorWebviewContent(
            context,
            panel.webview,
            activeAccount,
            flattenedGroups,
            loading,
            errorMessage
        );
    };

    // Load hierarchy
    try {
        await updateWebview(true);
        hierarchy = await businessGroupService.getOrganizationHierarchy(activeAccount.organizationId);
        flattenedGroups = businessGroupService.flattenHierarchy(hierarchy);
        await updateWebview(false);
    } catch (error: any) {
        console.error('Error loading business group hierarchy:', error);
        await updateWebview(false, error.message);
    }

    panel.webview.onDidReceiveMessage(
        async (message) => {
            console.log('Received message in business group selector:', message);
            switch (message.command) {
                case 'selectBusinessGroup':
                    try {
                        const { businessGroupId, businessGroupName } = message;
                        console.log(`Selecting business group: ${businessGroupName} (${businessGroupId})`);

                        // Show progress while switching
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: `Switching to business group: ${businessGroupName}`,
                            cancellable: false
                        }, async (progress) => {
                            progress.report({ increment: 0, message: 'Updating account...' });

                            // Update the account with selected business group
                            // This will also refresh environments automatically
                            await accountService.setAccountBusinessGroup(
                                activeAccount.id,
                                businessGroupId,
                                businessGroupName
                            );

                            progress.report({ increment: 50, message: 'Updating status bar...' });

                            // Update status bar
                            const { updateAccountStatusBar } = await import('../extension.js');
                            await updateAccountStatusBar(context);

                            progress.report({ increment: 100, message: 'Complete!' });
                        });

                        vscode.window.showInformationMessage(
                            `✅ Switched to business group: ${businessGroupName}. Environments refreshed. Open Developer Utilities will auto-close.`
                        );

                        // Close the panel
                        panel.dispose();
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Failed to select business group: ${error.message}`);
                    }
                    break;

                case 'refresh':
                    try {
                        console.log('Refreshing business group hierarchy...');
                        await updateWebview(true);
                        hierarchy = await businessGroupService.getOrganizationHierarchy(
                            activeAccount.organizationId,
                            true // Force refresh
                        );
                        flattenedGroups = businessGroupService.flattenHierarchy(hierarchy);
                        await updateWebview(false);
                        vscode.window.showInformationMessage('Business group hierarchy refreshed');
                    } catch (error: any) {
                        console.error('Error refreshing hierarchy:', error);
                        await updateWebview(false, error.message);
                    }
                    break;

                case 'search':
                    try {
                        const searchTerm = message.searchTerm.toLowerCase();
                        if (!hierarchy) {
                            break;
                        }

                        if (searchTerm.trim() === '') {
                            // Reset to full list
                            flattenedGroups = businessGroupService.flattenHierarchy(hierarchy);
                        } else {
                            // Filter by name or full path
                            const allGroups = businessGroupService.flattenHierarchy(hierarchy);
                            flattenedGroups = allGroups.filter(bg =>
                                bg.name.toLowerCase().includes(searchTerm) ||
                                bg.fullPath.toLowerCase().includes(searchTerm)
                            );
                        }

                        await updateWebview(false);
                    } catch (error: any) {
                        console.error('Error searching business groups:', error);
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
}

async function getBusinessGroupSelectorWebviewContent(
    context: vscode.ExtensionContext,
    _webview: vscode.Webview,
    activeAccount: any,
    businessGroups: FlatBusinessGroup[],
    loading: boolean = false,
    errorMessage?: string
): Promise<string> {
    const currentBG = await new AccountService(context).getActiveAccountBusinessGroup();

    const orgName = escapeHtml(String(activeAccount.organizationName ?? ''));
    const userEmail = escapeHtml(String(activeAccount.userEmail ?? ''));

    const mainContent = loading
        ? `
        <div class="bgs-loading">
            <div class="bgs-loading-spinner"></div>
            <div>Loading business group hierarchy...</div>
        </div>
    `
        : errorMessage
            ? `
        <div class="bgs-error" role="alert">
            <h3>⚠️ Error Loading Business Groups</h3>
            <p>${escapeHtml(errorMessage)}</p>
        </div>
    `
            : businessGroups.length === 0
                ? emptyState({
                    icon: '🏢',
                    title: 'No Business Groups Found',
                    description: "This organization doesn't have any business groups configured."
                })
                : `
        <div class="bgs-groups">
            ${businessGroups.map(bg => {
        const isSelected = Boolean(currentBG && currentBG.id === bg.id);
        const onClickJs = `selectBusinessGroup(${JSON.stringify(bg.id)}, ${JSON.stringify(bg.name)})`;
        const rootBadge = bg.isRoot ? badge('Root', 'info', true) : '';
        const selectedBadge = isSelected ? badge('✓ Selected', 'success', true) : '';
        return `
                    <div class="bgs-group-card ${bg.isRoot ? 'bgs-group-card--root' : ''} ${isSelected ? 'bgs-group-card--selected' : ''}"
                         role="button" tabindex="0"
                         onclick='${onClickJs}'>
                        <div class="bgs-group-card-header">
                            <span class="bgs-group-card-icon">${bg.isRoot ? '🏛️' : '🏢'}</span>
                            <span class="bgs-group-card-name">${escapeHtml(bg.name)}</span>
                            ${rootBadge}
                            ${selectedBadge}
                        </div>
                        ${bg.level > 0 ? `
                            <div class="bgs-group-card-path">
                                ${escapeHtml(bg.fullPath)}
                            </div>
                        ` : ''}
                        <div class="bgs-group-card-id">ID: ${escapeHtml(bg.id)}</div>
                    </div>
                `;
    }).join('')}
        </div>
    `;

    const body = `
<div class="am-container">
    <header class="am-page-header">
        <div>
            <h1>🏢 Select Business Group</h1>
        </div>
    </header>

    <div class="am-card bgs-stack">
        <div class="bgs-account-info">
            <div class="bgs-account-info-row">
                <span class="bgs-account-info-label">Organization:</span>
                <span class="bgs-account-info-value">${orgName}</span>
            </div>
            <div class="bgs-account-info-row">
                <span class="bgs-account-info-label">Account:</span>
                <span class="bgs-account-info-value">${userEmail}</span>
            </div>
        </div>
    </div>

    ${currentBG ? `
    <div class="am-card bgs-current-bg">
        <div class="bgs-current-bg-label">Currently Selected</div>
        <div class="bgs-current-bg-value">📍 ${escapeHtml(currentBG.name)}</div>
    </div>
    ` : ''}

    <div class="am-card bgs-info-callout">
        💡 Business groups allow you to organize resources hierarchically within your organization.
        Selecting a business group will scope all operations (applications, APIs, environments) to that group.
    </div>

    <div class="am-filters bgs-controls">
        <div class="bgs-search-wrap">
            <span class="bgs-search-icon" aria-hidden="true">🔍</span>
            <input
                type="search"
                class="am-input bgs-search-input"
                id="searchInput"
                placeholder="Search business groups..."
                autocomplete="off"
                ${loading ? 'disabled' : ''}
            >
        </div>
        ${button('Refresh', { variant: 'secondary', onclick: 'refresh()', icon: '🔄', disabled: loading })}
    </div>

    ${mainContent}
</div>
`;

    const scripts = `
        const vscode = acquireVsCodeApi();

        function selectBusinessGroup(businessGroupId, businessGroupName) {
            vscode.postMessage({
                command: 'selectBusinessGroup',
                businessGroupId: businessGroupId,
                businessGroupName: businessGroupName
            });
        }

        function refresh() {
            vscode.postMessage({
                command: 'refresh'
            });
        }

        const searchInput = document.getElementById('searchInput');
        let searchTimeout;

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    vscode.postMessage({
                        command: 'search',
                        searchTerm: e.target.value
                    });
                }, 300);
            });
        }
    `;

    const extraStyles = `
        .bgs-stack { margin-bottom: 16px; }
        .bgs-account-info {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .bgs-account-info-row {
            display: flex;
            gap: 8px;
            font-size: 13px;
        }
        .bgs-account-info-label {
            font-weight: 600;
            color: var(--am-text-primary);
            min-width: 120px;
        }
        .bgs-account-info-value {
            color: var(--am-text-secondary);
        }
        .bgs-current-bg {
            margin-bottom: 16px;
            background: color-mix(in srgb, var(--am-info) 12%, transparent);
            border: 1px solid color-mix(in srgb, var(--am-info) 35%, transparent);
        }
        .bgs-current-bg-label {
            font-size: 12px;
            text-transform: uppercase;
            font-weight: 600;
            color: var(--am-text-muted);
            margin-bottom: 6px;
        }
        .bgs-current-bg-value {
            font-size: 14px;
            color: var(--am-text-primary);
            font-weight: 500;
        }
        .bgs-info-callout {
            margin-bottom: 20px;
            font-size: 13px;
            color: var(--am-text-secondary);
            border-left: 3px solid var(--am-info);
        }
        .bgs-controls {
            align-items: stretch;
            margin-bottom: 20px;
        }
        .bgs-search-wrap {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
            padding: 4px 4px 4px 12px;
            background: var(--am-bg-input);
            border: 1px solid var(--am-border-input);
            border-radius: var(--am-radius-md);
        }
        .bgs-search-wrap:focus-within {
            border-color: var(--am-border-focus);
        }
        .bgs-search-input {
            flex: 1;
            min-width: 0;
            border: none;
            background: transparent;
            box-shadow: none;
        }
        .bgs-search-input:focus {
            outline: none;
            border: none;
        }
        .bgs-groups {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .bgs-group-card {
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 15px;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
        }
        .bgs-group-card:hover {
            background: var(--am-bg-surface-hover);
            border-color: var(--am-border-focus);
        }
        .bgs-group-card--selected {
            background: color-mix(in srgb, var(--am-info) 14%, var(--am-bg-surface));
            border-color: var(--am-border-focus);
            border-width: 2px;
        }
        .bgs-group-card--root {
            border-left: 3px solid var(--am-info);
        }
        .bgs-group-card-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }
        .bgs-group-card-icon {
            font-size: 20px;
        }
        .bgs-group-card-name {
            font-size: 16px;
            font-weight: 600;
            color: var(--am-text-primary);
            flex: 1;
            min-width: 0;
        }
        .bgs-group-card-path {
            font-size: 13px;
            color: var(--am-text-secondary);
            margin-left: 30px;
            font-style: italic;
        }
        .bgs-group-card-id {
            font-size: 11px;
            color: var(--am-text-muted);
            margin-left: 30px;
            font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
            margin-top: 4px;
        }
        .bgs-loading {
            text-align: center;
            padding: 40px;
            color: var(--am-text-secondary);
        }
        .bgs-loading-spinner {
            display: inline-block;
            width: 40px;
            height: 40px;
            border: 4px solid var(--am-border);
            border-top-color: var(--am-border-focus);
            border-radius: 50%;
            animation: bgs-spin 1s linear infinite;
            margin-bottom: 15px;
        }
        @keyframes bgs-spin {
            to { transform: rotate(360deg); }
        }
        .bgs-error {
            background: color-mix(in srgb, var(--am-error) 12%, var(--am-bg-surface));
            border: 1px solid color-mix(in srgb, var(--am-error) 40%, var(--am-border));
            border-radius: var(--am-radius-md);
            padding: 15px;
            margin: 8px 0 0;
            color: var(--am-error);
        }
        .bgs-error h3 {
            margin-bottom: 8px;
            color: var(--am-text-primary);
        }
        .bgs-error p {
            color: var(--am-text-secondary);
        }
    `;

    return wrapWebviewHtml({
        title: 'Select Business Group',
        body,
        scripts,
        extraStyles
    });
}
