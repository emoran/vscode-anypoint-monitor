import * as vscode from 'vscode';
import axios from 'axios';
import { BASE_URL } from '../constants';
import { refreshAccessToken } from '../controllers/oauthService';

interface APIInfo {
    environment: string;
    environment_id: string;
    api_id: string;
    api_name: string;
    api_version: string;
    total_policies: number;
    active_policies: number;
    policies: any[];
    all_policies_with_status: any[];
    api_details: any;
}

interface PolicyStatus {
    apis_with_policies: APIInfo[];
    apis_without_policies: APIInfo[];
}

export async function auditAPIs(context: vscode.ExtensionContext, environmentId: string): Promise<void> {
    let accessToken = await context.secrets.get('anypoint.accessToken');
    const userInfo = await context.secrets.get('anypoint.userInfo');

    if (!userInfo) {
        throw new Error('User info not found. Please log in first.');
    }
    const organizationID = JSON.parse(userInfo).organization.id;

    if (!accessToken) {
        throw new Error('No access token found. Please log in first.');
    }

    try {
        vscode.window.showInformationMessage('Starting API audit...', { modal: false });
        
        const policyStatus = await analyzeAPIs(accessToken, organizationID, environmentId);
        await showAPIAuditWebview(context, policyStatus, environmentId);
        
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
                const policyStatus = await analyzeAPIs(accessToken, organizationID, environmentId);
                await showAPIAuditWebview(context, policyStatus, environmentId);
            } catch (retryError: any) {
                vscode.window.showErrorMessage(`API audit failed after refresh: ${retryError.message}`);
            }
        } else {
            vscode.window.showErrorMessage(`API audit failed: ${error.message}`);
        }
    }
}

async function analyzeAPIs(accessToken: string, organizationID: string, environmentId: string): Promise<PolicyStatus> {
    const apis = await getAPIsInEnvironment(accessToken, organizationID, environmentId);
    
    const apisWithPolicies: APIInfo[] = [];
    const apisWithoutPolicies: APIInfo[] = [];

    for (const api of apis) {
        const apiId = api.id;
        const apiName = api.instanceLabel || api.assetId || api.name || 'Unknown';
        const apiVersion = api.assetVersion || api.version || 'Unknown';
        
        const policies = await getAPIPolicies(accessToken, organizationID, environmentId, api);
        
        // Filter active policies
        const activePolicies = policies.filter(policy => {
            const isEnabled = (
                policy.disabled === false ||
                policy.enabled === true ||
                policy.status === 'enabled' ||
                policy.status === 'active' ||
                policy.state === 'enabled' ||
                policy.state === 'active' ||
                (policy.disabled === undefined && policy.enabled === undefined)
            );
            return isEnabled;
        });

        const apiInfo: APIInfo = {
            environment: 'Current Environment', // Will be replaced with actual environment name
            environment_id: environmentId,
            api_id: apiId,
            api_name: apiName,
            api_version: apiVersion,
            total_policies: policies.length,
            active_policies: activePolicies.length,
            policies: activePolicies,
            all_policies_with_status: policies,
            api_details: api
        };

        if (activePolicies.length > 0) {
            apisWithPolicies.push(apiInfo);
        } else {
            apisWithoutPolicies.push(apiInfo);
        }
    }

    return {
        apis_with_policies: apisWithPolicies,
        apis_without_policies: apisWithoutPolicies
    };
}

async function getAPIsInEnvironment(accessToken: string, organizationID: string, environmentId: string): Promise<any[]> {
    const endpoints = [
        `${BASE_URL}/apimanager/api/v1/organizations/${organizationID}/environments/${environmentId}/apis`,
        `${BASE_URL}/apimanager/api/v2/organizations/${organizationID}/environments/${environmentId}/apis`
    ];

    for (const apiUrl of endpoints) {
        try {
            const response = await axios.get(apiUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 200) {
                let apis = response.data;

                if (typeof apis === 'object' && !Array.isArray(apis)) {
                    apis = apis.assets || apis.apis || [];
                }

                // Flatten nested API structures (handle grouped APIs)
                const flattenedApis: any[] = [];
                for (const api of apis) {
                    if (api.apis && Array.isArray(api.apis)) {
                        // Grouped API
                        for (const subApi of api.apis) {
                            const enhancedSubApi = { ...subApi };
                            enhancedSubApi.parentAssetId = api.assetId;
                            enhancedSubApi.parentGroupId = api.groupId;
                            enhancedSubApi.parentName = api.name;
                            flattenedApis.push(enhancedSubApi);
                        }
                    } else {
                        flattenedApis.push(api);
                    }
                }

                return flattenedApis;
            }
        } catch (error: any) {
            // Try next endpoint
            continue;
        }
    }

    throw new Error('Failed to retrieve APIs from all endpoints');
}

async function getAPIPolicies(accessToken: string, organizationID: string, environmentId: string, apiData: any): Promise<any[]> {
    const possibleIds = [
        apiData.id,
        apiData.environmentApiId,
        apiData.apiId,
        apiData.instanceId,
        apiData.autodiscoveryApiId
    ].filter(id => id !== undefined && id !== null);

    const endpointTemplates = [
        `${BASE_URL}/apimanager/api/v1/organizations/${organizationID}/environments/${environmentId}/apis/{api_id}/policies`,
        `${BASE_URL}/apimanager/api/v2/organizations/${organizationID}/environments/${environmentId}/apis/{api_id}/policies`
    ];

    for (const apiId of possibleIds) {
        for (const template of endpointTemplates) {
            const policiesUrl = template.replace('{api_id}', apiId.toString());

            try {
                const response = await axios.get(policiesUrl, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.status === 200) {
                    let policies = response.data;

                    if (typeof policies === 'object' && !Array.isArray(policies)) {
                        policies = policies.policies || policies.data || policies.assets || [];
                    }

                    if (Array.isArray(policies)) {
                        return policies;
                    }
                }
            } catch (error: any) {
                // Try next combination
                continue;
            }
        }
    }

    return []; // No policies found
}

async function showAPIAuditWebview(context: vscode.ExtensionContext, policyStatus: PolicyStatus, environmentId: string): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'apiAuditWebview',
        'API Audit Results',
        vscode.ViewColumn.One,
        { 
            enableScripts: true,
            retainContextWhenHidden: true 
        }
    );

    // Get environment name
    const storedEnvironments = await context.secrets.get('anypoint.environments');
    let environmentName = 'Unknown Environment';
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

    panel.webview.html = getAPIAuditWebviewContent(policyStatus, environmentName);
}

function getAPIAuditWebviewContent(policyStatus: PolicyStatus, environmentName: string): string {
    const totalApis = policyStatus.apis_with_policies.length + policyStatus.apis_without_policies.length;
    const policycoverage = totalApis > 0 ? ((policyStatus.apis_with_policies.length / totalApis) * 100).toFixed(1) : '0.0';

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>API Audit Results</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Open Sans', 'Helvetica Neue', sans-serif;
                padding: 20px;
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            .header {
                border-bottom: 1px solid var(--vscode-panel-border);
                padding-bottom: 20px;
                margin-bottom: 30px;
            }
            .header h1 {
                margin: 0 0 10px 0;
                color: var(--vscode-foreground);
            }
            .header .subtitle {
                color: var(--vscode-descriptionForeground);
                font-size: 14px;
            }
            .summary {
                background: var(--vscode-editor-inactiveSelectionBackground);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                padding: 20px;
                margin-bottom: 30px;
            }
            .summary-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
            }
            .summary-item {
                text-align: center;
            }
            .summary-item .number {
                font-size: 32px;
                font-weight: bold;
                color: var(--vscode-textLink-foreground);
            }
            .summary-item .label {
                color: var(--vscode-descriptionForeground);
                font-size: 14px;
            }
            .section {
                margin-bottom: 40px;
            }
            .section h2 {
                margin: 0 0 15px 0;
                color: var(--vscode-foreground);
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .section-icon {
                font-size: 20px;
            }
            .table-container {
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                overflow: hidden;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                background: var(--vscode-editor-background);
            }
            th {
                background: var(--vscode-editor-inactiveSelectionBackground);
                color: var(--vscode-foreground);
                font-weight: 600;
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            td {
                padding: 12px;
                border-bottom: 1px solid var(--vscode-panel-border);
                color: var(--vscode-editor-foreground);
            }
            tr:last-child td {
                border-bottom: none;
            }
            tr:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .status-with-policies {
                color: #4CAF50;
                font-weight: 600;
            }
            .status-without-policies {
                color: #FF9800;
                font-weight: 600;
            }
            .status-disabled {
                color: #F44336;
                font-weight: 600;
            }
            .policy-count {
                background: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: bold;
            }
            .no-data {
                text-align: center;
                padding: 40px;
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }
            .expandable {
                cursor: pointer;
                user-select: none;
            }
            .policy-details {
                display: none;
                background: var(--vscode-editor-inactiveSelectionBackground);
                padding: 10px;
                margin-top: 5px;
                border-radius: 4px;
                font-size: 12px;
            }
            .policy-item {
                margin-bottom: 8px;
                padding: 5px;
                background: var(--vscode-editor-background);
                border-radius: 3px;
            }
        </style>
        <script>
            function togglePolicyDetails(element) {
                const details = element.nextElementSibling;
                if (details && details.classList.contains('policy-details')) {
                    details.style.display = details.style.display === 'none' ? 'block' : 'none';
                    const arrow = element.querySelector('.arrow');
                    if (arrow) {
                        arrow.textContent = details.style.display === 'none' ? '▶' : '▼';
                    }
                }
            }
        </script>
    </head>
    <body>
        <div class="header">
            <h1>🔍 API Audit Results</h1>
            <div class="subtitle">Environment: ${environmentName}</div>
        </div>

        <div class="summary">
            <div class="summary-grid">
                <div class="summary-item">
                    <div class="number">${totalApis}</div>
                    <div class="label">Total APIs</div>
                </div>
                <div class="summary-item">
                    <div class="number">${policyStatus.apis_with_policies.length}</div>
                    <div class="label">APIs with Policies</div>
                </div>
                <div class="summary-item">
                    <div class="number">${policyStatus.apis_without_policies.length}</div>
                    <div class="label">APIs without Active Policies</div>
                </div>
                <div class="summary-item">
                    <div class="number">${policycoverage}%</div>
                    <div class="label">Policy Coverage</div>
                </div>
            </div>
        </div>

        ${policyStatus.apis_with_policies.length > 0 ? `
        <div class="section">
            <h2><span class="section-icon">✅</span> APIs with Active Policies (${policyStatus.apis_with_policies.length})</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>API Name</th>
                            <th>Version</th>
                            <th>Active Policies</th>
                            <th>Total Policies</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${policyStatus.apis_with_policies.map(api => `
                            <tr>
                                <td>${api.api_name}</td>
                                <td>${api.api_version}</td>
                                <td><span class="policy-count">${api.active_policies}</span></td>
                                <td>${api.total_policies}</td>
                                <td><span class="status-with-policies">Protected</span></td>
                            </tr>
                            ${api.policies.length > 0 ? `
                            <tr>
                                <td colspan="5">
                                    <div class="expandable" onclick="togglePolicyDetails(this)">
                                        <span class="arrow">▶</span> Policy Details
                                    </div>
                                    <div class="policy-details">
                                        ${api.policies.map(policy => {
                                            const policyName = policy.template?.assetId || policy.policyTemplate?.name || policy.name || 'Unknown Policy';
                                            const policyVersion = policy.template?.assetVersion || 'Unknown';
                                            return `<div class="policy-item">${policyName} (v${policyVersion})</div>`;
                                        }).join('')}
                                    </div>
                                </td>
                            </tr>
                            ` : ''}
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${policyStatus.apis_without_policies.length > 0 ? `
        <div class="section">
            <h2><span class="section-icon">⚠️</span> APIs without Active Policies (${policyStatus.apis_without_policies.length})</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>API Name</th>
                            <th>Version</th>
                            <th>Total Policies</th>
                            <th>Status</th>
                            <th>Issue</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${policyStatus.apis_without_policies.map(api => `
                            <tr>
                                <td>${api.api_name}</td>
                                <td>${api.api_version}</td>
                                <td>${api.total_policies}</td>
                                <td>
                                    ${api.total_policies > 0 ? 
                                        '<span class="status-disabled">Policies Disabled</span>' : 
                                        '<span class="status-without-policies">No Policies</span>'
                                    }
                                </td>
                                <td>
                                    ${api.total_policies > 0 ? 
                                        `${api.total_policies} inactive policies found` : 
                                        'No policies configured'
                                    }
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${totalApis === 0 ? `
        <div class="no-data">
            No APIs found in this environment.
        </div>
        ` : ''}
    </body>
    </html>`;
}