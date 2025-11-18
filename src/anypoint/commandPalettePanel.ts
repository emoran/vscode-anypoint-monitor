import * as vscode from 'vscode';

interface CommandCategory {
    label: string;
    icon: string;
    commands: CommandItem[];
}

interface CommandItem {
    label: string;
    command: string;
    description: string;
    icon: string;
}

class CommandTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly contextValue?: string,
        public readonly tooltip?: string,
        public readonly description?: string,
        public readonly iconPath?: vscode.ThemeIcon
    ) {
        super(label, collapsibleState);
        this.tooltip = tooltip || label;
        this.description = description;
        this.iconPath = iconPath;
    }
}

export class CommandPaletteProvider implements vscode.TreeDataProvider<CommandTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CommandTreeItem | undefined | null | void> = new vscode.EventEmitter<CommandTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CommandTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private categories: CommandCategory[] = [
        {
            label: 'Authentication',
            icon: 'key',
            commands: [
                {
                    label: 'Login',
                    command: 'anypoint-monitor.login',
                    description: 'Login to Anypoint Platform with OAuth',
                    icon: 'sign-in'
                },
                {
                    label: 'Logout',
                    command: 'anypoint-monitor.logout',
                    description: 'Logout from current account',
                    icon: 'sign-out'
                },
                {
                    label: 'Account Manager',
                    command: 'anypoint-monitor.accountManager',
                    description: 'Manage multiple Anypoint accounts',
                    icon: 'organization'
                },
                {
                    label: 'Retrieve Access Token',
                    command: 'anypoint-monitor.retrieveAccessToken',
                    description: 'Get current OAuth access token',
                    icon: 'key'
                }
            ]
        },
        {
            label: 'User & Organization',
            icon: 'organization',
            commands: [
                {
                    label: 'My Information',
                    command: 'anypoint-monitor.userInfo',
                    description: 'View your user profile details',
                    icon: 'account'
                },
                {
                    label: 'Organization Details',
                    command: 'anypoint-monitor.organizationInfo',
                    description: 'View organization information',
                    icon: 'organization'
                },
                {
                    label: 'Subscription Expiration',
                    command: 'anypoint-monitor.subscriptionExpiration',
                    description: 'Check when your subscription expires',
                    icon: 'calendar'
                }
            ]
        },
        {
            label: 'CloudHub Applications',
            icon: 'cloud',
            commands: [
                {
                    label: 'CloudHub 1.0 Apps',
                    command: 'anypoint-monitor.cloudhub1Apps',
                    description: 'List and manage CloudHub 1.0 applications',
                    icon: 'server-process'
                },
                {
                    label: 'CloudHub 2.0 Apps',
                    command: 'anypoint-monitor.cloudhub2Apps',
                    description: 'List and manage CloudHub 2.0 applications',
                    icon: 'rocket'
                },
                {
                    label: 'Application Command Center',
                    command: 'anypoint-monitor.applicationCommandCenter',
                    description: 'Unified application management dashboard',
                    icon: 'dashboard'
                }
            ]
        },
        {
            label: 'Hybrid/On-Premises',
            icon: 'server',
            commands: [
                {
                    label: 'Hybrid Applications',
                    command: 'anypoint-monitor.hybridApps',
                    description: 'View on-premises/hybrid applications',
                    icon: 'server-process'
                },
                {
                    label: 'Hybrid Servers',
                    command: 'anypoint-monitor.hybridServers',
                    description: 'View on-premises Mule servers',
                    icon: 'server'
                },
                {
                    label: 'Server Groups',
                    command: 'anypoint-monitor.hybridServerGroups',
                    description: 'View on-premises server groups',
                    icon: 'server-environment'
                },
                {
                    label: 'Clusters',
                    command: 'anypoint-monitor.hybridClusters',
                    description: 'View on-premises server clusters',
                    icon: 'globe'
                }
            ]
        },
        {
            label: 'API Management',
            icon: 'symbol-interface',
            commands: [
                {
                    label: 'API Manager APIs',
                    command: 'anypoint-monitor.retrieveAPIManagerAPIs',
                    description: 'View all APIs in API Manager',
                    icon: 'symbol-interface'
                },
                {
                    label: 'Audit APIs',
                    command: 'anypoint-monitor.auditAPIs',
                    description: 'Audit API configurations and policies',
                    icon: 'checklist'
                }
            ]
        },
        {
            label: 'Monitoring & Logs',
            icon: 'graph',
            commands: [
                {
                    label: 'Real-Time Logs',
                    command: 'anypoint-monitor.realTimeLogs',
                    description: 'Stream live application logs with filtering',
                    icon: 'output'
                },
                {
                    label: 'Environment Comparison',
                    command: 'anypoint-monitor.environmentComparison',
                    description: 'Compare applications across environments',
                    icon: 'compare-changes'
                },
                {
                    label: 'Application Diagram',
                    command: 'anypoint-monitor.applicationDiagram',
                    description: 'Visualize application architecture',
                    icon: 'type-hierarchy'
                }
            ]
        },
        {
            label: 'Developer Tools',
            icon: 'tools',
            commands: [
                {
                    label: 'DataWeave Playground',
                    command: 'anypoint-monitor.dataweavePlayground',
                    description: 'Test and experiment with DataWeave scripts',
                    icon: 'code'
                },
                {
                    label: 'Developer Utilities',
                    command: 'anypoint-monitor.developerUtilities',
                    description: 'Useful developer tools and utilities',
                    icon: 'tools'
                }
            ]
        },
        {
            label: 'Community & Support',
            icon: 'comment-discussion',
            commands: [
                {
                    label: 'Community Events',
                    command: 'anypoint-monitor.communityEvents',
                    description: 'Upcoming MuleSoft community events',
                    icon: 'calendar'
                },
                {
                    label: 'Provide Feedback',
                    command: 'anypoint-monitor.provideFeedback',
                    description: 'Share your feedback about this extension',
                    icon: 'feedback'
                }
            ]
        },
        {
            label: 'Settings & Maintenance',
            icon: 'settings-gear',
            commands: [
                {
                    label: 'Delete All Accounts',
                    command: 'anypoint-monitor.deleteAllAccounts',
                    description: 'Remove all stored accounts and data',
                    icon: 'trash'
                },
                {
                    label: 'Migrate Legacy Account',
                    command: 'anypoint-monitor.migrateLegacyAccount',
                    description: 'Upgrade to multi-account system',
                    icon: 'migrate'
                }
            ]
        }
    ];

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CommandTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CommandTreeItem): Thenable<CommandTreeItem[]> {
        if (!element) {
            // Return top-level categories
            return Promise.resolve(
                this.categories.map(category => {
                    const item = new CommandTreeItem(
                        category.label,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        undefined,
                        'category',
                        `${category.label} - ${category.commands.length} commands available`,
                        `${category.commands.length} commands`,
                        new vscode.ThemeIcon(category.icon)
                    );
                    return item;
                })
            );
        } else {
            // Return commands for the selected category
            const category = this.categories.find(cat => cat.label === element.label);
            if (category) {
                return Promise.resolve(
                    category.commands.map(cmd => {
                        const item = new CommandTreeItem(
                            cmd.label,
                            vscode.TreeItemCollapsibleState.None,
                            {
                                command: cmd.command,
                                title: cmd.label
                            },
                            'command',
                            cmd.description,
                            undefined,
                            new vscode.ThemeIcon(cmd.icon)
                        );
                        return item;
                    })
                );
            }
            return Promise.resolve([]);
        }
    }
}

export function registerCommandPalettePanel(context: vscode.ExtensionContext): void {
    const commandPaletteProvider = new CommandPaletteProvider(context);

    const treeView = vscode.window.createTreeView('anypointCommandPalette', {
        treeDataProvider: commandPaletteProvider,
        showCollapseAll: true
    });

    context.subscriptions.push(treeView);

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('anypoint-monitor.refreshCommandPalette', () => {
        commandPaletteProvider.refresh();
    });

    context.subscriptions.push(refreshCommand);
}
