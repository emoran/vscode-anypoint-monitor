import * as vscode from 'vscode';
import { AppStatus, CollectionError } from '../types';
import { ApiHelper } from '../../controllers/apiHelper';
import { getBaseUrl } from '../../constants';

const COLLECTOR_TIMEOUT = 30000;

export async function collectStatus(
    context: vscode.ExtensionContext,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    deploymentId?: string
): Promise<{ result: AppStatus; errors: CollectionError[] }> {
    const errors: CollectionError[] = [];
    let status: AppStatus = {
        name: appName,
        status: 'UNKNOWN',
        workerCount: null,
        lastRestart: null,
        region: null,
        runtimeVersion: null
    };

    try {
        const apiHelper = new ApiHelper(context);
        const baseUrl = await getBaseUrl(context);

        status = await fetchStatusWithTimeout(
            apiHelper, baseUrl, appName, appId, organizationId,
            environmentId, deploymentId
        );
    } catch (error: any) {
        if (error.message === 'COLLECTOR_TIMEOUT') {
            errors.push({ collector: 'status', app: appName, error: 'Timed out after 30s' });
        } else {
            errors.push({ collector: 'status', app: appName, error: error.message || 'Unknown error' });
        }
    }

    return { result: status, errors };
}

async function fetchStatusWithTimeout(
    apiHelper: ApiHelper,
    baseUrl: string,
    appName: string,
    appId: string,
    organizationId: string,
    environmentId: string,
    deploymentId?: string
): Promise<AppStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT);

    try {
        // Try CH2 deployment details first
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
                const data = response.data;
                const app = data.application || data;
                const target = data.target || {};

                // muleVersion is on the deployment object itself (data.muleVersion.version), not on target
                // target.deploymentSettings.region has the actual region; target.name is the target display name
                const runtimeVersion = data.muleVersion?.version || app.muleVersion?.version || app.muleVersion || app.currentRuntimeVersion || null;
                const region = target.deploymentSettings?.region || target.name || target.region || null;
                return {
                    name: data.name || appName,
                    status: data.status || app.status || 'UNKNOWN',
                    workerCount: target.replicas || app.replicas || target.workers?.amount || null,
                    lastRestart: data.lastModifiedDate || data.updateTime || null,
                    region,
                    runtimeVersion
                };
            }
        } catch (ch2Error: any) {
            if (ch2Error.name === 'AbortError' || ch2Error.name === 'CanceledError') {
                throw new Error('COLLECTOR_TIMEOUT');
            }
            // Fall through to CH1
        }

        // Try CH1 application details
        try {
            const url = `${baseUrl}/cloudhub/api/applications/${appName}`;
            const response = await apiHelper.get(url, {
                headers: {
                    'X-ANYPNT-ENV-ID': environmentId,
                    'X-ANYPNT-ORG-ID': organizationId,
                },
                signal: controller.signal
            });

            if (response.status === 200 && response.data) {
                const app = response.data;
                return {
                    name: app.domain || appName,
                    status: app.status || 'UNKNOWN',
                    workerCount: app.workers?.type?.weight ? app.workers.amount : (app.workers?.amount || null),
                    lastRestart: app.lastUpdateTime ? new Date(app.lastUpdateTime).toISOString() : null,
                    region: app.region || null,
                    runtimeVersion: app.muleVersion || null
                };
            }
        } catch (ch1Error: any) {
            if (ch1Error.name === 'AbortError' || ch1Error.name === 'CanceledError') {
                throw new Error('COLLECTOR_TIMEOUT');
            }
            throw ch1Error;
        }

        return {
            name: appName,
            status: 'UNKNOWN',
            workerCount: null,
            lastRestart: null,
            region: null,
            runtimeVersion: null
        };
    } finally {
        clearTimeout(timeout);
    }
}
