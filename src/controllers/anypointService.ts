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
    let schedules: any = null;
    try {
        const detailsResponse = await axios.get(schedulesURL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-ANYPNT-ENV-ID': selectedEnvironmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });
        if (detailsResponse.status !== 200) {
            throw new Error(`Application details request failed with status ${detailsResponse.status}`);
        }
        schedules = detailsResponse.data;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error fetching application schedule details: ${error.message}`);
        return;
    }

    const deploymentsURL = BASE_URL + `/cloudhub/api/v2/applications/${selectedAppDomain}/deployments?orderByDate=DESC`;
    let deploymentId: any = null;
    let instanceId: any = null;
    try {
        const detailsResponseDeployments = await axios.get(deploymentsURL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-ANYPNT-ENV-ID': selectedEnvironmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });
        if (detailsResponseDeployments.status !== 200) {
            throw new Error(`Application details request failed with status ${detailsResponseDeployments.status}`);
        }
        deploymentId = detailsResponseDeployments.data.data[0].deploymentId;
        instanceId = detailsResponseDeployments.data.data[0].instances[0].instanceId;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error fetching application schedule details: ${error.message}`);
        return;
    }

    const logsURL = BASE_URL + `/cloudhub/api/v2/applications/${selectedAppDomain}/deployments/${deploymentId}/logs?limit=10000`;
    let logs: any = null;
    try {
        const detailsResponseLogs = await axios.get(logsURL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-ANYPNT-ENV-ID': selectedEnvironmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            },
        });
        if (detailsResponseLogs.status !== 200) {
            throw new Error(`Application details request failed with status ${detailsResponseLogs.status}`);
        }
        logs = detailsResponseLogs.data;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error fetching application schedule details: ${error.message}`);
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

    const apiUrl = BASE_URL + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + environmentId + '/deployments';

    try {
        const response = await axios.get(apiUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const data = response.data;
        showApplicationsWebview(context, data, environmentId);
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
                showApplicationsWebview(context, data, environmentId);
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

