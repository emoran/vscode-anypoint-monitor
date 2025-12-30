import * as secrets from '../config/secrets.json';
import * as vscode from 'vscode';

// Legacy exports for backward compatibility (uses US credentials)
export const CLIENT_ID = (secrets as any).us?.CLIENT_ID || (secrets as any).CLIENT_ID || '';
export const CLIENT_SECRET = (secrets as any).us?.CLIENT_SECRET || (secrets as any).CLIENT_SECRET || '';

/**
 * Get OAuth credentials for a specific region
 * GOV credentials can be overridden via VSCode settings
 */
export function getCredentialsForRegion(regionId: string): { clientId: string; clientSecret: string } {
    // For GOV, check VSCode settings first
    if (regionId === 'gov') {
        const config = vscode.workspace.getConfiguration('anypointMonitor');
        const govClientId = config.get<string>('gov.clientId');
        const govClientSecret = config.get<string>('gov.clientSecret');

        // If user configured GOV credentials in settings, use those
        if (govClientId && govClientSecret) {
            return { clientId: govClientId, clientSecret: govClientSecret };
        }
    }

    // Use credentials from secrets.json based on region
    const regionSecrets = (secrets as any)[regionId];
    if (regionSecrets && regionSecrets.CLIENT_ID && regionSecrets.CLIENT_SECRET) {
        return {
            clientId: regionSecrets.CLIENT_ID,
            clientSecret: regionSecrets.CLIENT_SECRET
        };
    }

    // Fallback to US credentials (legacy behavior)
    return {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
    };
}

// Default BASE_URL (US region) - used as fallback
export const BASE_URL = 'https://anypoint.mulesoft.com';
export const LOCAL_REDIRECT_URI = 'http://localhost:8082/callback';

// Legacy endpoints - kept for backward compatibility but region-specific endpoints should be used
export const AUTHORIZATION_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/authorize`;
export const TOKEN_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/token`;
export const REVOKE_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/revoke`;

/**
 * Get the base URL for the active account's region
 * Falls back to US region if no region is set
 */
export async function getBaseUrl(context: vscode.ExtensionContext): Promise<string> {
    try {
        const { AccountService } = await import('./controllers/accountService.js');
        const { RegionService } = await import('./controllers/regionService.js');

        const accountService = new AccountService(context);
        const regionService = new RegionService(context);

        const activeAccount = await accountService.getActiveAccount();
        if (activeAccount && activeAccount.region) {
            const baseUrl = regionService.getBaseUrlForRegion(activeAccount.region);
            console.log(`Using base URL for region ${activeAccount.region}: ${baseUrl}`);
            return baseUrl;
        }

        // Fallback to checking account data
        if (activeAccount) {
            const regionId = await accountService.getAccountData(activeAccount.id, 'region');
            if (regionId) {
                const baseUrl = regionService.getBaseUrlForRegion(regionId);
                console.log(`Using base URL for region ${regionId}: ${baseUrl}`);
                return baseUrl;
            }
        }

        console.log('No region found for active account, using default US base URL');
        return BASE_URL;
    } catch (error) {
        console.error('Error getting base URL for region:', error);
        return BASE_URL;
    }
}

// Legacy static endpoints (kept for backward compatibility)
// For new code, use the dynamic getter functions below
export const HYBRID_BASE = `${BASE_URL}/hybrid/api/v1`;
export const ARM_BASE = `${BASE_URL}/armui/api/v1`;
export const HYBRID_APPLICATIONS_ENDPOINT = `${HYBRID_BASE}/applications`;
export const HYBRID_SERVERS_ENDPOINT = `${HYBRID_BASE}/servers`;
export const HYBRID_SERVER_GROUPS_ENDPOINT = `${HYBRID_BASE}/serverGroups`;
export const HYBRID_CLUSTERS_ENDPOINT = `${HYBRID_BASE}/clusters`;
export const HYBRID_DEPLOYMENTS_ENDPOINT = `${HYBRID_BASE}/deployments`;
export const ANYPOINT_MQ_BASE = `${BASE_URL}/mq`;
export const ANYPOINT_MQ_ADMIN_BASE = `${BASE_URL}/mq/admin/api/v1`;
export const ANYPOINT_MQ_STATS_BASE = `${BASE_URL}/mq/stats/api/v1`;

/**
 * Get region-aware Hybrid API base URL
 */
export async function getHybridBase(context: vscode.ExtensionContext): Promise<string> {
    const baseUrl = await getBaseUrl(context);
    return `${baseUrl}/hybrid/api/v1`;
}

/**
 * Get region-aware ARM base URL
 */
export async function getArmBase(context: vscode.ExtensionContext): Promise<string> {
    const baseUrl = await getBaseUrl(context);
    return `${baseUrl}/armui/api/v1`;
}

/**
 * Get region-aware Hybrid Applications endpoint
 */
export async function getHybridApplicationsEndpoint(context: vscode.ExtensionContext): Promise<string> {
    const hybridBase = await getHybridBase(context);
    return `${hybridBase}/applications`;
}

/**
 * Get region-aware Hybrid Servers endpoint
 */
export async function getHybridServersEndpoint(context: vscode.ExtensionContext): Promise<string> {
    const hybridBase = await getHybridBase(context);
    return `${hybridBase}/servers`;
}

/**
 * Get region-aware Hybrid Server Groups endpoint
 */
export async function getHybridServerGroupsEndpoint(context: vscode.ExtensionContext): Promise<string> {
    const hybridBase = await getHybridBase(context);
    return `${hybridBase}/serverGroups`;
}

/**
 * Get region-aware Hybrid Clusters endpoint
 */
export async function getHybridClustersEndpoint(context: vscode.ExtensionContext): Promise<string> {
    const hybridBase = await getHybridBase(context);
    return `${hybridBase}/clusters`;
}

/**
 * Get region-aware Hybrid Deployments endpoint
 */
export async function getHybridDeploymentsEndpoint(context: vscode.ExtensionContext): Promise<string> {
    const hybridBase = await getHybridBase(context);
    return `${hybridBase}/deployments`;
}

/**
 * Get region-aware AnypointMQ base URL
 */
export async function getAnypointMqBase(context: vscode.ExtensionContext): Promise<string> {
    const baseUrl = await getBaseUrl(context);
    return `${baseUrl}/mq`;
}

/**
 * Get region-aware AnypointMQ Admin base URL
 */
export async function getAnypointMqAdminBase(context: vscode.ExtensionContext): Promise<string> {
    const baseUrl = await getBaseUrl(context);
    return `${baseUrl}/mq/admin/api/v1`;
}

/**
 * Get region-aware AnypointMQ Stats base URL
 */
export async function getAnypointMqStatsBase(context: vscode.ExtensionContext): Promise<string> {
    const baseUrl = await getBaseUrl(context);
    return `${baseUrl}/mq/stats/api/v1`;
}
