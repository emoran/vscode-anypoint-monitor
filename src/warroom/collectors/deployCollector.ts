import * as vscode from 'vscode';
import { DeploymentRecord, CollectionError } from '../types';
import { ApiHelper } from '../../controllers/apiHelper';
import { getBaseUrl } from '../../constants';

const COLLECTOR_TIMEOUT = 30000;

export async function collectDeployments(
    context: vscode.ExtensionContext,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    timeWindowStart: Date,
    deploymentId?: string
): Promise<{ result: DeploymentRecord[]; errors: CollectionError[] }> {
    const errors: CollectionError[] = [];
    const deployments: DeploymentRecord[] = [];

    try {
        const apiHelper = new ApiHelper(context);
        const baseUrl = await getBaseUrl(context);

        const rawDeployments = await fetchDeploymentsWithTimeout(
            apiHelper, baseUrl, appName, appId, organizationId,
            environmentId, deploymentId
        );

        const suspiciousThreshold = new Date(timeWindowStart.getTime() - 15 * 60 * 1000);

        for (const dep of rawDeployments.slice(0, 5)) {
            const timestamp = dep.createTime || dep.createdDate || dep.lastModifiedDate || dep.updateTime || '';
            const depDate = timestamp ? new Date(timestamp) : null;

            const isSuspicious = depDate !== null &&
                depDate >= suspiciousThreshold &&
                depDate <= timeWindowStart;

            deployments.push({
                appName,
                deploymentId: dep.id || dep.deploymentId || '',
                version: dep.application?.artifact?.version || dep.artifactVersion || dep.version || dep.fileName || 'unknown',
                timestamp: timestamp ? new Date(timestamp).toISOString() : 'unknown',
                status: dep.status || dep.application?.status || 'unknown',
                triggeredBy: dep.createdBy || dep.triggeredBy || dep.user || 'unknown',
                suspicious: isSuspicious,
                suspiciousReason: isSuspicious ? `Deployed ${formatTimeDiff(depDate!, timeWindowStart)} before incident window` : undefined
            });
        }
    } catch (error: any) {
        if (error.message === 'COLLECTOR_TIMEOUT') {
            errors.push({ collector: 'deployments', app: appName, error: 'Timed out after 30s' });
        } else {
            errors.push({ collector: 'deployments', app: appName, error: error.message || 'Unknown error' });
        }
    }

    return { result: deployments, errors };
}

function formatTimeDiff(deployDate: Date, incidentStart: Date): string {
    const diffMs = incidentStart.getTime() - deployDate.getTime();
    const diffMin = Math.round(diffMs / (1000 * 60));
    if (diffMin < 60) {
        return `${diffMin}min`;
    }
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `${hours}h${mins > 0 ? ` ${mins}min` : ''}`;
}

async function fetchDeploymentsWithTimeout(
    apiHelper: ApiHelper,
    baseUrl: string,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    deploymentId?: string
): Promise<any[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT);

    try {
        // Try CH2 deployment history first
        try {
            const targetId = deploymentId || appId;
            const url = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments/${targetId}`;

            const response = await apiHelper.get(url, {
                headers: {
                    'X-ANYPNT-ENV-ID': environmentId,
                    'X-ANYPNT-ORG-ID': organizationId,
                },
                signal: controller.signal
            });

            if (response.status === 200 && response.data) {
                // Single deployment details - wrap in array
                const deployment = response.data;
                const history: any[] = [];

                // Try to get version history
                try {
                    const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments/${targetId}/specs`;
                    const specsResponse = await apiHelper.get(specsUrl, {
                        headers: {
                            'X-ANYPNT-ENV-ID': environmentId,
                            'X-ANYPNT-ORG-ID': organizationId,
                        },
                        signal: controller.signal
                    });

                    if (specsResponse.status === 200) {
                        const specs = Array.isArray(specsResponse.data) ? specsResponse.data : (specsResponse.data?.data || []);
                        for (const spec of specs.slice(0, 5)) {
                            history.push({
                                id: spec.id || targetId,
                                status: spec.status || deployment.status,
                                createTime: spec.createdDate || spec.createTime || deployment.createTime,
                                application: deployment.application,
                                artifactVersion: spec.version || deployment.application?.artifact?.version,
                                createdBy: spec.createdBy || 'unknown'
                            });
                        }
                    }
                } catch {
                    // Specs endpoint may not exist; use main deployment as single record
                }

                if (history.length === 0) {
                    history.push(deployment);
                }

                return history;
            }
        } catch (ch2Error: any) {
            if (ch2Error.name === 'AbortError' || ch2Error.name === 'CanceledError') {
                throw new Error('COLLECTOR_TIMEOUT');
            }
            // Fall through to CH1
        }

        // Try CH1 deployment history
        try {
            const url = `${baseUrl}/cloudhub/api/v2/applications/${appName}/deployments`;
            const response = await apiHelper.get(url, {
                headers: {
                    'X-ANYPNT-ENV-ID': environmentId,
                    'X-ANYPNT-ORG-ID': organizationId,
                },
                signal: controller.signal
            });

            if (response.status === 200) {
                const data = response.data;
                return Array.isArray(data) ? data : (data?.data || data?.items || []);
            }
        } catch (ch1Error: any) {
            if (ch1Error.name === 'AbortError' || ch1Error.name === 'CanceledError') {
                throw new Error('COLLECTOR_TIMEOUT');
            }
            throw ch1Error;
        }

        return [];
    } finally {
        clearTimeout(timeout);
    }
}
