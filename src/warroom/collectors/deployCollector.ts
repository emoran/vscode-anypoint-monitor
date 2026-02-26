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
            const timestamp = dep._parsedTimestamp || '';
            const depDate = timestamp ? new Date(timestamp) : null;

            const isSuspicious = depDate !== null &&
                !isNaN(depDate.getTime()) &&
                depDate >= suspiciousThreshold &&
                depDate <= timeWindowStart;

            deployments.push({
                appName,
                deploymentId: dep._parsedId || '',
                version: dep._parsedVersion || 'unknown',
                timestamp: (depDate && !isNaN(depDate.getTime())) ? depDate.toISOString() : 'unknown',
                status: dep._parsedStatus || 'unknown',
                triggeredBy: dep._parsedTriggeredBy || 'unknown',
                suspicious: isSuspicious,
                suspiciousReason: isSuspicious
                    ? `Deployed ${formatTimeDiff(depDate!, timeWindowStart)} before incident window`
                    : undefined
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
        const headers = {
            'X-ANYPNT-ENV-ID': environmentId,
            'X-ANYPNT-ORG-ID': organizationId,
        };

        // Try CH2 first: fetch deployment details + specs
        if (deploymentId) {
            try {
                const targetId = deploymentId;

                // Fetch the deployment details (for app version, lastModifiedDate)
                const deploymentUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments/${targetId}`;
                const deploymentResponse = await apiHelper.get(deploymentUrl, { headers, signal: controller.signal });

                if (deploymentResponse.status === 200 && deploymentResponse.data) {
                    const deployment = deploymentResponse.data;
                    const appRefVersion = deployment.application?.ref?.version || deployment.application?.artifact?.version || '';

                    // Fetch specs (these are the deployment versions/history)
                    const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments/${targetId}/specs`;
                    try {
                        const specsResponse = await apiHelper.get(specsUrl, { headers, signal: controller.signal });

                        if (specsResponse.status === 200) {
                            const specsRaw = specsResponse.data;
                            const specs = Array.isArray(specsRaw) ? specsRaw : (specsRaw?.data || []);

                            if (specs.length > 0) {
                                // Use only the latest spec (specs[0]) as a single deployment record.
                                // Multiple specs are configuration revisions of the same deployment, not separate deployments.
                                const latestSpec = specs[0];
                                return [{
                                    ...latestSpec,
                                    _parsedId: latestSpec.id || targetId,
                                    _parsedVersion: appRefVersion || latestSpec.version || latestSpec.id || 'unknown',
                                    _parsedTimestamp: latestSpec.lastModifiedDate || latestSpec.createdDate || latestSpec.createTime || deployment.lastModifiedDate || '',
                                    _parsedStatus: deployment.status || latestSpec.status || 'unknown',
                                    _parsedTriggeredBy: latestSpec.lastModifiedBy || latestSpec.createdBy || deployment.lastModifiedBy || deployment.createdBy || 'unknown'
                                }];
                            }
                        }
                    } catch {
                        // Specs endpoint failed, use deployment as single record
                    }

                    // Fallback: use the deployment itself as a single record
                    return [{
                        ...deployment,
                        _parsedId: targetId,
                        _parsedVersion: appRefVersion || 'unknown',
                        _parsedTimestamp: deployment.lastModifiedDate || deployment.createTime || deployment.updateTime || '',
                        _parsedStatus: deployment.status || 'unknown',
                        _parsedTriggeredBy: deployment.createdBy || 'unknown'
                    }];
                }
            } catch (ch2Error: any) {
                if (ch2Error.name === 'AbortError' || ch2Error.name === 'CanceledError') {
                    throw new Error('COLLECTOR_TIMEOUT');
                }
                // Fall through to CH1
            }
        }

        // Try CH1 deployment history
        try {
            const url = `${baseUrl}/cloudhub/api/v2/applications/${appName}/deployments?orderByDate=DESC&limit=5`;
            const response = await apiHelper.get(url, { headers, signal: controller.signal });

            if (response.status === 200) {
                const data = response.data;
                const items = Array.isArray(data) ? data : (data?.data || data?.items || []);

                return items.slice(0, 5).map((dep: any) => ({
                    ...dep,
                    _parsedId: dep.deploymentId || dep.id || '',
                    _parsedVersion: dep.fileName || dep.artifactVersion || dep.version || 'unknown',
                    _parsedTimestamp: dep.createTime || dep.createdDate || dep.lastModifiedDate || dep.deploymentDate || '',
                    _parsedStatus: dep.status || 'unknown',
                    _parsedTriggeredBy: dep.userId || dep.createdBy || dep.user || 'unknown'
                }));
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
