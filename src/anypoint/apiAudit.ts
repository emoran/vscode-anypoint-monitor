import * as vscode from 'vscode';
import { BASE_URL } from '../constants';
import { ApiHelper } from '../controllers/apiHelper.js';

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
    const userInfo = await context.secrets.get('anypoint.userInfo');

    if (!userInfo) {
        throw new Error('User info not found. Please log in first.');
    }
    const organizationID = JSON.parse(userInfo).organization.id;

    try {
        vscode.window.showInformationMessage('Starting API audit...', { modal: false });
        
        const policyStatus = await analyzeAPIs(context, organizationID, environmentId);
        await showAPIAuditWebview(context, policyStatus, environmentId);
        
    } catch (error: any) {
        vscode.window.showErrorMessage(`API audit failed: ${error.message}`);
    }
}

async function analyzeAPIs(context: vscode.ExtensionContext, organizationID: string, environmentId: string): Promise<PolicyStatus> {
    const apis = await getAPIsInEnvironment(context, organizationID, environmentId);
    
    const apisWithPolicies: APIInfo[] = [];
    const apisWithoutPolicies: APIInfo[] = [];

    for (const api of apis) {
        const apiId = api.id;
        const apiName = api.instanceLabel || api.assetId || api.name || 'Unknown';
        const apiVersion = api.assetVersion || api.version || 'Unknown';
        
        const policies = await getAPIPolicies(context, organizationID, environmentId, api);
        
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

async function getAPIsInEnvironment(context: vscode.ExtensionContext, organizationID: string, environmentId: string): Promise<any[]> {
    const endpoints = [
        `${BASE_URL}/apimanager/api/v1/organizations/${organizationID}/environments/${environmentId}/apis`,
        `${BASE_URL}/apimanager/api/v2/organizations/${organizationID}/environments/${environmentId}/apis`
    ];

    const apiHelper = new ApiHelper(context);

    for (const apiUrl of endpoints) {
        try {
            const response = await apiHelper.get(apiUrl);
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
        } catch (error: any) {
            // Try next endpoint
            continue;
        }
    }

    throw new Error('Failed to retrieve APIs from all endpoints');
}

async function getAPIPolicies(context: vscode.ExtensionContext, organizationID: string, environmentId: string, apiData: any): Promise<any[]> {
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

    const apiHelper = new ApiHelper(context);

    for (const apiId of possibleIds) {
        for (const template of endpointTemplates) {
            const policiesUrl = template.replace('{api_id}', apiId.toString());

            try {
                const response = await apiHelper.get(policiesUrl);
                let policies = response.data;

                if (typeof policies === 'object' && !Array.isArray(policies)) {
                    policies = policies.policies || policies.data || policies.assets || [];
                }

                if (Array.isArray(policies)) {
                    return policies;
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
        <title>API Audit Dashboard</title>
        <style>
            /* Code Time inspired theme */
            :root {
                --background-primary: #1e2328;
                --background-secondary: #161b22;
                --surface-primary: #21262d;
                --surface-secondary: #30363d;
                --surface-accent: #0d1117;
                --text-primary: #f0f6fc;
                --text-secondary: #7d8590;
                --text-muted: #656d76;
                --accent-blue: #58a6ff;
                --accent-light: #79c0ff;
                --border-primary: #30363d;
                --border-muted: #21262d;
                --success: #3fb950;
                --warning: #d29922;
                --error: #f85149;
            }

            * {
                box-sizing: border-box;
            }

            body {
                margin: 0;
                padding: 0;
                background-color: var(--background-primary);
                color: var(--text-primary);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
                font-size: 14px;
                line-height: 1.5;
            }

            /* Header Section */
            .header {
                background-color: var(--background-secondary);
                border-bottom: 1px solid var(--border-primary);
                padding: 24px 32px;
            }

            .header-content {
                max-width: 1200px;
                margin: 0 auto;
            }

            .header h1 {
                font-size: 28px;
                font-weight: 600;
                margin: 0 0 8px 0;
                color: var(--text-primary);
            }

            .header p {
                font-size: 16px;
                color: var(--text-secondary);
                margin: 0;
            }

            /* Main Content */
            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 32px;
            }

            /* Statistics Grid */
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 32px;
            }

            .stat-card {
                background-color: var(--surface-primary);
                border: 1px solid var(--border-primary);
                border-radius: 12px;
                padding: 24px;
                transition: all 0.2s;
            }

            .stat-card:hover {
                border-color: var(--border-muted);
                transform: translateY(-1px);
            }

            .stat-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 16px;
            }

            .stat-title {
                font-size: 14px;
                font-weight: 500;
                color: var(--text-secondary);
                margin: 0;
            }

            .stat-value {
                font-size: 32px;
                font-weight: 600;
                color: var(--text-primary);
                margin: 0 0 8px 0;
                line-height: 1.2;
            }

            .stat-subtitle {
                font-size: 13px;
                color: var(--text-muted);
                margin: 0;
            }

            /* Coverage Indicator */
            .coverage-high { color: var(--success); }
            .coverage-medium { color: var(--warning); }
            .coverage-low { color: var(--error); }

            /* Section Cards */
            .section-card {
                background-color: var(--surface-primary);
                border: 1px solid var(--border-primary);
                border-radius: 12px;
                padding: 24px;
                margin-bottom: 32px;
            }

            .section-title {
                font-size: 18px;
                font-weight: 600;
                color: var(--text-primary);
                margin: 0 0 20px 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .section-icon {
                font-size: 20px;
            }

            /* Table Styles */
            .table-wrapper {
                overflow-x: auto;
                border-radius: 8px;
                border: 1px solid var(--border-primary);
            }

            table {
                width: 100%;
                border-collapse: collapse;
                background-color: var(--surface-secondary);
            }

            th {
                background-color: var(--background-secondary);
                color: var(--text-primary);
                font-weight: 600;
                padding: 16px 12px;
                text-align: left;
                border-bottom: 1px solid var(--border-primary);
                font-size: 13px;
            }

            td {
                padding: 16px 12px;
                border-bottom: 1px solid var(--border-muted);
                color: var(--text-primary);
                font-size: 14px;
            }

            tr:last-child td {
                border-bottom: none;
            }

            tr:hover {
                background-color: var(--border-muted);
            }

            /* Status Badges */
            .status-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
            }

            .status-protected {
                background-color: rgba(63, 185, 80, 0.15);
                color: var(--success);
            }

            .status-unprotected {
                background-color: rgba(217, 153, 34, 0.15);
                color: var(--warning);
            }

            .status-disabled {
                background-color: rgba(248, 81, 73, 0.15);
                color: var(--error);
            }

            .status-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background-color: currentColor;
            }

            /* Policy Count Badge */
            .policy-count {
                background-color: var(--accent-blue);
                color: var(--text-primary);
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
            }

            /* Expandable Details */
            .expandable {
                cursor: pointer;
                user-select: none;
                color: var(--accent-blue);
                font-size: 13px;
                padding: 8px 0;
                transition: color 0.2s;
            }

            .expandable:hover {
                color: var(--accent-light);
            }

            .policy-details {
                display: none;
                background-color: var(--background-secondary);
                border-radius: 6px;
                padding: 12px;
                margin-top: 8px;
            }

            .policy-item {
                background-color: var(--surface-primary);
                border-radius: 4px;
                padding: 8px 12px;
                margin-bottom: 8px;
                font-size: 12px;
                color: var(--text-secondary);
            }

            .policy-item:last-child {
                margin-bottom: 0;
            }

            /* No Data State */
            .no-data {
                text-align: center;
                padding: 60px 20px;
                color: var(--text-muted);
                font-size: 16px;
            }

            .no-data-icon {
                font-size: 48px;
                margin-bottom: 16px;
                opacity: 0.5;
            }

            /* Responsive Design */
            @media (max-width: 768px) {
                .container {
                    padding: 16px;
                }
                
                .header {
                    padding: 16px;
                }
                
                .stats-grid {
                    grid-template-columns: 1fr;
                }
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
        <!-- Header -->
        <div class="header">
            <div class="header-content">
                <h1>API Audit Results</h1>
                <p>Environment: ${environmentName}</p>
            </div>
        </div>

        <!-- Main Content -->
        <div class="container">
            <!-- Statistics Grid -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-header">
                        <h3 class="stat-title">Total APIs</h3>
                    </div>
                    <div class="stat-value">${totalApis}</div>
                    <p class="stat-subtitle">APIs discovered</p>
                </div>

                <div class="stat-card">
                    <div class="stat-header">
                        <h3 class="stat-title">Protected APIs</h3>
                    </div>
                    <div class="stat-value">${policyStatus.apis_with_policies.length}</div>
                    <p class="stat-subtitle">With active policies</p>
                </div>

                <div class="stat-card">
                    <div class="stat-header">
                        <h3 class="stat-title">Unprotected APIs</h3>
                    </div>
                    <div class="stat-value">${policyStatus.apis_without_policies.length}</div>
                    <p class="stat-subtitle">Without active policies</p>
                </div>

                <div class="stat-card">
                    <div class="stat-header">
                        <h3 class="stat-title">Policy Coverage</h3>
                    </div>
                    <div class="stat-value ${
                        parseFloat(policycoverage) >= 80 ? 'coverage-high' : 
                        parseFloat(policycoverage) >= 50 ? 'coverage-medium' : 'coverage-low'
                    }">${policycoverage}%</div>
                    <p class="stat-subtitle">Security coverage</p>
                </div>
            </div>

            ${policyStatus.apis_with_policies.length > 0 ? `
            <!-- Protected APIs Section -->
            <div class="section-card">
                <h2 class="section-title">
                    <span class="section-icon">✅</span>
                    Protected APIs (${policyStatus.apis_with_policies.length})
                </h2>
                <div class="table-wrapper">
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
                                    <td>
                                        <span class="status-badge status-protected">
                                            <span class="status-dot"></span>
                                            Protected
                                        </span>
                                    </td>
                                </tr>
                                ${api.policies.length > 0 ? `
                                <tr>
                                    <td colspan="5">
                                        <div class="expandable" onclick="togglePolicyDetails(this)">
                                            <span class="arrow">▶</span> View Policy Details
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
            <!-- Unprotected APIs Section -->
            <div class="section-card">
                <h2 class="section-title">
                    <span class="section-icon">⚠️</span>
                    Unprotected APIs (${policyStatus.apis_without_policies.length})
                </h2>
                <div class="table-wrapper">
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
                                            `<span class="status-badge status-disabled">
                                                <span class="status-dot"></span>
                                                Policies Disabled
                                            </span>` : 
                                            `<span class="status-badge status-unprotected">
                                                <span class="status-dot"></span>
                                                No Policies
                                            </span>`
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
                <div class="no-data-icon">🔍</div>
                <div>No APIs found in this environment</div>
            </div>
            ` : ''}
        </div>
    </body>
    </html>`;
}