import * as vscode from 'vscode';
import axios from 'axios';
import {
    BASE_URL,
    getBaseUrl,
    getHybridApplicationsEndpoint,
    getHybridServersEndpoint,
    getHybridServerGroupsEndpoint,
    getHybridClustersEndpoint
} from '../constants';
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

// Helper function to get effective organization ID (business group ID if selected, otherwise root org ID)
async function getEffectiveOrganizationId(context: vscode.ExtensionContext, fallbackOrgId?: string): Promise<string> {
    const { AccountService } = await import('./accountService.js');
    const accountService = new AccountService(context);
    const effectiveOrgId = await accountService.getEffectiveOrganizationId();
    return effectiveOrgId || fallbackOrgId || '';
}
import { showApplicationsWebview } from '../anypoint/cloudhub2Applications';
import { showApplicationsWebview1 } from '../anypoint/cloudhub1Applications';
import { getUserInfoWebviewContent } from '../anypoint/userInfoContent';
import { getOrgInfoWebviewContent } from '../anypoint/organizationInfo';
import { showEnvironmentAndOrgPanel } from '../anypoint/DeveloperInfo';
import { showAPIManagerWebview } from '../anypoint/apiMananagerAPIs';
import { showEnvironmentComparisonWebview } from '../anypoint/environmentComparison';
import {
    getAnypointMqBase,
    getAnypointMqAdminBase,
    getAnypointMqStatsBase
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

    const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
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
        const hybridAppsEndpoint = await getHybridApplicationsEndpoint(context);
        console.log(`Hybrid Apps: Making API call to ${hybridAppsEndpoint}`);
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(hybridAppsEndpoint, {
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

    const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
    console.log(`Hybrid Servers: Fetching servers for org ${organizationID}, env ${environmentId}`);

    try {
        const hybridServersEndpoint = await getHybridServersEndpoint(context);
        console.log(`Hybrid Servers: Making API call to ${hybridServersEndpoint}`);
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(hybridServersEndpoint, {
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

    const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
    console.log(`Hybrid Server Groups: Fetching for org ${organizationID}, env ${environmentId}`);

    try {
        const hybridServerGroupsEndpoint = await getHybridServerGroupsEndpoint(context);
        console.log(`Hybrid Server Groups: Making API call to ${hybridServerGroupsEndpoint}`);
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(hybridServerGroupsEndpoint, {
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

    const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
    console.log(`Hybrid Clusters: Fetching for org ${organizationID}, env ${environmentId}`);

    try {
        const hybridClustersEndpoint = await getHybridClustersEndpoint(context);
        console.log(`Hybrid Clusters: Making API call to ${hybridClustersEndpoint}`);
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(hybridClustersEndpoint, {
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

    const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
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

        // Get region-specific MQ URLs
        const mqAdminBase = await getAnypointMqAdminBase(context);
        const mqStatsBase = await getAnypointMqStatsBase(context);

        // Get available regions from the MQ Broker API
        const regionsUrl = `${mqAdminBase}/organizations/${organizationID}/environments/${environmentId}/regions`;
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
                    // Fetch destinations (queues and exchanges) for this region using the Admin API
                    const destinationsUrl = `${mqAdminBase}/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/destinations`;
                    console.log(`AnypointMQ Stats: Fetching destinations for region ${regionName} from ${destinationsUrl}`);
                    console.log(`AnypointMQ Stats: Region ID being used: ${regionId}`);

                    const destinationsResponse = await apiHelper.get(destinationsUrl);
                    console.log(`AnypointMQ Stats: Raw response for region ${regionName}:`, JSON.stringify(destinationsResponse.data, null, 2));

                    // Handle different response structures
                    let destinations = destinationsResponse.data;
                    if (!Array.isArray(destinations)) {
                        // Check if data is wrapped in a property
                        if (destinations && destinations.queues) {
                            destinations = destinations.queues;
                        } else if (destinations && destinations.destinations) {
                            destinations = destinations.destinations;
                        } else if (destinations && typeof destinations === 'object') {
                            // If it's a single object, wrap it in an array
                            destinations = [destinations];
                        } else {
                            destinations = [];
                        }
                    }

                    // Filter out null/undefined entries - be more lenient
                    destinations = destinations.filter((d: any) => d && typeof d === 'object');

                    console.log(`AnypointMQ Stats: After filtering, ${destinations.length} destinations remain`);
                    console.log(`AnypointMQ Stats: Sample destination structure:`, destinations.length > 0 ? JSON.stringify(destinations[0], null, 2) : 'No destinations');

                    // Separate queues and exchanges
                    // If it has exchangeId or type='exchange', it's an exchange
                    // Otherwise, it's a queue (default)
                    const exchanges = destinations.filter((d: any) => d.exchangeId || (d.type && d.type.toLowerCase() === 'exchange'));
                    const queues = destinations.filter((d: any) => !exchanges.includes(d));

                    console.log(`AnypointMQ Stats: Parsed ${queues.length} queues and ${exchanges.length} exchanges in region ${regionName}`);

                    // Fetch stats for queues and exchanges
                    let allStats: any[] = [];
                    let allDestinations: any[] = [];

                    if (queues.length > 0) {
                        // Fetch stats for all queues in this region
                        const queueIds = queues.map((queue: any) => queue.queueId || queue.id).join(',');
                        console.log(`AnypointMQ Stats: Fetching stats for queue IDs: ${queueIds}`);

                        const queueStatsUrl = `${mqStatsBase}/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/queues?destinationIds=${queueIds}`;
                        const queueStatsResponse = await apiHelper.get(queueStatsUrl);

                        console.log(`AnypointMQ Stats: Queue stats response for region ${regionName}:`, JSON.stringify(queueStatsResponse.data, null, 2));

                        const queueStats = Array.isArray(queueStatsResponse.data) ? queueStatsResponse.data : [queueStatsResponse.data];
                        allStats = allStats.concat(queueStats);
                        allDestinations = allDestinations.concat(queues.map(q => ({ ...q, destinationType: 'queue' })));

                        console.log(`AnypointMQ Stats: ✓ Found ${queues.length} queues in region ${regionName}`);
                    }

                    if (exchanges.length > 0) {
                        // Try to fetch stats for all exchanges in this region
                        // Note: Exchange stats API may not be available in all environments
                        const exchangeIds = exchanges.map((exchange: any) => exchange.exchangeId || exchange.id).join(',');
                        console.log(`AnypointMQ Stats: Fetching stats for exchange IDs: ${exchangeIds}`);

                        try {
                            const exchangeStatsUrl = `${mqStatsBase}/organizations/${organizationID}/environments/${environmentId}/regions/${regionId}/exchanges?destinationIds=${exchangeIds}`;
                            const exchangeStatsResponse = await apiHelper.get(exchangeStatsUrl);

                            console.log(`AnypointMQ Stats: Exchange stats response for region ${regionName}:`, JSON.stringify(exchangeStatsResponse.data, null, 2));

                            const exchangeStats = Array.isArray(exchangeStatsResponse.data) ? exchangeStatsResponse.data : [exchangeStatsResponse.data];
                            allStats = allStats.concat(exchangeStats);
                            allDestinations = allDestinations.concat(exchanges.map(e => ({ ...e, destinationType: 'exchange' })));

                            console.log(`AnypointMQ Stats: ✓ Found ${exchanges.length} exchanges with stats in region ${regionName}`);
                        } catch (exchangeError: any) {
                            // If exchange stats API is not available (404), add exchanges without stats
                            if (exchangeError.response?.status === 404) {
                                console.log(`AnypointMQ Stats: ⚠️  Exchange stats API not available for region ${regionName}, showing exchanges without stats`);
                                // Add exchanges with empty stats
                                const emptyStats = exchanges.map((exchange: any) => ({
                                    destination: exchange.exchangeId || exchange.id,
                                    messages: 0,
                                    inflightMessages: 0
                                }));
                                allStats = allStats.concat(emptyStats);
                                allDestinations = allDestinations.concat(exchanges.map(e => ({ ...e, destinationType: 'exchange' })));
                                console.log(`AnypointMQ Stats: ✓ Found ${exchanges.length} exchanges (without stats) in region ${regionName}`);
                            } else {
                                console.log(`AnypointMQ Stats: ✗ Error fetching exchange stats for region ${regionName}:`, exchangeError.message);
                                throw exchangeError;
                            }
                        }
                    }

                    if (allDestinations.length > 0) {
                        allRegionsData.push({
                            regionId: regionId,
                            regionName: regionName,
                            queues: allDestinations, // Using 'queues' for backward compatibility but contains both
                            stats: allStats
                        });

                        console.log(`AnypointMQ Stats: ✓ Total ${allDestinations.length} destinations (${queues.length} queues, ${exchanges.length} exchanges) in region ${regionName}`);
                    } else {
                        console.log(`AnypointMQ Stats: ✗ No destinations in region ${regionName}`);
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
                vscode.window.showInformationMessage('No destinations (queues or exchanges) found in any region.');
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
            // Fetch destinations (queues and exchanges) for the selected region only using the Admin API
            const destinationsUrl = `${mqAdminBase}/organizations/${organizationID}/environments/${environmentId}/regions/${selectedRegionId}/destinations`;
            console.log(`AnypointMQ Stats: Fetching destinations from ${destinationsUrl}`);

            const destinationsResponse = await apiHelper.get(destinationsUrl);
            console.log(`AnypointMQ Stats: Raw destinations response:`, JSON.stringify(destinationsResponse.data, null, 2));

            // Handle different response structures
            let destinations = destinationsResponse.data;
            if (!Array.isArray(destinations)) {
                // Check if data is wrapped in a property
                if (destinations && destinations.queues) {
                    destinations = destinations.queues;
                } else if (destinations && destinations.destinations) {
                    destinations = destinations.destinations;
                } else if (destinations && typeof destinations === 'object' && destinations !== null) {
                    // If it's a single object, wrap it in an array
                    destinations = [destinations];
                } else {
                    destinations = [];
                }
            }

            // Filter out null/undefined entries - be more lenient
            destinations = destinations.filter((d: any) => d && typeof d === 'object');

            console.log(`AnypointMQ Stats: After filtering, ${destinations.length} destinations remain`);
            console.log(`AnypointMQ Stats: Sample destination structure:`, destinations.length > 0 ? JSON.stringify(destinations[0], null, 2) : 'No destinations');

            // Separate queues and exchanges
            // If it has exchangeId or type='exchange', it's an exchange
            // Otherwise, it's a queue (default)
            const exchanges = destinations.filter((d: any) => d.exchangeId || (d.type && d.type.toLowerCase() === 'exchange'));
            const queues = destinations.filter((d: any) => !exchanges.includes(d));

            console.log(`AnypointMQ Stats: Parsed ${queues.length} queues and ${exchanges.length} exchanges`);

            if (destinations.length === 0) {
                vscode.window.showInformationMessage('No destinations (queues or exchanges) found in this region.');
                return;
            }

            // Fetch stats for queues and exchanges
            let allStats: any[] = [];
            let allDestinations: any[] = [];

            if (queues.length > 0) {
                // Fetch stats for all queues
                const queueIds = queues.map((queue: any) => queue.queueId || queue.id).join(',');
                console.log(`AnypointMQ Stats: Queue IDs for stats: ${queueIds}`);

                const queueStatsUrl = `${mqStatsBase}/organizations/${organizationID}/environments/${environmentId}/regions/${selectedRegionId}/queues?destinationIds=${queueIds}`;

                console.log(`AnypointMQ Stats: Fetching queue stats from ${queueStatsUrl}`);
                const queueStatsResponse = await apiHelper.get(queueStatsUrl);

                console.log(`AnypointMQ Stats: Queue stats response:`, JSON.stringify(queueStatsResponse.data, null, 2));

                const queueStats = Array.isArray(queueStatsResponse.data) ? queueStatsResponse.data : [queueStatsResponse.data];
                allStats = allStats.concat(queueStats);
                allDestinations = allDestinations.concat(queues.map(q => ({ ...q, destinationType: 'queue' })));
            }

            if (exchanges.length > 0) {
                // Try to fetch stats for all exchanges
                // Note: Exchange stats API may not be available in all environments
                const exchangeIds = exchanges.map((exchange: any) => exchange.exchangeId || exchange.id).join(',');
                console.log(`AnypointMQ Stats: Exchange IDs for stats: ${exchangeIds}`);

                try {
                    const exchangeStatsUrl = `${mqStatsBase}/organizations/${organizationID}/environments/${environmentId}/regions/${selectedRegionId}/exchanges?destinationIds=${exchangeIds}`;

                    console.log(`AnypointMQ Stats: Fetching exchange stats from ${exchangeStatsUrl}`);
                    const exchangeStatsResponse = await apiHelper.get(exchangeStatsUrl);

                    console.log(`AnypointMQ Stats: Exchange stats response:`, JSON.stringify(exchangeStatsResponse.data, null, 2));

                    const exchangeStats = Array.isArray(exchangeStatsResponse.data) ? exchangeStatsResponse.data : [exchangeStatsResponse.data];
                    allStats = allStats.concat(exchangeStats);
                    allDestinations = allDestinations.concat(exchanges.map(e => ({ ...e, destinationType: 'exchange' })));

                    console.log(`AnypointMQ Stats: ✓ Found ${exchanges.length} exchanges with stats`);
                } catch (exchangeError: any) {
                    // If exchange stats API is not available (404), add exchanges without stats
                    if (exchangeError.response?.status === 404) {
                        console.log(`AnypointMQ Stats: ⚠️  Exchange stats API not available, showing exchanges without stats`);
                        // Add exchanges with empty stats
                        const emptyStats = exchanges.map((exchange: any) => ({
                            destination: exchange.exchangeId || exchange.id,
                            messages: 0,
                            inflightMessages: 0
                        }));
                        allStats = allStats.concat(emptyStats);
                        allDestinations = allDestinations.concat(exchanges.map(e => ({ ...e, destinationType: 'exchange' })));
                        console.log(`AnypointMQ Stats: ✓ Found ${exchanges.length} exchanges (without stats)`);
                    } else {
                        console.log(`AnypointMQ Stats: ✗ Error fetching exchange stats:`, exchangeError.message);
                        throw exchangeError;
                    }
                }
            }

            const statsData = {
                allRegions: false,
                queues: allDestinations, // Using 'queues' for backward compatibility but contains both
                stats: allStats,
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
    const { RegionService } = await import('./regionService.js');
    const accountService = new AccountService(context);
    const regionService = new RegionService(context);

    let accessToken: string | undefined;
    let baseUrl: string;

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

        // For new accounts, get the base URL from the temp region
        const tempRegionId = await context.secrets.get('anypoint.tempRegionId');
        baseUrl = tempRegionId ? regionService.getBaseUrlForRegion(tempRegionId) : BASE_URL;
        console.log(`getUserInfo: Using base URL for new account (region: ${tempRegionId || 'us'}): ${baseUrl}`);
    } else {
        accessToken = await accountService.getActiveAccountAccessToken();
        if (!accessToken) {
            accessToken = await context.secrets.get('anypoint.accessToken');
        }
        if (!accessToken) {
            throw new Error('No access token found. Please log in first.');
        }

        // For existing accounts, get the base URL from the active account's region
        baseUrl = await getBaseUrl(context);
        console.log(`getUserInfo: Using base URL for existing account: ${baseUrl}`);
    }

    const apiUrl = baseUrl + '/accounts/api/me';

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
            const tempRegionId = await context.secrets.get('anypoint.tempRegionId');

            if (tempAccessToken) {
                await accountService.setAccountData(accountId, 'accessToken', tempAccessToken);
                await context.secrets.delete('anypoint.tempAccessToken');
            }
            if (tempRefreshToken) {
                await accountService.setAccountData(accountId, 'refreshToken', tempRefreshToken);
                await context.secrets.delete('anypoint.tempRefreshToken');
            }

            await accountService.setAccountData(accountId, 'userInfo', JSON.stringify(userInfo));

            // Store region for the new account
            if (tempRegionId) {
                await accountService.setAccountData(accountId, 'region', tempRegionId);
                await context.secrets.delete('anypoint.tempRegionId');
                console.log(`Region ${tempRegionId} stored for new account ${accountId}`);
            }

            const account = {
                id: accountId,
                organizationId: orgId,
                organizationName: userInfo.organization.name || 'Unknown Organization',
                userEmail: userInfo.email || 'unknown@email.com',
                userName: userInfo.username || userInfo.firstName + ' ' + userInfo.lastName || 'Unknown User',
                isActive: true, // Set as active when adding new account
                lastUsed: new Date().toISOString(),
                status: 'authenticated' as const,
                region: tempRegionId || 'us' // Store region in account object
            };

            await accountService.addAccount(account);
            await accountService.setActiveAccount(accountId); // Explicitly set as active account
            // Don't delete tempUserInfo yet - getEnvironments needs it
            console.log(`New account ${accountId} added and set as active`);

            // Check if user should be prompted to select a business group
            const { BusinessGroupService } = await import('./businessGroupService.js');
            const businessGroupService = new BusinessGroupService(context);
            // Prompt asynchronously without blocking login flow
            setTimeout(async () => {
                try {
                    await businessGroupService.promptForBusinessGroupSelection(accountId);
                } catch (error) {
                    console.error('Error prompting for business group selection:', error);
                }
            }, 1000); // 1 second delay to let environments load

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

    const baseUrl = await getBaseUrl(context);
    const apiUrl = baseUrl + '/cloudhub/api/organization';

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
    const { RegionService } = await import('./regionService.js');
    const accountService = new AccountService(context);
    const regionService = new RegionService(context);

    let userInfo: string | undefined;
    let organizationID: string;
    let baseUrl: string;

    if (isNewAccount) {
        userInfo = await context.secrets.get('anypoint.tempUserInfo');
        if (!userInfo) {
            throw new Error('No temporary user info found. Please try logging in again.');
        }
        organizationID = JSON.parse(userInfo).organization.id;

        // For new accounts, get the base URL from the temp region
        const tempRegionId = await context.secrets.get('anypoint.tempRegionId');
        baseUrl = tempRegionId ? regionService.getBaseUrlForRegion(tempRegionId) : BASE_URL;
    } else {
        const activeAccount = await accountService.getActiveAccount();
        if (!activeAccount) {
            throw new Error('No active account found. Please log in first.');
        }
        // Use effective organization ID (business group ID if selected, otherwise root org ID)
        const effectiveOrgId = await accountService.getEffectiveOrganizationId();
        organizationID = effectiveOrgId || activeAccount.organizationId;

        // For existing accounts, get the base URL from the active account's region
        baseUrl = await getBaseUrl(context);
    }

    const apiUrl = baseUrl + '/accounts/api/organizations/' + organizationID + '/environments';

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
                    console.log(`Stored ${response.data?.data?.length || 0} environments for new account ${account.userName}`);
                }
            }

            // Clean up temp data
            await context.secrets.delete('anypoint.tempEnvironments');
            await context.secrets.delete('anypoint.tempUserInfo');
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

    const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
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

    // Get region to determine which API to use
    const regionId = activeAccount.region || 'us';
    const baseUrl = await getBaseUrl(context);

    // US region uses Application Manager API (original working endpoint)
    // EU/GOV use ARM API (unified endpoint)
    let apiUrl: string;
    let requestConfig: any = {};

    if (regionId === 'us') {
        apiUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${environmentId}/deployments`;
        console.log(`CloudHub 2.0: Using Application Manager API for US region`);
    } else {
        apiUrl = `${baseUrl}/armui/api/v2/applications`;
        console.log(`CloudHub 2.0: Using ARM API for ${regionId.toUpperCase()} region`);

        // ARM API requires org and env as headers instead of URL path
        requestConfig.headers = {
            'X-Anypnt-Org-Id': organizationID,
            'X-Anypnt-Env-Id': environmentId
        };
        console.log(`CloudHub 2.0: Adding ARM API headers - Org: ${organizationID}, Env: ${environmentId}`);
    }

    try {
        console.log(`CloudHub 2.0: Making API call to ${apiUrl}`);
        const apiHelper = new ApiHelper(context);
        const response = await apiHelper.get(apiUrl, requestConfig);

        console.log(`CloudHub 2.0: API response status: ${response.status}`);
        console.log(`CloudHub 2.0: Response data structure:`, Object.keys(response.data || {}));
        console.log(`CloudHub 2.0: Full response data:`, JSON.stringify(response.data, null, 2));

        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = response.data;
        let transformedData;

        // Different response formats for different APIs
        if (regionId === 'us') {
            // Application Manager API returns different format
            transformedData = data;
        } else {
            // ARM API returns: { data: [...], total: N, error: [...] }
            // Filter for CloudHub 2.0 apps only (target.type === "MC" and target.subtype === "shared-space")
            let allApps = data.data || [];
            const ch2Apps = allApps.filter((app: any) =>
                app.target?.type === 'MC' &&
                app.target?.subtype === 'shared-space'
            );

            console.log(`CloudHub 2.0: Found ${ch2Apps.length} CloudHub 2.0 applications in environment ${environmentName} (out of ${allApps.length} total apps)`);

            // Transform ARM API format to match Application Manager API format
            const normalizedApps = ch2Apps.map((app: any) => ({
                id: app.id,
                deploymentId: app.id,
                name: app.artifact?.name || 'Unknown',
                domain: app.artifact?.name || 'Unknown',
                creationDate: app.artifact?.createTime ? new Date(app.artifact.createTime).toISOString() : undefined,
                lastModifiedDate: app.artifact?.lastUpdateTime ? new Date(app.artifact.lastUpdateTime).toISOString() : undefined,
                currentRuntimeVersion: app.muleVersion?.version || 'N/A',
                lastSuccessfulRuntimeVersion: app.muleVersion?.version || 'N/A',
                muleVersion: app.muleVersion?.version || 'N/A',  // Command Center checks for this first
                region: app.target?.name || app.target?.provider || 'Unknown',  // Region info from target
                application: {
                    status: app.application?.status || app.lastReportedStatus || 'UNKNOWN',
                    domain: app.artifact?.name || 'Unknown'
                },
                target: app.target,
                // Keep original data for reference
                _originalArmData: app
            }));

            console.log(`CloudHub 2.0: Transformed ${normalizedApps.length} apps from ARM API format`);

            transformedData = {
                data: normalizedApps,
                total: normalizedApps.length
            };
        }

        // FIXED: Pass environment name for display, but ID is stored in secrets
        showApplicationsWebview(context, transformedData, environmentName);
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

    const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
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

    // Use region-specific base URL
    const baseUrl = await getBaseUrl(context);
    const apiUrl = baseUrl + '/cloudhub/api/applications';

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
        
        const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
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

    const organizationID = await getEffectiveOrganizationId(context, activeAccount.organizationId);
    const environments = JSON.parse(storedEnvironments);
    const apiHelper = new ApiHelper(context);

    // Get region-specific base URL
    const baseUrl = await getBaseUrl(context);
    console.log(`Environment Comparison: Using base URL ${baseUrl}`);

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
            const ch1Response = await apiHelper.get(baseUrl + '/cloudhub/api/applications', {
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
            const ch2Response = await apiHelper.get(baseUrl + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + env.id + '/deployments');

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
