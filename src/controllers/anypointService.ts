import * as vscode from 'vscode';
import axios from 'axios';
import { BASE_URL } from '../constants';
import { refreshAccessToken } from './oauthService';
import { showApplicationsWebview } from '../anypoint/cloudhub2Applications';
import { showApplicationsWebview1 } from '../anypoint/cloudhub1Applications';
import { showDashboardWebview } from '../anypoint/ApplicationDetails';
import { getUserInfoWebviewContent } from '../anypoint/userInfoContent';
import { getOrgInfoWebviewContent } from '../anypoint/organizationInfo';
import { showEnvironmentAndOrgPanel } from '../anypoint/DeveloperInfo';
import { showAPIManagerWebview } from '../anypoint/apiMananagerAPIs';
import { showEnvironmentComparisonWebview } from '../anypoint/environmentComparison';

export async function retrieveApplications(context: vscode.ExtensionContext, selectedEnvironmentId: string) {
    let accessToken = await context.secrets.get('anypoint.accessToken');
    const userInfoStr = await context.secrets.get('anypoint.userInfo');

    if (!accessToken || !userInfoStr) {
        vscode.window.showErrorMessage('No access token or user info found. Please log in first.');
        return;
    }

    const userInfoData = JSON.parse(userInfoStr);
    const organizationID = userInfoData.organization.id;

    const appsUrl = BASE_URL + '/cloudhub/api/applications';
    let appsList: any[] = [];
    try {
        const response = await axios.get(appsUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-ANYPNT-ENV-ID': selectedEnvironmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });
        if (response.status !== 200) {
            throw new Error(`Applications request failed with status ${response.status}`);
        }
        appsList = response.data;
    } catch (error: any) {
        if (error.response?.status === 401) {
            vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
            const didRefresh = await refreshAccessToken(context);
            if (!didRefresh) {
                vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
                return;
            }
            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                vscode.window.showErrorMessage('No access token found after refresh. Please log in again.');
                return;
            }
            try {
                const retryResp = await axios.get(appsUrl, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'X-ANYPNT-ENV-ID': selectedEnvironmentId,
                        'X-ANYPNT-ORG-ID': organizationID,
                    },
                });
                if (retryResp.status !== 200) {
                    throw new Error(`Applications request failed (retry) with status ${retryResp.status}`);
                }
                appsList = retryResp.data;
            } catch (retryErr: any) {
                vscode.window.showErrorMessage(`Retry after refresh failed: ${retryErr.message}`);
                return;
            }
        } else {
            vscode.window.showErrorMessage(`Error fetching environment apps: ${error.message}`);
            return;
        }
    }

    if (!Array.isArray(appsList) || appsList.length === 0) {
        vscode.window.showErrorMessage('No applications found in this environment.');
        return;
    }

    const applicationOptions = appsList.map(app => ({
        label: app.domain || app.name || 'Unknown',
        domain: app.domain,
    }));

    const selectedAppLabel = await vscode.window.showQuickPick(
        applicationOptions.map(opt => opt.label),
        { placeHolder: 'Select an application' }
    );

    if (!selectedAppLabel) {
        vscode.window.showInformationMessage('No application selected.');
        return;
    }

    const selectedAppDomain = applicationOptions.find(opt => opt.label === selectedAppLabel)?.domain;
    if (!selectedAppDomain) {
        vscode.window.showErrorMessage('Failed to determine selected application domain.');
        return;
    }

    const appDetailsUrl = BASE_URL + `/cloudhub/api/applications/${selectedAppDomain}`;
    let singleAppData: any = null;
    try {
        const detailsResp = await axios.get(appDetailsUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-ANYPNT-ENV-ID': selectedEnvironmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });
        if (detailsResp.status !== 200) {
            throw new Error(`Application details request failed with status ${detailsResp.status}`);
        }
        singleAppData = detailsResp.data;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error fetching application details: ${error.message}`);
        return;
    }

    const schedulesURL = BASE_URL + `/cloudhub/api/applications/${selectedAppDomain}/schedules`;
    const deploymentsURL = BASE_URL + `/cloudhub/api/v2/applications/${selectedAppDomain}/deployments?orderByDate=DESC`;
    
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-ANYPNT-ENV-ID': selectedEnvironmentId,
        'X-ANYPNT-ORG-ID': organizationID,
    };

    let schedules: any = null;
    let deploymentId: any = null;
    let instanceId: any = null;
    let logs: any = null;

    try {
        const [schedulesResponse, deploymentsResponse] = await Promise.all([
            axios.get(schedulesURL, { headers }),
            axios.get(deploymentsURL, { headers })
        ]);

        if (schedulesResponse.status !== 200) {
            throw new Error(`Schedules request failed with status ${schedulesResponse.status}`);
        }
        if (deploymentsResponse.status !== 200) {
            throw new Error(`Deployments request failed with status ${deploymentsResponse.status}`);
        }

        schedules = schedulesResponse.data;
        deploymentId = deploymentsResponse.data.data[0].deploymentId;
        instanceId = deploymentsResponse.data.data[0].instances[0].instanceId;

        const logsURL = BASE_URL + `/cloudhub/api/v2/applications/${selectedAppDomain}/deployments/${deploymentId}/logs?limit=10000`;
        const logsResponse = await axios.get(logsURL, { headers });
        
        if (logsResponse.status !== 200) {
            throw new Error(`Logs request failed with status ${logsResponse.status}`);
        }
        logs = logsResponse.data;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error fetching application details: ${error.message}`);
        return;
    }

    const dashboardData = {
        application: singleAppData,
        schedulers: schedules,
        alerts: [],
        analytics: [],
        logs: logs,
    };

    showDashboardWebview(context, singleAppData.domain, dashboardData, selectedEnvironmentId);
}

export async function getUserInfo(context: vscode.ExtensionContext) {
    let accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
        throw new Error('No access token found. Please log in first.');
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
        await context.secrets.store('anypoint.userInfo', JSON.stringify(data.user));

        const panel = vscode.window.createWebviewPanel(
            'userInfoWebview',
            'User Information',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getUserInfoWebviewContent(data, panel.webview, context.extensionUri);
    } catch (error: any) {
        if (error.response?.status === 401) {
            vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
            const didRefresh = await refreshAccessToken(context);
            if (!didRefresh) {
                vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
                return;
            }
            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
                return;
            }
            try {
                const retryResponse = await axios.get(apiUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (retryResponse.status !== 200) {
                    throw new Error(`Retry API request failed with status ${retryResponse.status}`);
                }
                const data = retryResponse.data;
                const panel = vscode.window.createWebviewPanel(
                    'userInfoWebview',
                    'User Information',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );
                panel.webview.html = getUserInfoWebviewContent(data, panel.webview, context.extensionUri);
            } catch (retryError: any) {
                vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
            }
        } else {
            vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
        }
    }
}

export async function getOrganizationInfo(context: vscode.ExtensionContext) {
    let accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
        throw new Error('No access token found. Please log in first.');
    }

    const apiUrl = BASE_URL + '/cloudhub/api/organization';

    try {
        const response = await axios.get(apiUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const data = response.data;
        const panel = vscode.window.createWebviewPanel(
            'orgInfoWebview',
            'Organization Details',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getOrgInfoWebviewContent(data, panel.webview, context.extensionUri);
    } catch (error: any) {
        if (error.response?.status === 401) {
            vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
            const didRefresh = await refreshAccessToken(context);
            if (!didRefresh) {
                vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
                return;
            }
            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
                return;
            }
            try {
                const retryResponse = await axios.get(apiUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (retryResponse.status !== 200) {
                    throw new Error(`Retry API request failed with status ${retryResponse.status}`);
                }
                const data = retryResponse.data;
                const panel = vscode.window.createWebviewPanel(
                    'orgInfoWebview',
                    'Organization Details',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );
                panel.webview.html = getOrgInfoWebviewContent(data, panel.webview, context.extensionUri);
            } catch (retryError: any) {
                vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
            }
        } else {
            vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
        }
    }
}

export async function developerInfo(context: vscode.ExtensionContext) {
    const storedUserInfo = await context.secrets.get('anypoint.userInfo');
    const storedEnvironments = await context.secrets.get('anypoint.environments');

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

export async function getEnvironments(context: vscode.ExtensionContext) {
    let accessToken = await context.secrets.get('anypoint.accessToken');
    const userInfo = await context.secrets.get('anypoint.userInfo');

    if (!userInfo) {
        throw new Error('User info not found. Please log in first.');
    }
    const organizationID = JSON.parse(userInfo).organization.id;

    if (!accessToken) {
        throw new Error('No access token found. Please log in first.');
    }

    const apiUrl = BASE_URL + '/accounts/api/organizations/' + organizationID + '/environments';

    try {
        const response = await axios.get(apiUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        await context.secrets.store('anypoint.environments', JSON.stringify(response.data));
        vscode.window.showInformationMessage('environment saved');
    } catch (error: any) {
        if (error.response?.status === 401) {
            vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
            const didRefresh = await refreshAccessToken(context);
            if (!didRefresh) {
                vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
                return;
            }
            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
                return;
            }
            try {
                const retryResponse = await axios.get(apiUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (retryResponse.status !== 200) {
                    throw new Error(`Retry API request failed with status ${retryResponse.status}`);
                }
                const data = retryResponse.data;
                vscode.window.showInformationMessage('environment saved');
                vscode.window.showInformationMessage(`API response (after refresh): ${JSON.stringify(data)}`);
            } catch (retryError: any) {
                vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
            }
        } else {
            vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
        }
    }
}

export async function getCH2Applications(context: vscode.ExtensionContext, environmentId: string) {
    let accessToken = await context.secrets.get('anypoint.accessToken');
    const userInfo = await context.secrets.get('anypoint.userInfo');

    if (!userInfo) {
        throw new Error('User info not found. Please log in first.');
    }
    const organizationID = JSON.parse(userInfo).organization.id;

    if (!accessToken) {
        throw new Error('No access token found. Please log in first.');
    }

    // FIXED: Store the selected environment ID and get environment name
    const storedEnvironments = await context.secrets.get('anypoint.environments');
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
        const response = await axios.get(apiUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const data = response.data;
        
        // FIXED: Pass environment name for display, but ID is stored in secrets
        showApplicationsWebview(context, data, environmentName);
    } catch (error: any) {
        if (error.response?.status === 401) {
            vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
            const didRefresh = await refreshAccessToken(context);
            if (!didRefresh) {
                vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
                return;
            }
            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
                return;
            }
            try {
                const retryResponse = await axios.get(apiUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (retryResponse.status !== 200) {
                    throw new Error(`Retry API request failed with status ${retryResponse.status}`);
                }
                const data = retryResponse.data;
                showApplicationsWebview(context, data, environmentName);
            } catch (retryError: any) {
                vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
            }
        } else {
            vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
        }
    }
}

export async function getCH1Applications(context: vscode.ExtensionContext, environmentId: string) {
    let accessToken = await context.secrets.get('anypoint.accessToken');
    const userInfo = await context.secrets.get('anypoint.userInfo');

    if (!userInfo) {
        throw new Error('User info not found. Please log in first.');
    }
    const organizationID = JSON.parse(userInfo).organization.id;

    if (!accessToken) {
        throw new Error('No access token found. Please log in first.');
    }

    const apiUrl = BASE_URL + '/cloudhub/api/applications';

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const data = response.data;
        showApplicationsWebview1(context, data);
    } catch (error: any) {
        if (error.response?.status === 401) {
            vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
            const didRefresh = await refreshAccessToken(context);
            if (!didRefresh) {
                vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
                return;
            }
            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
                return;
            }
            try {
                const retryResponse = await axios.get(apiUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (retryResponse.status !== 200) {
                    throw new Error(`Retry API request failed with status ${retryResponse.status}`);
                }
                const data = retryResponse.data;
                showApplicationsWebview1(context, data);
                vscode.window.showInformationMessage(`API response (after refresh): ${JSON.stringify(data)}`);
            } catch (retryError: any) {
                vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
            }
        } else if (error.response?.status === 403) {
            vscode.window.showErrorMessage(`Error calling API: ${error.message}` + ' Check CloudHub 1.0 Entitlement / Permissions');
        } else {
            vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
        }
    }
}

export async function retrieveAPIManagerAPIs(context: vscode.ExtensionContext) {
    const storedEnvironments = await context.secrets.get('anypoint.environments');
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
        const userInfo = await context.secrets.get('anypoint.userInfo');
        if (userInfo) {
            const userInfoData = JSON.parse(userInfo);
            const organizationID = userInfoData.organization.id;
            showAPIManagerWebview(context, selectedEnvironmentId, organizationID);
        }
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
    let accessToken = await context.secrets.get('anypoint.accessToken');
    const userInfo = await context.secrets.get('anypoint.userInfo');
    const storedEnvironments = await context.secrets.get('anypoint.environments');

    if (!accessToken || !userInfo || !storedEnvironments) {
        vscode.window.showErrorMessage('Missing authentication or environment data. Please log in first.');
        return;
    }

    const userInfoData = JSON.parse(userInfo);
    const organizationID = userInfoData.organization.id;
    const environments = JSON.parse(storedEnvironments);

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
            const ch1Response = await axios.get(BASE_URL + '/cloudhub/api/applications', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
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
            if (error.response?.status === 401) {
                const didRefresh = await refreshAccessToken(context);
                if (didRefresh) {
                    accessToken = await context.secrets.get('anypoint.accessToken');
                    try {
                        const ch1Response = await axios.get(BASE_URL + '/cloudhub/api/applications', {
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                                'X-ANYPNT-ENV-ID': env.id,
                                'X-ANYPNT-ORG-ID': organizationID,
                            },
                        });
                        if (ch1Response.status === 200) {
                            const ch1Apps = Array.isArray(ch1Response.data) ? ch1Response.data : [];
                            ch1Apps.forEach((app: any) => {
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
                    } catch (retryError) {
                        console.error(`Failed to fetch CH1 apps for environment ${env.name} after retry:`, retryError);
                    }
                }
            } else {
                console.error(`Failed to fetch CH1 apps for environment ${env.name}:`, error.message);
            }
        }

        try {
            // Fetch CloudHub 2.0 applications
            const ch2Response = await axios.get(BASE_URL + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + env.id + '/deployments', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

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
            if (error.response?.status === 401) {
                const didRefresh = await refreshAccessToken(context);
                if (didRefresh) {
                    accessToken = await context.secrets.get('anypoint.accessToken');
                    try {
                        const ch2Response = await axios.get(BASE_URL + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + env.id + '/deployments', {
                            headers: { Authorization: `Bearer ${accessToken}` },
                        });
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
                    } catch (retryError) {
                        console.error(`Failed to fetch CH2 apps for environment ${env.name} after retry:`, retryError);
                    }
                }
            } else {
                console.error(`Failed to fetch CH2 apps for environment ${env.name}:`, error.message);
            }
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

