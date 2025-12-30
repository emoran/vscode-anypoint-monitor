import * as vscode from 'vscode';
import { BusinessGroupService, BusinessGroup, FlatBusinessGroup } from '../controllers/businessGroupService';
import { AccountService } from '../controllers/accountService';

export async function showBusinessGroupSelectorWebview(context: vscode.ExtensionContext): Promise<void> {
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
    webview: vscode.Webview,
    activeAccount: any,
    businessGroups: FlatBusinessGroup[],
    loading: boolean = false,
    errorMessage?: string
): Promise<string> {
    const currentBG = await new AccountService(context).getActiveAccountBusinessGroup();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Select Business Group</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }

        .header {
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--vscode-foreground);
        }

        .account-info {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            margin-top: 15px;
        }

        .account-info-row {
            display: flex;
            gap: 8px;
            font-size: 13px;
        }

        .account-info-label {
            font-weight: 600;
            color: var(--vscode-foreground);
            min-width: 120px;
        }

        .account-info-value {
            color: var(--vscode-descriptionForeground);
        }

        .current-bg {
            background: var(--vscode-inputValidation-infoBackground);
            border-left: 3px solid var(--vscode-inputValidation-infoBorder);
            padding: 12px;
            border-radius: 4px;
            margin: 15px 0;
        }

        .current-bg-label {
            font-size: 12px;
            text-transform: uppercase;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 5px;
        }

        .current-bg-value {
            font-size: 14px;
            color: var(--vscode-foreground);
            font-weight: 500;
        }

        .controls {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            align-items: center;
        }

        .search-box {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px 12px;
        }

        .search-box input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: var(--vscode-input-foreground);
            font-size: 14px;
        }

        .search-box input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .btn {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: background-color 0.2s;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .business-groups-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .business-group-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 15px;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
        }

        .business-group-card:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        .business-group-card.selected {
            background: var(--vscode-list-activeSelectionBackground);
            border-color: var(--vscode-focusBorder);
            border-width: 2px;
        }

        .business-group-card.root {
            border-left: 3px solid var(--vscode-charts-blue);
        }

        .business-group-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }

        .business-group-icon {
            font-size: 20px;
        }

        .business-group-name {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
            flex: 1;
        }

        .root-badge {
            background: var(--vscode-charts-blue);
            color: white;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .selected-badge {
            background: var(--vscode-charts-green);
            color: white;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
        }

        .business-group-path {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-left: 30px;
            font-style: italic;
        }

        .business-group-id {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-left: 30px;
            font-family: monospace;
            margin-top: 4px;
        }

        .level-indicator {
            display: inline-block;
            width: 20px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .loading-spinner {
            display: inline-block;
            width: 40px;
            height: 40px;
            border: 4px solid var(--vscode-panel-border);
            border-top-color: var(--vscode-focusBorder);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 15px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
            color: var(--vscode-errorForeground);
        }

        .error h3 {
            margin-bottom: 8px;
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 15px;
        }

        .info-box {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            padding: 12px;
            border-radius: 4px;
            margin: 15px 0;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🏢 Select Business Group</h1>

        <div class="account-info">
            <div class="account-info-row">
                <span class="account-info-label">Organization:</span>
                <span class="account-info-value">${activeAccount.organizationName}</span>
            </div>
            <div class="account-info-row">
                <span class="account-info-label">Account:</span>
                <span class="account-info-value">${activeAccount.userEmail}</span>
            </div>
        </div>

        ${currentBG ? `
        <div class="current-bg">
            <div class="current-bg-label">Currently Selected</div>
            <div class="current-bg-value">📍 ${currentBG.name}</div>
        </div>
        ` : ''}

        <div class="info-box">
            💡 Business groups allow you to organize resources hierarchically within your organization.
            Selecting a business group will scope all operations (applications, APIs, environments) to that group.
        </div>
    </div>

    <div class="controls">
        <div class="search-box">
            <span>🔍</span>
            <input
                type="text"
                id="searchInput"
                placeholder="Search business groups..."
                ${loading ? 'disabled' : ''}
            >
        </div>
        <button class="btn btn-secondary" onclick="refresh()" ${loading ? 'disabled' : ''}>
            🔄 Refresh
        </button>
    </div>

    ${loading ? `
        <div class="loading">
            <div class="loading-spinner"></div>
            <div>Loading business group hierarchy...</div>
        </div>
    ` : errorMessage ? `
        <div class="error">
            <h3>⚠️ Error Loading Business Groups</h3>
            <p>${errorMessage}</p>
        </div>
    ` : businessGroups.length === 0 ? `
        <div class="empty-state">
            <div class="empty-state-icon">🏢</div>
            <h3>No Business Groups Found</h3>
            <p>This organization doesn't have any business groups configured.</p>
        </div>
    ` : `
        <div class="business-groups-container">
            ${businessGroups.map(bg => {
                const isSelected = currentBG && currentBG.id === bg.id;
                const indent = '  '.repeat(bg.level);

                return `
                    <div class="business-group-card ${bg.isRoot ? 'root' : ''} ${isSelected ? 'selected' : ''}"
                         onclick="selectBusinessGroup('${bg.id}', '${bg.name.replace(/'/g, "\\'")}')">
                        <div class="business-group-header">
                            <span class="business-group-icon">${bg.isRoot ? '🏛️' : '🏢'}</span>
                            <span class="business-group-name">${bg.name}</span>
                            ${bg.isRoot ? '<span class="root-badge">Root</span>' : ''}
                            ${isSelected ? '<span class="selected-badge">✓ Selected</span>' : ''}
                        </div>
                        ${bg.level > 0 ? `
                            <div class="business-group-path">
                                ${bg.fullPath}
                            </div>
                        ` : ''}
                        <div class="business-group-id">ID: ${bg.id}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `}

    <script>
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

        // Search functionality
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
    </script>
</body>
</html>`;
}
