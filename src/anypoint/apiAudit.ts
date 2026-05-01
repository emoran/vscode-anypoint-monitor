import * as vscode from 'vscode';
import { getBaseUrl } from '../constants';
import { ApiHelper } from '../controllers/apiHelper.js';
import { telemetryService } from '../services/telemetryService';
import {
    wrapWebviewHtml,
    badge,
    summaryCard,
    escapeHtml
} from '../webview/ui-kit';

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
    const { AccountService } = await import('../controllers/accountService.js');
    const accountService = new AccountService(context);
    
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in first.');
    }
    
    const organizationID = activeAccount.organizationId;

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
    // Get region-specific base URL
    const baseUrl = await getBaseUrl(context);

    const endpoints = [
        `${baseUrl}/apimanager/api/v1/organizations/${organizationID}/environments/${environmentId}/apis`,
        `${baseUrl}/apimanager/api/v2/organizations/${organizationID}/environments/${environmentId}/apis`
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

    // Get region-specific base URL
    const baseUrl = await getBaseUrl(context);

    const endpointTemplates = [
        `${baseUrl}/apimanager/api/v1/organizations/${organizationID}/environments/${environmentId}/apis/{api_id}/policies`,
        `${baseUrl}/apimanager/api/v2/organizations/${organizationID}/environments/${environmentId}/apis/{api_id}/policies`
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
    telemetryService.trackPageView('apiAudit');
    const panel = vscode.window.createWebviewPanel(
        'apiAuditWebview',
        'API Audit Results',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // Get environment name and organization ID using multi-account system
    const { AccountService } = await import('../controllers/accountService.js');
    const accountService = new AccountService(context);
    const storedEnvironments = await accountService.getActiveAccountEnvironments();
    const activeAccount = await accountService.getActiveAccount();

    const organizationId = activeAccount?.organizationId || '';

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

    panel.webview.html = getAPIAuditWebviewContent(policyStatus, environmentName, environmentId, organizationId);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'openApiDetails':
                {
                    const { showApiManagerAPIDetail } = await import('./apiMananagerAPIDetail.js');
                    await showApiManagerAPIDetail(
                        context,
                        message.apiId,
                        message.organizationId,
                        message.environmentId
                    );
                }
                break;
        }
    });
}

function getAPIAuditWebviewContent(policyStatus: PolicyStatus, environmentName: string, environmentId: string, organizationId: string): string {
    const totalApis = policyStatus.apis_with_policies.length + policyStatus.apis_without_policies.length;
    const policycoverage = totalApis > 0 ? ((policyStatus.apis_with_policies.length / totalApis) * 100).toFixed(1) : '0.0';
    const covPct = parseFloat(policycoverage);
    const coverageVariant = covPct >= 80 ? 'healthy' : covPct >= 50 ? 'warning' : 'critical';

    const statsHtml = `
        <div class="am-summary-cards">
            ${summaryCard({
                icon: '📊',
                value: totalApis,
                label: 'Total APIs',
                breakdown: 'APIs discovered',
                animationDelay: '0.05s'
            })}
            ${summaryCard({
                icon: '✅',
                value: policyStatus.apis_with_policies.length,
                label: 'Protected APIs',
                breakdown: 'With active policies',
                variant: 'healthy',
                animationDelay: '0.1s'
            })}
            ${summaryCard({
                icon: '⚠️',
                value: policyStatus.apis_without_policies.length,
                label: 'Unprotected APIs',
                breakdown: 'Without active policies',
                variant: policyStatus.apis_without_policies.length > 0 ? 'warning' : 'default',
                animationDelay: '0.15s'
            })}
            ${summaryCard({
                icon: '🛡️',
                value: `${policycoverage}%`,
                label: 'Policy Coverage',
                breakdown: 'Security coverage',
                variant: coverageVariant,
                animationDelay: '0.2s'
            })}
        </div>
    `;

    const protectedSectionHtml =
        policyStatus.apis_with_policies.length > 0
            ? `
        <div class="am-card api-audit-section">
            <h2 class="api-audit-section-title">
                <span class="api-audit-section-icon">✅</span>
                Protected APIs (${policyStatus.apis_with_policies.length})
            </h2>
            <div class="am-table-container">
                <table class="am-table">
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
                        ${policyStatus.apis_with_policies
                            .map(api => {
                                const openClick = `openApiDetails(${JSON.stringify(api.api_id)}, ${JSON.stringify(organizationId)}, ${JSON.stringify(environmentId)}); return false;`;
                                const policiesRows =
                                    api.policies.length > 0
                                        ? `
                                <tr class="am-row api-audit-detail-row">
                                    <td colspan="5">
                                        <div class="api-audit-expandable" onclick="togglePolicyDetails(this)">
                                            <span class="arrow">▶</span> View Policy Details
                                        </div>
                                        <div class="policy-details">
                                            ${api.policies
                                                .map(policy => {
                                                    const policyName =
                                                        policy.template?.assetId ||
                                                        policy.policyTemplate?.name ||
                                                        policy.name ||
                                                        'Unknown Policy';
                                                    const policyVersion = policy.template?.assetVersion || 'Unknown';
                                                    return `<div class="policy-item">${escapeHtml(String(policyName))} (v${escapeHtml(String(policyVersion))})</div>`;
                                                })
                                                .join('')}
                                        </div>
                                    </td>
                                </tr>`
                                        : '';
                                return `
                                <tr class="am-row">
                                    <td>
                                        <a href="#" onclick="${openClick.replace(/"/g, '&quot;')}">${escapeHtml(String(api.api_name))}</a>
                                    </td>
                                    <td>${escapeHtml(String(api.api_version))}</td>
                                    <td>${badge(String(api.active_policies), 'info', true)}</td>
                                    <td>${api.total_policies}</td>
                                    <td>${badge('Protected', 'success')}</td>
                                </tr>
                                ${policiesRows}`;
                            })
                            .join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `
            : '';

    const unprotectedSectionHtml =
        policyStatus.apis_without_policies.length > 0
            ? `
        <div class="am-card api-audit-section">
            <h2 class="api-audit-section-title">
                <span class="api-audit-section-icon">⚠️</span>
                Unprotected APIs (${policyStatus.apis_without_policies.length})
            </h2>
            <div class="am-table-container">
                <table class="am-table">
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
                        ${policyStatus.apis_without_policies
                            .map(api => {
                                const openClick = `openApiDetails(${JSON.stringify(api.api_id)}, ${JSON.stringify(organizationId)}, ${JSON.stringify(environmentId)}); return false;`;
                                const statusBadge =
                                    api.total_policies > 0
                                        ? badge('Policies Disabled', 'error')
                                        : badge('No Policies', 'warning');
                                const issueText =
                                    api.total_policies > 0
                                        ? `${api.total_policies} inactive policies found`
                                        : 'No policies configured';
                                return `
                                <tr class="am-row">
                                    <td>
                                        <a href="#" onclick="${openClick.replace(/"/g, '&quot;')}">${escapeHtml(String(api.api_name))}</a>
                                    </td>
                                    <td>${escapeHtml(String(api.api_version))}</td>
                                    <td>${api.total_policies}</td>
                                    <td>${statusBadge}</td>
                                    <td>${escapeHtml(issueText)}</td>
                                </tr>`;
                            })
                            .join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `
            : '';

    const emptyHtml =
        totalApis === 0
            ? `
        <div class="api-audit-empty">
            <div class="api-audit-empty-icon">🔍</div>
            <div>No APIs found in this environment</div>
        </div>
    `
            : '';

    const body = `
        <div class="am-container">
            <header class="am-page-header">
                <div>
                    <h1>API Audit Results</h1>
                    <p class="api-audit-env">Environment: ${escapeHtml(environmentName)}</p>
                </div>
            </header>

            ${statsHtml}
            ${protectedSectionHtml}
            ${unprotectedSectionHtml}
            ${emptyHtml}
        </div>
    `;

    const scripts = `
            const vscode = acquireVsCodeApi();

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

            function openApiDetails(apiId, organizationId, environmentId) {
                vscode.postMessage({
                    command: 'openApiDetails',
                    apiId: apiId,
                    organizationId: organizationId,
                    environmentId: environmentId
                });
            }
        `;

    const extraStyles = `
            .api-audit-env {
                color: var(--am-text-secondary);
                font-size: 13px;
                margin-top: 6px;
            }
            .api-audit-section {
                margin-bottom: 24px;
            }
            .api-audit-section:last-of-type {
                margin-bottom: 0;
            }
            .api-audit-section-title {
                font-size: 16px;
                font-weight: 600;
                color: var(--am-text-primary);
                margin: 0 0 16px 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .api-audit-section-icon {
                font-size: 18px;
            }
            .api-audit-detail-row td {
                border-bottom: 1px solid var(--am-border);
            }
            .api-audit-expandable {
                cursor: pointer;
                user-select: none;
                color: var(--am-info);
                font-size: 13px;
                padding: 8px 0;
                transition: color 0.2s;
            }
            .api-audit-expandable:hover {
                color: var(--am-text-link-active);
            }
            .policy-details {
                display: none;
                background: var(--am-bg-secondary);
                border-radius: var(--am-radius-sm);
                padding: 12px;
                margin-top: 8px;
                border: 1px solid var(--am-border);
            }
            .policy-item {
                background: var(--am-bg-surface);
                border-radius: var(--am-radius-sm);
                padding: 8px 12px;
                margin-bottom: 8px;
                font-size: 12px;
                color: var(--am-text-secondary);
            }
            .policy-item:last-child {
                margin-bottom: 0;
            }
            .api-audit-empty {
                text-align: center;
                padding: 48px 20px;
                color: var(--am-text-muted);
                font-size: 15px;
            }
            .api-audit-empty-icon {
                font-size: 48px;
                margin-bottom: 16px;
                opacity: 0.5;
            }
            @media (max-width: 768px) {
                .am-summary-cards {
                    grid-template-columns: 1fr;
                }
            }
        `;

    return wrapWebviewHtml({
        title: 'API Audit Dashboard',
        body,
        scripts,
        extraStyles
    });
}
