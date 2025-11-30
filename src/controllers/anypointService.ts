import * as vscode from 'vscode';
import axios from 'axios';
import { BASE_URL } from '../constants';
import { refreshAccessToken } from './oauthService';
// Helper function to refresh token with account context
async function refreshTokenWithAccount(context: vscode.ExtensionContext): Promise<boolean> {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    return await refreshAccessToken(context, activeAccount?.id);
}

// Helper function to get fresh token after refresh
async function getRefreshedToken(context: vscode.ExtensionContext): Promise<string | undefined> {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);
    
    let accessToken = await accountService.getActiveAccountAccessToken();
    if (!accessToken) {
        accessToken = await context.secrets.get('anypoint.accessToken');
    }
    return accessToken;
}
import { showApplicationsWebview } from '../anypoint/cloudhub2Applications';
import { showApplicationsWebview1 } from '../anypoint/cloudhub1Applications';
import { getUserInfoWebviewContent } from '../anypoint/userInfoContent';
import { getOrgInfoWebviewContent } from '../anypoint/organizationInfo';
import { showEnvironmentAndOrgPanel } from '../anypoint/DeveloperInfo';
import { showAPIManagerWebview } from '../anypoint/apiMananagerAPIs';
import { showEnvironmentComparisonWebview } from '../anypoint/environmentComparison';
import {
    HYBRID_APPLICATIONS_ENDPOINT,
    HYBRID_SERVERS_ENDPOINT,
    HYBRID_SERVER_GROUPS_ENDPOINT,
    HYBRID_CLUSTERS_ENDPOINT,
    ANYPOINT_MQ_BASE,
    ANYPOINT_MQ_ADMIN_BASE,
    ANYPOINT_MQ_STATS_BASE
} from '../constants';

// ============================================================================
// HYBRID / ON-PREMISES RUNTIME MANAGER FUNCTIONS
// ============================================================================

/**
 * Fetch all Hybrid applications deployed to on-premises runtimes
 */
export async function getHybridApplications(context: vscode.ExtensionContext, environmentId: string) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }

    const organizationID = activeAccount.organizationId;
    console.log(`Hybrid Apps: Fetching applications for org ${organizationID}, env ${environmentId}`);

    // Get environment name
    let storedEnvironments = await accountService.getActiveAccountEnvironments();
    if (!storedEnvironments) {
        storedEnvironments = await context.secrets.get('anypoint.environments');
    }

    let environmentName = environmentId; // fallback

    if (storedEnvironments) {
        try {
            const environments = JSON.parse(storedEnvironments);
            const selectedEnv = environments.data?.find((env: any) => env.id === environmentId);
            if (selectedEnv) {
                environmentName = selectedEnv.name;
            }
        } catch (error) {
            console.warn('Failed to parse environments for name lookup');
        }
    }

    // Store selected environment
    await context.secrets.store('anypoint.selectedEnvironment', JSON.stringify({
        id: environmentId,
        name: environmentName
    }));

    try {
        console.log(`Hybrid Apps: Making API call to ${HYBRID_APPLICATIONS_ENDPOINT}`);
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(HYBRID_APPLICATIONS_ENDPOINT, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });

        console.log(`Hybrid Apps: API response status: ${response.status}`);
        console.log(`Hybrid Apps: Found ${response.data?.data?.length || 0} applications`);

        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = response.data;

        // Import and show the Hybrid applications webview
        const { showHybridApplicationsWebview } = await import('../anypoint/hybridApplications.js');
        showHybridApplicationsWebview(context, data, environmentId, environmentName);
    } catch (error: any) {
        console.error(`Hybrid Apps: Error fetching applications:`, error);
        vscode.window.showErrorMessage(`Error calling Hybrid API: ${error.message}`);
    }
}

/**
 * Fetch all Hybrid servers (Mule Runtimes) registered in Runtime Manager
 */
export async function getHybridServers(context: vscode.ExtensionContext, environmentId: string) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }

    const organizationID = activeAccount.organizationId;
    console.log(`Hybrid Servers: Fetching servers for org ${organizationID}, env ${environmentId}`);

    try {
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(HYBRID_SERVERS_ENDPOINT, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });

        console.log(`Hybrid Servers: API response status: ${response.status}`);
        console.log(`Hybrid Servers: Found ${response.data?.data?.length || 0} servers`);

        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = response.data;

        // Import and show the Hybrid servers webview
        const { showHybridServersWebview } = await import('../anypoint/hybridServers.js');
        showHybridServersWebview(context, data, environmentId);
    } catch (error: any) {
        console.error(`Hybrid Servers: Error fetching servers:`, error);
        vscode.window.showErrorMessage(`Error calling Hybrid Servers API: ${error.message}`);
    }
}

/**
 * Fetch all Hybrid server groups
 */
export async function getHybridServerGroups(context: vscode.ExtensionContext, environmentId: string) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }

    const organizationID = activeAccount.organizationId;
    console.log(`Hybrid Server Groups: Fetching for org ${organizationID}, env ${environmentId}`);

    try {
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(HYBRID_SERVER_GROUPS_ENDPOINT, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });

        console.log(`Hybrid Server Groups: API response status: ${response.status}`);
        console.log(`Hybrid Server Groups: Found ${response.data?.data?.length || 0} groups`);

        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = response.data;

        // Import and show the Hybrid server groups webview
        const { showHybridServerGroupsWebview } = await import('../anypoint/hybridServerGroups.js');
        showHybridServerGroupsWebview(context, data, environmentId);
    } catch (error: any) {
        console.error(`Hybrid Server Groups: Error:`, error);
        vscode.window.showErrorMessage(`Error calling Hybrid Server Groups API: ${error.message}`);
    }
}

/**
 * Fetch all Hybrid clusters
 */
export async function getHybridClusters(context: vscode.ExtensionContext, environmentId: string) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }

    const organizationID = activeAccount.organizationId;
    console.log(`Hybrid Clusters: Fetching for org ${organizationID}, env ${environmentId}`);

    try {
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(HYBRID_CLUSTERS_ENDPOINT, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });

        console.log(`Hybrid Clusters: API response status: ${response.status}`);
        console.log(`Hybrid Clusters: Found ${response.data?.data?.length || 0} clusters`);

        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = response.data;

        // Import and show the Hybrid clusters webview
        const { showHybridClustersWebview } = await import('../anypoint/hybridClusters.js');
        showHybridClustersWebview(context, data, environmentId);
    } catch (error: any) {
        console.error(`Hybrid Clusters: Error:`, error);
        vscode.window.showErrorMessage(`Error calling Hybrid Clusters API: ${error.message}`);
    }
}

// ============================================================================
// END HYBRID FUNCTIONS
// ============================================================================

// ============================================================================
// ANYPOINT MQ STATS FUNCTIONS
// ============================================================================

/**
 * Fetch AnypointMQ Statistics for queues in a specific environment and region
 */
export async function getAnypointMQStats(context: vscode.ExtensionContext, environmentId: string) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }

    const organizationID = activeAccount.organizationId;
    console.log(`AnypointMQ Stats: Fetching for org ${organizationID}, env ${environmentId}`);

    // Get environment name
    let storedEnvironments = await accountService.getActiveAccountEnvironments();
    if (!storedEnvironments) {
        storedEnvironments = await context.secrets.get('anypoint.environments');
    }

    let environmentName = environmentId; // fallback

    if (storedEnvironments) {
        try {
            const environments = JSON.parse(storedEnvironments);
            const selectedEnv = environments.data?.find((env: any) => env.id === environmentId);
            if (selectedEnv) {
                environmentName = selectedEnv.name;
            }
        } catch (error) {
            console.warn('Failed to parse environments for name lookup');
        }
    }

    // First, we need to get available regions for this environment
    // The MQ Stats API requires a region ID
    try {
        const apiHelper = new ApiHelper(context);

        // Get available regions from the MQ Broker API
        const regionsUrl = `${ANYPOINT_MQ_ADMIN_BASE}/organizations/${organizationID}/environments/${environmentId}/regions`;
        console.log(`AnypointMQ Stats: Fetching regions from ${regionsUrl}`);
        console.log(`AnypointMQ Stats: Organization ID: ${organizationID}`);
        console.log(`AnypointMQ Stats: Environment ID: ${environmentId}`);

        let regionsResponse;
        try {
            regionsResponse = await apiHelper.get(regionsUrl);
        } catch (error: any) {
            console.error(`AnypointMQ Stats: Failed to fetch regions:`, error);
            vscode.window.showErrorMessage(`Failed to fetch MQ regions. Please ensure AnypointMQ is enabled for this environment.`);
            return;
        }

        if (!regionsResponse.data || regionsResponse.data.length === 0) {
            vscode.window.showErrorMessage('No AnypointMQ regions found for this environment. Please ensure AnypointMQ is configured.');
            return;
        }

        const regions = Array.isArray(regionsResponse.data) ? regionsResponse.data : [regionsResponse.data];
        console.log(`AnypointMQ Stats: Found ${regions.length} regions`);

        // Show region selector with "All Regions" option
        let selectedRegionId: string | null = null;
        let selectedRegionName = 'All Regions';

        if (regions.length > 1) {
            const regionOptions = [
                { label: '📊 All Regions', id: null },
                ...regions.map((region: any) => ({
                    label: `📍 ${region.regionName || region.id}`,
                    id: region.regionId || region.id
                }))
            ];

            const selectedRegion = await vscode.window.showQuickPick(
                regionOptions.map(option => option.label),
                { placeHolder: 'Select an AnypointMQ region or view all' }
            );

            if (!selectedRegion) {
                vscode.window.showInformationMessage('No region selected.');
                return;
            }

            const selectedOption = regionOptions.find(option => option.label === selectedRegion);
            selectedRegionId = selectedOption?.id || null;
            selectedRegionName = selectedOption?.label.replace('📍 ', '').replace('📊 ', '') || 'All Regions';
        } else {
            selectedRegionId = regions[0].regionId || regions[0].id;
            selectedRegionName = regions[0].regionName || regions[0].id;
        }

        console.log(`AnypointMQ Stats: Selected region ${selectedRegionId || 'ALL'}`);

        // Fetch data for all regions or selected region
        let allRegionsData: any[] = [];

        if (selectedRegionId === null) {
            // Fetch queues and stats for all regions
            console.log(`AnypointMQ Stats: Fetching queues from all ${regions.length} regions`);

            for (const region of regions) {
                const regionId = region.regionId || region.id;
                const regionName = region.regionName || region.id;

                try {
                    // Fetch queues (destinations) for this region using the Admin API
                    const queuesUrl = `${ANYPOINT_MQ_ADMIN_BASE}/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/destinations`;
                    console.log(`AnypointMQ Stats: Fetching queues for region ${regionName} from ${queuesUrl}`);
                    console.log(`AnypointMQ Stats: Region ID being used: ${regionId}`);

                    const queuesResponse = await apiHelper.get(queuesUrl);
                    console.log(`AnypointMQ Stats: Raw response for region ${regionName}:`, JSON.stringify(queuesResponse.data, null, 2));

                    // Handle different response structures
                    let queues = queuesResponse.data;
                    if (!Array.isArray(queues)) {
                        // Check if data is wrapped in a property
                        if (queues && queues.queues) {
                            queues = queues.queues;
                        } else if (queues && queues.destinations) {
                            queues = queues.destinations;
                        } else if (queues && typeof queues === 'object') {
                            // If it's a single object, wrap it in an array
                            queues = [queues];
                        } else {
                            queues = [];
                        }
                    }

                    // Filter out null/undefined entries
                    queues = queues.filter((q: any) => q && (q.queueId || q.id));

                    console.log(`AnypointMQ Stats: Parsed ${queues.length} queues in region ${regionName}`);

                    if (queues.length > 0) {
                        // Fetch stats for all queues in this region
                        const queueIds = queues.map((queue: any) => queue.queueId || queue.id).join(',');
                        console.log(`AnypointMQ Stats: Fetching stats for queue IDs: ${queueIds}`);

                        const statsUrl = `${ANYPOINT_MQ_STATS_BASE}/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/queues?destinationIds=${queueIds}`;
                        const statsResponse = await apiHelper.get(statsUrl);

                        console.log(`AnypointMQ Stats: Stats response for region ${regionName}:`, JSON.stringify(statsResponse.data, null, 2));

                        allRegionsData.push({
                            regionId: regionId,
                            regionName: regionName,
                            queues: queues,
                            stats: Array.isArray(statsResponse.data) ? statsResponse.data : [statsResponse.data]
                        });

                        console.log(`AnypointMQ Stats: ✓ Found ${queues.length} queues in region ${regionName}`);
                    } else {
                        console.log(`AnypointMQ Stats: ✗ No queues in region ${regionName}`);
                    }
                } catch (error: any) {
                    console.error(`AnypointMQ Stats: ✗ Failed to fetch data for region ${regionName}:`, error.message);
                    if (error.response) {
                        console.error(`AnypointMQ Stats: Error response status:`, error.response.status);
                        console.error(`AnypointMQ Stats: Error response data:`, error.response.data);
                    }
                }
            }

            if (allRegionsData.length === 0) {
                vscode.window.showInformationMessage('No queues found in any region.');
                return;
            }

            const statsData = {
                allRegions: true,
                regionsData: allRegionsData,
                environmentId: environmentId,
                environmentName: environmentName,
                organizationID: organizationID
            };

            // Import and show the MQ Stats webview
            const { showAnypointMQStatsWebview } = await import('../anypoint/mqStats.js');
            showAnypointMQStatsWebview(context, statsData);
        } else {
            // Fetch queues (destinations) for the selected region only using the Admin API
            const queuesUrl = `${ANYPOINT_MQ_ADMIN_BASE}/organizations/${organizationID}/environments/${environmentId}/regions/${selectedRegionId}/destinations`;
            console.log(`AnypointMQ Stats: Fetching queues from ${queuesUrl}`);

            const queuesResponse = await apiHelper.get(queuesUrl);
            console.log(`AnypointMQ Stats: Raw queue response:`, JSON.stringify(queuesResponse.data, null, 2));

            // Handle different response structures
            let queues = queuesResponse.data;
            if (!Array.isArray(queues)) {
                // Check if data is wrapped in a property
                if (queues && queues.queues) {
                    queues = queues.queues;
                } else if (queues && queues.destinations) {
                    queues = queues.destinations;
                } else if (queues && typeof queues === 'object' && queues !== null) {
                    // If it's a single object, wrap it in an array
                    queues = [queues];
                } else {
                    queues = [];
                }
            }

            // Filter out null/undefined entries
            queues = queues.filter((q: any) => q && (q.queueId || q.id));

            console.log(`AnypointMQ Stats: Parsed ${queues.length} queues`);

            if (!queues || queues.length === 0) {
                vscode.window.showInformationMessage('No queues found in this region.');
                return;
            }

            // Fetch stats for all queues
            const queueIds = queues.map((queue: any) => queue.queueId || queue.id).join(',');
            console.log(`AnypointMQ Stats: Queue IDs for stats: ${queueIds}`);

            const statsUrl = `${ANYPOINT_MQ_STATS_BASE}/organizations/${organizationID}/environments/${environmentId}/regions/${selectedRegionId}/queues?destinationIds=${queueIds}`;

            console.log(`AnypointMQ Stats: Fetching stats from ${statsUrl}`);
            const statsResponse = await apiHelper.get(statsUrl);

            console.log(`AnypointMQ Stats: API response status: ${statsResponse.status}`);
            console.log(`AnypointMQ Stats: Stats response:`, JSON.stringify(statsResponse.data, null, 2));

            if (statsResponse.status !== 200) {
                throw new Error(`API request failed with status ${statsResponse.status}`);
            }

            const statsData = {
                allRegions: false,
                queues: queues,
                stats: Array.isArray(statsResponse.data) ? statsResponse.data : [statsResponse.data],
                region: selectedRegionId,
                regionName: selectedRegionName,
                environmentId: environmentId,
                environmentName: environmentName,
                organizationID: organizationID
            };

            // Import and show the MQ Stats webview
            const { showAnypointMQStatsWebview } = await import('../anypoint/mqStats.js');
            showAnypointMQStatsWebview(context, statsData);
        }
    } catch (error: any) {
        console.error(`AnypointMQ Stats: Error:`, error);
        vscode.window.showErrorMessage(`Error calling AnypointMQ Stats API: ${error.message}`);
    }
}

// ============================================================================
// END ANYPOINT MQ STATS FUNCTIONS
// ============================================================================

export async function getUserInfo(context: vscode.ExtensionContext, isNewAccount: boolean = false) {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);
    
    let accessToken: string | undefined;
    
    if (isNewAccount) {
        console.log('getUserInfo: Getting temporary access token for new account');
        accessToken = await context.secrets.get('anypoint.tempAccessToken');
        console.log('getUserInfo: Temporary access token found:', !!accessToken);
        if (accessToken) {
            console.log('getUserInfo: Access token length:', accessToken.length);
        } else {
            console.log('getUserInfo: No temporary access token found in secrets');
            // Let's check if main account tokens exist
            const mainToken = await context.secrets.get('anypoint.accessToken');
            console.log('getUserInfo: Main access token exists:', !!mainToken);
            throw new Error('No temporary access token found. Please try logging in again.');
        }
    } else {
        accessToken = await accountService.getActiveAccountAccessToken();
        if (!accessToken) {
            accessToken = await context.secrets.get('anypoint.accessToken');
        }
        if (!accessToken) {
            throw new Error('No access token found. Please log in first.');
        }
    }

    const apiUrl = BASE_URL + '/accounts/api/me';

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const data = response.data;
        
        if (isNewAccount) {
            await context.secrets.store('anypoint.tempUserInfo', JSON.stringify(data.user));
            
            const userInfo = data.user;
            const orgId = userInfo.organization.id;
            const accountId = `account_${orgId}_${Date.now()}`;
            
            const tempAccessToken = await context.secrets.get('anypoint.tempAccessToken');
            const tempRefreshToken = await context.secrets.get('anypoint.tempRefreshToken');
            
            if (tempAccessToken) {
                await accountService.setAccountData(accountId, 'accessToken', tempAccessToken);
                await context.secrets.delete('anypoint.tempAccessToken');
            }
            if (tempRefreshToken) {
                await accountService.setAccountData(accountId, 'refreshToken', tempRefreshToken);
                await context.secrets.delete('anypoint.tempRefreshToken');
            }
            
            await accountService.setAccountData(accountId, 'userInfo', JSON.stringify(userInfo));
            
            const account = {
                id: accountId,
                organizationId: orgId,
                organizationName: userInfo.organization.name || 'Unknown Organization',
                userEmail: userInfo.email || 'unknown@email.com',
                userName: userInfo.username || userInfo.firstName + ' ' + userInfo.lastName || 'Unknown User',
                isActive: false,
                lastUsed: new Date().toISOString(),
                status: 'authenticated' as const
            };
            
            await accountService.addAccount(account);
            await context.secrets.delete('anypoint.tempUserInfo');
            
            return data;
        } else {
            const activeAccount = await accountService.getActiveAccount();
            if (activeAccount) {
                await accountService.setAccountData(activeAccount.id, 'userInfo', JSON.stringify(data.user));
            } else {
                await context.secrets.store('anypoint.userInfo', JSON.stringify(data.user));
            }

            const panel = vscode.window.createWebviewPanel(
                'userInfoWebview',
                'User Information',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            panel.webview.html = getUserInfoWebviewContent(data, panel.webview, context.extensionUri);
        }
    } catch (error: any) {
        // For existing accounts, use the ApiHelper for automatic 401 handling
        if (!isNewAccount) {
            try {
                const { ApiHelper } = await import('./apiHelper.js');
                const apiHelper = new ApiHelper(context);
                const response = await apiHelper.get(apiUrl);
                const data = response.data;
                
                const activeAccount = await accountService.getActiveAccount();
                if (activeAccount) {
                    await accountService.setAccountData(activeAccount.id, 'userInfo', JSON.stringify(data.user));
                } else {
                    await context.secrets.store('anypoint.userInfo', JSON.stringify(data.user));
                }

                const panel = vscode.window.createWebviewPanel(
                    'userInfoWebview',
                    'User Information',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );
                panel.webview.html = getUserInfoWebviewContent(data, panel.webview, context.extensionUri);
                return;
            } catch (apiHelperError: any) {
                vscode.window.showErrorMessage(`Error calling API: ${apiHelperError.message}`);
                return;
            }
        }
        
        vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
    }
}

export async function getOrganizationInfo(context: vscode.ExtensionContext) {
    const { ApiHelper } = await import('./apiHelper.js');
    const apiHelper = new ApiHelper(context);

    const apiUrl = BASE_URL + '/cloudhub/api/organization';

    try {
        const response = await apiHelper.get(apiUrl);
        const data = response.data;
        const panel = vscode.window.createWebviewPanel(
            'orgInfoWebview',
            'Organization Details',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getOrgInfoWebviewContent(data, panel.webview, context.extensionUri);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
    }
}

export async function developerInfo(context: vscode.ExtensionContext) {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);
    
    let storedUserInfo = await accountService.getActiveAccountUserInfo();
    let storedEnvironments = await accountService.getActiveAccountEnvironments();

    if (!storedUserInfo) {
        storedUserInfo = await context.secrets.get('anypoint.userInfo');
    }
    if (!storedEnvironments) {
        storedEnvironments = await context.secrets.get('anypoint.environments');
    }

    if (!storedUserInfo || !storedEnvironments) {
        vscode.window.showErrorMessage('User info or environment info not found. Please log in first.');
        return;
    }

    const userInfo = JSON.parse(storedUserInfo);
    const parsedEnvironments = JSON.parse(storedEnvironments);

    showEnvironmentAndOrgPanel(
        context,
        { orgName: '-', orgId: userInfo.organization.id },
        parsedEnvironments.data
    );
}

export async function getEnvironments(context: vscode.ExtensionContext, isNewAccount: boolean = false) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);
    
    let userInfo: string | undefined;
    let organizationID: string;
    
    if (isNewAccount) {
        userInfo = await context.secrets.get('anypoint.tempUserInfo');
        if (!userInfo) {
            throw new Error('No temporary user info found. Please try logging in again.');
        }
        organizationID = JSON.parse(userInfo).organization.id;
    } else {
        const activeAccount = await accountService.getActiveAccount();
        if (!activeAccount) {
            throw new Error('No active account found. Please log in first.');
        }
        organizationID = activeAccount.organizationId;
    }

    const apiUrl = BASE_URL + '/accounts/api/organizations/' + organizationID + '/environments';

    try {
        let response;
        
        if (isNewAccount) {
            // For new accounts, use temporary token manually
            const tempToken = await context.secrets.get('anypoint.tempAccessToken');
            if (!tempToken) {
                throw new Error('No temporary access token found. Please try logging in again.');
            }
            response = await axios.get(apiUrl, {
                headers: { Authorization: `Bearer ${tempToken}` },
            });
        } else {
            // For existing accounts, use ApiHelper for automatic token management
            const apiHelper = new ApiHelper(context);
            response = await apiHelper.get(apiUrl);
        }
        
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        
        // Store environments based on account type
        if (isNewAccount) {
            await context.secrets.store('anypoint.tempEnvironments', JSON.stringify(response.data));
            
            const tempUserInfo = await context.secrets.get('anypoint.tempUserInfo');
            if (tempUserInfo) {
                const userInfoData = JSON.parse(tempUserInfo);
                const orgId = userInfoData.organization.id;
                const accounts = await accountService.getAccounts();
                const account = accounts.find(acc => acc.organizationId === orgId);
                
                if (account) {
                    await accountService.setAccountData(account.id, 'environments', JSON.stringify(response.data));
                }
            }
            
            await context.secrets.delete('anypoint.tempEnvironments');
        } else {
            // Store environments for the active account
            const activeAccount = await accountService.getActiveAccount();
            if (activeAccount) {
                await accountService.setAccountData(activeAccount.id, 'environments', JSON.stringify(response.data));
                console.log(`Stored ${response.data?.data?.length || 0} environments for account ${activeAccount.userName} (${activeAccount.organizationName})`);
            } else {
                // Fallback to legacy storage if no active account
                await context.secrets.store('anypoint.environments', JSON.stringify(response.data));
                console.log('Stored environments in legacy storage (no active account found)');
            }
        }
        
        return response.data;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
    }
}

export async function getCH2Applications(context: vscode.ExtensionContext, environmentId: string) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);
    
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }
    
    const organizationID = activeAccount.organizationId;
    console.log(`CloudHub 2.0: Fetching applications for org ${organizationID}, env ${environmentId}`);
    console.log(`CloudHub 2.0: Active account: ${activeAccount.userEmail} (${activeAccount.organizationName})`);

    // FIXED: Store the selected environment ID and get environment name
    let storedEnvironments = await accountService.getActiveAccountEnvironments();
    if (!storedEnvironments) {
        storedEnvironments = await context.secrets.get('anypoint.environments');
    }
    
    let environmentName = environmentId; // fallback
    
    if (storedEnvironments) {
        try {
            const environments = JSON.parse(storedEnvironments);
            const selectedEnv = environments.data?.find((env: any) => env.id === environmentId);
            if (selectedEnv) {
                environmentName = selectedEnv.name;
            }
        } catch (error) {
            console.warn('Failed to parse environments for name lookup');
        }
    }

    // FIXED: Store the selected environment info
    await context.secrets.store('anypoint.selectedEnvironment', JSON.stringify({
        id: environmentId,
        name: environmentName
    }));

    const apiUrl = BASE_URL + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + environmentId + '/deployments';

    try {
        console.log(`CloudHub 2.0: Making API call to ${apiUrl}`);
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(apiUrl);
        
        console.log(`CloudHub 2.0: API response status: ${response.status}`);
        console.log(`CloudHub 2.0: Response data structure:`, Object.keys(response.data || {}));
        console.log(`CloudHub 2.0: Full response data:`, JSON.stringify(response.data, null, 2));
        
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        
        const data = response.data;
        
        // Check if we have applications
        let applicationsFound = 0;
        if (Array.isArray(data)) {
            applicationsFound = data.length;
        } else if (data.items && Array.isArray(data.items)) {
            applicationsFound = data.items.length;
        } else if (data.data && Array.isArray(data.data)) {
            applicationsFound = data.data.length;
        }
        
        console.log(`CloudHub 2.0: Found ${applicationsFound} applications in environment ${environmentName}`);
        
        // FIXED: Pass environment name for display, but ID is stored in secrets
        showApplicationsWebview(context, data, environmentName);
    } catch (error: any) {
        console.error(`CloudHub 2.0: Error fetching applications:`, error);
        
        if (error.message.includes('Access denied') || error.message.includes('403') || error.message.includes('Forbidden')) {
            console.log(`CloudHub 2.0: Access denied for environment ${environmentName}`);
            
            // Show detailed error message with options
            const action = await vscode.window.showWarningMessage(
                `CloudHub 2.0 access denied for environment "${environmentName}". This might be because:

• CloudHub 2.0 is not licensed for this environment
• Your account (${activeAccount.userEmail}) doesn't have CloudHub 2.0 permissions
• CloudHub 2.0 apps are in a different environment
• This environment only supports CloudHub 1.0

Would you like to try CloudHub 1.0 applications instead?`,
                'Try CloudHub 1.0',
                'Select Different Environment',
                'Cancel'
            );
            
            if (action === 'Try CloudHub 1.0') {
                console.log(`CloudHub 2.0: User chose to try CloudHub 1.0 for environment ${environmentId}`);
                try {
                    await getCH1Applications(context, environmentId);
                } catch (ch1Error: any) {
                    vscode.window.showErrorMessage(`CloudHub 1.0 also failed: ${ch1Error.message}`);
                }
            } else if (action === 'Select Different Environment') {
                // Trigger environment selection
                vscode.commands.executeCommand('anypoint-monitor.cloudhub2Apps');
            }
        } else {
            vscode.window.showErrorMessage(`Error calling CloudHub 2.0 API: ${error.message}`);
        }
    }
}


export async function getCH1Applications(context: vscode.ExtensionContext, environmentId: string) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }

    const organizationID = activeAccount.organizationId;
    console.log(`CloudHub 1.0: Fetching applications for org ${organizationID}, env ${environmentId}`);
    console.log(`CloudHub 1.0: Active account: ${activeAccount.userName} (${activeAccount.organizationName})`);

    // Get environment name from stored environments
    const storedEnvironments = await accountService.getActiveAccountEnvironments();
    let environmentName = 'Unknown';
    if (storedEnvironments) {
        try {
            const environments = JSON.parse(storedEnvironments);
            const env = environments.data?.find((e: any) => e.id === environmentId);
            if (env) {
                environmentName = env.name;
            }
        } catch (error) {
            console.error('Error parsing environments:', error);
        }
    }

    const apiUrl = BASE_URL + '/cloudhub/api/applications';

    try {
        console.log(`CloudHub 1.0: Making API call to ${apiUrl}`);
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(apiUrl, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });

        console.log(`CloudHub 1.0: API response status: ${response.status}`);
        console.log(`CloudHub 1.0: Found ${Array.isArray(response.data) ? response.data.length : 0} applications`);

        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = response.data;
        showApplicationsWebview1(context, data, environmentId, environmentName);
    } catch (error: any) {
        console.error(`CloudHub 1.0: Error fetching applications:`, error);
        if (error.message.includes('Access denied') || error.message.includes('403')) {
            vscode.window.showErrorMessage(`CloudHub 1.0 access denied for account ${activeAccount.userName}. This might be because:
1. CloudHub 1.0 is not licensed for this environment
2. Your account doesn't have CloudHub 1.0 permissions
3. CloudHub 1.0 apps are in a different environment

Try selecting a different environment or check your account permissions.`);
        } else {
            vscode.window.showErrorMessage(`Error calling CloudHub 1.0 API: ${error.message}`);
        }
    }
}

export async function retrieveAPIManagerAPIs(context: vscode.ExtensionContext) {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);
    
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        vscode.window.showErrorMessage('No active account found. Please log in first.');
        return;
    }

    const storedEnvironments = await accountService.getActiveAccountEnvironments();
    if (!storedEnvironments) {
        vscode.window.showErrorMessage('No environment information found. Please log in first.');
        return;
    }

    try {
        const environments = JSON.parse(storedEnvironments) as { data: { id: string; name: string }[]; total: number };
        if (!environments.data || environments.data.length === 0) {
            vscode.window.showErrorMessage('No environments available.');
            return;
        }
        const environmentOptions = environments.data.map(env => ({ label: env.name, id: env.id }));
        const selectedEnvironment = await vscode.window.showQuickPick(
            environmentOptions.map(option => option.label),
            { placeHolder: 'Select an environment' }
        );
        if (!selectedEnvironment) {
            vscode.window.showInformationMessage('No environment selected.');
            return;
        }
        const selectedEnvironmentId = environmentOptions.find(option => option.label === selectedEnvironment)?.id;
        if (!selectedEnvironmentId) {
            vscode.window.showErrorMessage('Failed to find the selected environment ID.');
            return;
        }
        
        const organizationID = activeAccount.organizationId;
        showAPIManagerWebview(context, selectedEnvironmentId, organizationID);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error: ${error.message || error}`);
    }
}

// Smart application name matching algorithm
function normalizeApplicationName(appName: string, environmentName: string): string {
    if (!appName || !environmentName) return appName || '';
    
    const name = appName.toLowerCase();
    const env = environmentName.toLowerCase();
    
    // Common environment suffixes and prefixes to remove
    const environmentPatterns = [
        // Exact environment name matches
        new RegExp(`-${env}$`, 'i'),           // myapp-prod
        new RegExp(`^${env}-`, 'i'),           // prod-myapp
        new RegExp(`-${env}-`, 'i'),           // prefix-prod-suffix
        
        // Common environment variations
        '-prod$', '-production$', '-prd$',
        '-dev$', '-develop$', '-development$', '-devel$',
        '-test$', '-testing$', '-tst$',
        '-stage$', '-staging$', '-stg$',
        '-uat$', '-useracceptance$',
        '-qa$', '-quality$', '-qua$',
        '-sandbox$', '-sbx$', '-sb$',
        '-demo$', '-preview$', '-pre$',
        '-int$', '-integration$', '-integ$',
        '-sit$', '-systemintegration$',
        '-perf$', '-performance$',
        '-load$', '-stress$',
        
        // Prefix patterns
        '^prod-', '^production-', '^prd-',
        '^dev-', '^develop-', '^development-', '^devel-',
        '^test-', '^testing-', '^tst-',
        '^stage-', '^staging-', '^stg-',
        '^uat-', '^useracceptance-',
        '^qa-', '^quality-', '^qua-',
        '^sandbox-', '^sbx-', '^sb-',
        '^demo-', '^preview-', '^pre-',
        '^int-', '^integration-', '^integ-',
        '^sit-', '^systemintegration-',
        '^perf-', '^performance-',
        '^load-', '^stress-'
    ];
    
    let normalizedName = name;
    
    // Remove environment patterns
    for (const pattern of environmentPatterns) {
        normalizedName = normalizedName.replace(new RegExp(pattern, 'i'), '');
    }
    
    // Clean up any resulting double hyphens
    normalizedName = normalizedName.replace(/--+/g, '-');
    
    // Remove leading/trailing hyphens
    normalizedName = normalizedName.replace(/^-+|-+$/g, '');
    
    return normalizedName || appName; // Fallback to original if normalization results in empty string
}

// Function to find the best application group name
function getBestApplicationGroupName(apps: any[]): string {
    if (!apps || apps.length === 0) return '';
    
    // Find the longest common name (likely the most descriptive)
    const names = apps.map(app => app.originalName || app.name);
    let bestName = names[0];
    
    for (const name of names) {
        if (name.length > bestName.length) {
            bestName = name;
        }
    }
    
    return bestName;
}

export async function getEnvironmentComparison(context: vscode.ExtensionContext) {
    const { AccountService } = await import('./accountService.js');
    const { ApiHelper } = await import('./apiHelper.js');
    const accountService = new AccountService(context);
    
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        vscode.window.showErrorMessage('No active account found. Please log in first.');
        return;
    }

    const storedEnvironments = await accountService.getActiveAccountEnvironments();
    if (!storedEnvironments) {
        vscode.window.showErrorMessage('No environment information found. Please log in first.');
        return;
    }

    const organizationID = activeAccount.organizationId;
    const environments = JSON.parse(storedEnvironments);
    const apiHelper = new ApiHelper(context);

    if (!environments.data || environments.data.length === 0) {
        vscode.window.showErrorMessage('No environments available.');
        return;
    }

    // Filter out Design environment as it's typically used for API design, not deployments
    const filteredEnvironments = environments.data.filter((env: any) => 
        env.name.toLowerCase() !== 'design' && 
        env.type?.toLowerCase() !== 'design'
    );

    if (filteredEnvironments.length === 0) {
        vscode.window.showErrorMessage('No deployment environments available (Design environment excluded).');
        return;
    }

    const comparisonData: any = {
        environments: filteredEnvironments,
        applications: {}
    };
    
    // Temporary storage for grouping applications by normalized names
    const applicationGroups: { [normalizedName: string]: any[] } = {};

    for (const env of filteredEnvironments) {
        try {
            // Fetch CloudHub 1.0 applications
            const ch1Response = await apiHelper.get(BASE_URL + '/cloudhub/api/applications', {
                headers: {
                    'X-ANYPNT-ENV-ID': env.id,
                    'X-ANYPNT-ORG-ID': organizationID,
                },
            });

            if (ch1Response.status === 200) {
                const ch1Apps = Array.isArray(ch1Response.data) ? ch1Response.data : [];
                ch1Apps.forEach((app: any) => {
                    // Debug: Log filename-related fields
                    console.log(`CH1 App ${app.domain} filename fields:`, {
                        filename: app.filename,
                        file: app.file,
                        muleArtifact: app.muleArtifact,
                        artifact: app.artifact,
                        deploymentFile: app.deploymentFile,
                        applicationFile: app.applicationFile
                    });
                    
                    const normalizedName = normalizeApplicationName(app.domain, env.name);
                    
                    // Group applications by normalized name
                    if (!applicationGroups[normalizedName]) {
                        applicationGroups[normalizedName] = [];
                    }
                    
                    const appInfo = {
                        originalName: app.domain,
                        normalizedName: normalizedName,
                        environmentId: env.id,
                        environmentName: env.name,
                        type: 'CH1',
                        deploymentData: {
                            environmentName: env.name,
                            status: app.status,
                            version: app.muleVersion || app.filename || app.versionId || 'N/A',
                            runtime: app.muleVersion || app.runtime || 'N/A',
                            region: app.region || 'N/A',
                            workers: app.workers || 'N/A',
                            workerType: app.workerType || 'N/A',
                            lastUpdateTime: app.lastUpdateTime || 'N/A',
                            filename: app.filename || app.file || app.muleArtifact || app.deploymentFile || 'N/A',
                            // Advanced CloudHub 1.0 fields
                            fullDomain: app.fullDomain || 'N/A',
                            monitoringEnabled: app.monitoringEnabled !== undefined ? app.monitoringEnabled : 'N/A',
                            objectStoreV1: app.objectStoreV1 !== undefined ? app.objectStoreV1 : 'N/A',
                            persistentQueues: app.persistentQueues !== undefined ? app.persistentQueues : 'N/A',
                            multipleWorkers: app.multipleWorkers !== undefined ? app.multipleWorkers : 'N/A',
                            autoRestart: app.autoRestart !== undefined ? app.autoRestart : 'N/A',
                            staticIPsEnabled: app.staticIPsEnabled !== undefined ? app.staticIPsEnabled : 'N/A',
                            secureDataGateway: app.secureDataGateway !== undefined ? app.secureDataGateway : 'N/A',
                            hasFile: app.hasFile !== undefined ? app.hasFile : 'N/A',
                            trackingSettings: app.trackingSettings || 'N/A',
                            propertiesCount: app.properties ? Object.keys(app.properties).length : 0,
                            applicationSize: app.applicationSize || 'N/A',
                            vpn: app.vpn !== undefined ? app.vpn : 'N/A'
                        }
                    };
                    
                    applicationGroups[normalizedName].push(appInfo);
                });
            }
        } catch (error: any) {
            console.error(`Failed to fetch CH1 apps for environment ${env.name}:`, error.message);
        }

        try {
            // Fetch CloudHub 2.0 applications
            const ch2Response = await apiHelper.get(BASE_URL + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + env.id + '/deployments');

            if (ch2Response.status === 200) {
                let ch2Apps = ch2Response.data;
                if (Array.isArray(ch2Apps)) {
                    // Already an array
                } else if (ch2Apps && typeof ch2Apps === 'object') {
                    ch2Apps = ch2Apps.data || ch2Apps.applications || ch2Apps.items || [];
                }

                if (!Array.isArray(ch2Apps)) {
                    ch2Apps = [];
                }

                ch2Apps.forEach((app: any) => {
                    // Debug: Log filename-related fields
                    console.log(`CH2 App ${app.name} filename fields:`, {
                        artifact: app.artifact,
                        filename: app.filename,
                        file: app.file,
                        application: app.application,
                        deploymentArtifact: app.deploymentArtifact
                    });
                    
                    // Debug: Deep dive into application object
                    if (app.application) {
                        console.log(`CH2 App ${app.name} application object:`, JSON.stringify(app.application, null, 2));
                    }
                    
                    // Debug: Show all top-level keys in app object
                    console.log(`CH2 App ${app.name} all keys:`, Object.keys(app));
                    
                    // Debug: Check target field for artifact info
                    if (app.target) {
                        console.log(`CH2 App ${app.name} target field:`, JSON.stringify(app.target, null, 2));
                    }
                    
                    const normalizedName = normalizeApplicationName(app.name, env.name);
                    
                    // Group applications by normalized name
                    if (!applicationGroups[normalizedName]) {
                        applicationGroups[normalizedName] = [];
                    }
                    
                    const appInfo = {
                        originalName: app.name,
                        normalizedName: normalizedName,
                        environmentId: env.id,
                        environmentName: env.name,
                        type: 'CH2',
                        deploymentData: {
                        environmentName: env.name,
                        status: app.status,
                        version: app.currentRuntimeVersion || app.lastSuccessfulRuntimeVersion || app.version || app.artifact?.name || 'N/A',
                        runtime: app.currentRuntimeVersion || app.lastSuccessfulRuntimeVersion || app.runtime?.version || 'N/A',
                        replicas: app.replicas || 'N/A',
                        cpuReserved: app.cpuReserved || 'N/A',
                        memoryReserved: app.memoryReserved || 'N/A',
                        lastUpdateTime: app.lastUpdateTime || app.lastModifiedDate || 'N/A',
                        filename: app.artifact?.name || app.artifact?.fileName || app.filename || app.file || app.application?.artifact?.name || 'N/A',
                        // Advanced CloudHub 2.0 fields
                        creationDate: app.creationDate || 'N/A',
                        lastModifiedDate: app.lastModifiedDate || 'N/A',
                        deploymentId: app.id || 'N/A',
                        applicationId: app.applicationId || 'N/A',
                        minReplicas: app.autoScaling?.minReplicas || app.minReplicas || 'N/A',
                        maxReplicas: app.autoScaling?.maxReplicas || app.maxReplicas || 'N/A',
                        autoScalingEnabled: app.autoScaling?.enabled !== undefined ? app.autoScaling.enabled : 'N/A',
                        cpuLimit: app.cpuLimit || 'N/A',
                        memoryLimit: app.memoryLimit || 'N/A',
                        networkType: app.network?.type || 'N/A',
                        publicEndpoints: app.network?.publicEndpoints !== undefined ? app.network.publicEndpoints : 'N/A',
                        javaVersion: app.javaVersion || 'N/A',
                        updateStrategy: app.updateStrategy || 'N/A',
                        persistentStorage: app.persistentStorage !== undefined ? app.persistentStorage : 'N/A',
                        clustered: app.clustered !== undefined ? app.clustered : 'N/A',
                        monitoring: app.monitoring !== undefined ? app.monitoring : 'N/A'
                        }
                    };
                    
                    applicationGroups[normalizedName].push(appInfo);
                });
            }
        } catch (error: any) {
            console.error(`Failed to fetch CH2 apps for environment ${env.name}:`, error.message);
        }
    }

    // Process applicationGroups to create the final comparison structure
    for (const [normalizedName, apps] of Object.entries(applicationGroups)) {
        const groupName = getBestApplicationGroupName(apps);
        const appType = apps[0]?.type || 'Unknown';
        
        comparisonData.applications[normalizedName] = {
            name: groupName,
            normalizedName: normalizedName,
            type: appType,
            environments: {},
            originalNames: [...new Set(apps.map(app => app.originalName))] // Track all original names
        };
        
        // Populate environment data
        for (const app of apps) {
            comparisonData.applications[normalizedName].environments[app.environmentId] = app.deploymentData;
        }
    }

    showEnvironmentComparisonWebview(context, comparisonData);
}
