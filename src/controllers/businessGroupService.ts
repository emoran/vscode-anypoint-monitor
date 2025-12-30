import * as vscode from 'vscode';

/**
 * Business Group structure from the hierarchy API
 */
export interface BusinessGroup {
    id: string;
    name: string;
    parentId?: string;
    isRoot?: boolean;
    children?: BusinessGroup[];
}

/**
 * Flattened business group for easier display
 */
export interface FlatBusinessGroup {
    id: string;
    name: string;
    fullPath: string; // e.g., "Root Org > Sales > EMEA"
    level: number;
    parentId?: string;
    isRoot: boolean;
}

/**
 * Service to manage business group hierarchy and selection
 */
export class BusinessGroupService {
    private context: vscode.ExtensionContext;
    private hierarchyCache: Map<string, { hierarchy: BusinessGroup, timestamp: number }> = new Map();
    private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes cache

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Fetch the organization hierarchy from Anypoint Platform
     * @param organizationId Root organization ID
     * @returns Business group hierarchy
     */
    async fetchOrganizationHierarchy(organizationId: string): Promise<BusinessGroup> {
        const { ApiHelper } = await import('./apiHelper.js');
        const { getBaseUrl } = await import('../constants.js');

        const apiHelper = new ApiHelper(this.context);
        const baseUrl = await getBaseUrl(this.context);
        const apiUrl = `${baseUrl}/accounts/api/organizations/${organizationId}/hierarchy`;

        console.log(`Fetching business group hierarchy for org ${organizationId}`);

        try {
            const response = await apiHelper.get(apiUrl);

            if (response.status !== 200) {
                throw new Error(`Failed to fetch hierarchy: ${response.status}`);
            }

            const hierarchy = this.parseHierarchyResponse(response.data);

            // Cache the result
            this.hierarchyCache.set(organizationId, {
                hierarchy,
                timestamp: Date.now()
            });

            console.log(`Successfully fetched hierarchy with ${this.countBusinessGroups(hierarchy)} business groups`);
            return hierarchy;
        } catch (error: any) {
            console.error('Error fetching business group hierarchy:', error);

            // If API fails, try to get from cache even if expired
            const cached = this.hierarchyCache.get(organizationId);
            if (cached) {
                console.log('Using expired cache due to API failure');
                return cached.hierarchy;
            }

            throw error;
        }
    }

    /**
     * Get organization hierarchy with caching
     */
    async getOrganizationHierarchy(organizationId: string, forceRefresh: boolean = false): Promise<BusinessGroup> {
        // Check cache first
        if (!forceRefresh) {
            const cached = this.hierarchyCache.get(organizationId);
            if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
                console.log('Using cached business group hierarchy');
                return cached.hierarchy;
            }
        }

        // Fetch fresh data
        return await this.fetchOrganizationHierarchy(organizationId);
    }

    /**
     * Parse the hierarchy API response
     */
    private parseHierarchyResponse(data: any): BusinessGroup {
        const root: BusinessGroup = {
            id: data.id,
            name: data.name,
            isRoot: true,
            children: []
        };

        // Parse subOrganizations (business groups)
        if (data.subOrganizations && Array.isArray(data.subOrganizations)) {
            root.children = data.subOrganizations.map((bg: any) => this.parseBusinessGroup(bg, root.id));
        }

        return root;
    }

    /**
     * Recursively parse business group data
     */
    private parseBusinessGroup(data: any, parentId: string): BusinessGroup {
        const bg: BusinessGroup = {
            id: data.id,
            name: data.name,
            parentId,
            isRoot: false,
            children: []
        };

        // Parse nested subOrganizations
        if (data.subOrganizations && Array.isArray(data.subOrganizations)) {
            bg.children = data.subOrganizations.map((child: any) => this.parseBusinessGroup(child, bg.id));
        }

        return bg;
    }

    /**
     * Flatten the hierarchy for display purposes
     */
    flattenHierarchy(hierarchy: BusinessGroup): FlatBusinessGroup[] {
        const flattened: FlatBusinessGroup[] = [];

        const traverse = (bg: BusinessGroup, path: string[], level: number) => {
            const fullPath = [...path, bg.name].join(' > ');

            flattened.push({
                id: bg.id,
                name: bg.name,
                fullPath,
                level,
                parentId: bg.parentId,
                isRoot: bg.isRoot || false
            });

            if (bg.children) {
                for (const child of bg.children) {
                    traverse(child, [...path, bg.name], level + 1);
                }
            }
        };

        traverse(hierarchy, [], 0);
        return flattened;
    }

    /**
     * Find a business group by ID in the hierarchy
     */
    findBusinessGroupById(hierarchy: BusinessGroup, id: string): BusinessGroup | undefined {
        if (hierarchy.id === id) {
            return hierarchy;
        }

        if (hierarchy.children) {
            for (const child of hierarchy.children) {
                const found = this.findBusinessGroupById(child, id);
                if (found) {
                    return found;
                }
            }
        }

        return undefined;
    }

    /**
     * Get the full path to a business group
     */
    getBusinessGroupPath(hierarchy: BusinessGroup, targetId: string): string[] {
        const path: string[] = [];

        const findPath = (bg: BusinessGroup): boolean => {
            path.push(bg.name);

            if (bg.id === targetId) {
                return true;
            }

            if (bg.children) {
                for (const child of bg.children) {
                    if (findPath(child)) {
                        return true;
                    }
                }
            }

            path.pop();
            return false;
        };

        findPath(hierarchy);
        return path;
    }

    /**
     * Count total business groups in hierarchy
     */
    private countBusinessGroups(hierarchy: BusinessGroup): number {
        let count = 1; // Count this node

        if (hierarchy.children) {
            for (const child of hierarchy.children) {
                count += this.countBusinessGroups(child);
            }
        }

        return count;
    }

    /**
     * Check if organization has multiple business groups
     */
    async hasMultipleBusinessGroups(organizationId: string): Promise<boolean> {
        try {
            const hierarchy = await this.getOrganizationHierarchy(organizationId);
            const count = this.countBusinessGroups(hierarchy);
            return count > 1; // More than just root org
        } catch (error) {
            console.error('Error checking for multiple business groups:', error);
            return false;
        }
    }

    /**
     * Clear cache for a specific organization
     */
    clearCache(organizationId?: string): void {
        if (organizationId) {
            this.hierarchyCache.delete(organizationId);
            console.log(`Cleared business group cache for org ${organizationId}`);
        } else {
            this.hierarchyCache.clear();
            console.log('Cleared all business group caches');
        }
    }

    /**
     * Get cached hierarchy if available
     */
    getCachedHierarchy(organizationId: string): BusinessGroup | undefined {
        const cached = this.hierarchyCache.get(organizationId);
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
            return cached.hierarchy;
        }
        return undefined;
    }

    /**
     * Check if user should be prompted to select a business group
     * Returns true if multiple BGs exist and none is currently selected
     */
    async shouldPromptForBusinessGroupSelection(accountId: string): Promise<boolean> {
        try {
            const { AccountService } = await import('./accountService.js');
            const accountService = new AccountService(this.context);

            const account = await accountService.getAccountById(accountId);
            if (!account) {
                return false;
            }

            // If business group already selected, don't prompt
            if (account.businessGroupId) {
                return false;
            }

            // Check if organization has multiple business groups
            const hasMultiple = await this.hasMultipleBusinessGroups(account.organizationId);
            return hasMultiple;
        } catch (error) {
            console.error('Error checking if should prompt for BG selection:', error);
            return false;
        }
    }

    /**
     * Prompt user to select a business group if multiple exist
     * Returns true if prompt was shown, false otherwise
     */
    async promptForBusinessGroupSelection(accountId: string): Promise<boolean> {
        const shouldPrompt = await this.shouldPromptForBusinessGroupSelection(accountId);
        if (!shouldPrompt) {
            return false;
        }

        try {
            const vscode = await import('vscode');
            const { AccountService } = await import('./accountService.js');
            const accountService = new AccountService(this.context);
            const account = await accountService.getAccountById(accountId);

            if (!account) {
                return false;
            }

            // Show prompt
            const selection = await vscode.window.showInformationMessage(
                `Your account "${account.organizationName}" has multiple business groups. Would you like to select one now?`,
                'Select Business Group',
                'Use Root Organization',
                'Ask Me Later'
            );

            if (selection === 'Select Business Group') {
                // Open the business group selector
                const { showBusinessGroupSelectorWebview } = await import('../anypoint/businessGroupSelector.js');
                await showBusinessGroupSelectorWebview(this.context);
                return true;
            } else if (selection === 'Use Root Organization') {
                // Set root organization as the business group (explicit choice)
                await accountService.setAccountBusinessGroup(
                    accountId,
                    account.organizationId,
                    account.organizationName
                );
                vscode.window.showInformationMessage(
                    `Using root organization: ${account.organizationName}`
                );
                return true;
            }

            // "Ask Me Later" or dismissed - don't prompt again this session
            return false;
        } catch (error) {
            console.error('Error prompting for business group selection:', error);
            return false;
        }
    }
}
