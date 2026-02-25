import * as vscode from 'vscode';
import { WarRoomConfig } from './types';
import { runWarRoom } from './index';
import { buildDependencyMap } from './dependencyMapper';
import { AccountService } from '../controllers/accountService';
import { ApiHelper } from '../controllers/apiHelper';
import { getBaseUrl } from '../constants';

export async function startWarRoom(context: vscode.ExtensionContext): Promise<void> {
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        vscode.window.showErrorMessage('No active account found. Please log in first.');
        return;
    }

    const organizationId = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;

    // Step 1: Select Environment
    const environmentId = await selectEnvironment(context, accountService);
    if (!environmentId) { return; }

    const environmentName = await getEnvironmentName(accountService, context, environmentId);

    // Step 2: Select Applications (multi-select)
    const applications = await selectApplications(context, organizationId, environmentId);
    if (!applications || applications.length === 0) { return; }

    // Step 3: Select Time Window
    const timeWindow = await selectTimeWindow();
    if (!timeWindow) { return; }

    // Step 4: Select Severity
    const severity = await selectSeverity();
    if (!severity) { return; }

    // Step 5: Auto-expand toggle
    const autoExpand = await selectAutoExpand();
    if (autoExpand === undefined) { return; }

    const config: WarRoomConfig = {
        environment: environmentName,
        environmentId,
        organizationId,
        applications,
        timeWindow,
        severity,
        autoExpand,
        outputFormat: 'markdown'
    };

    await runWarRoom(context, config);
}

export async function startBuildDependencyMap(context: vscode.ExtensionContext): Promise<void> {
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        vscode.window.showErrorMessage('No active account found. Please log in first.');
        return;
    }

    const environmentId = await selectEnvironment(context, accountService);
    if (!environmentId) { return; }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Building Dependency Map',
        cancellable: false
    }, async (progress) => {
        const depMap = await buildDependencyMap(context, environmentId, progress);
        const appCount = depMap.apps.length;
        const depCount = depMap.dependencies.length;
        vscode.window.showInformationMessage(
            `Dependency map built: ${appCount} apps, ${depCount} dependencies. Saved to .warroom/dependency-map.json`
        );
    });
}

async function selectEnvironment(
    context: vscode.ExtensionContext,
    accountService: AccountService
): Promise<string | null> {
    let storedEnvironments = await accountService.getActiveAccountEnvironments();
    if (!storedEnvironments) {
        storedEnvironments = await context.secrets.get('anypoint.environments');
        if (!storedEnvironments) {
            try {
                const { getEnvironments } = await import('../controllers/anypointService.js');
                await getEnvironments(context, false);
                storedEnvironments = await accountService.getActiveAccountEnvironments();
                if (!storedEnvironments) {
                    storedEnvironments = await context.secrets.get('anypoint.environments');
                }
            } catch (error: any) {
                console.error('War Room: Failed to fetch environments:', error);
            }

            if (!storedEnvironments) {
                vscode.window.showErrorMessage('No environment information found. Please log in first.');
                return null;
            }
        }
    }

    const environments = JSON.parse(storedEnvironments) as {
        data: { id: string; name: string }[];
        total: number;
    };

    if (!environments.data || environments.data.length === 0) {
        vscode.window.showErrorMessage('No environments available.');
        return null;
    }

    const selected = await vscode.window.showQuickPick(
        environments.data.map(env => ({
            label: env.name,
            description: env.id,
            id: env.id
        })),
        {
            placeHolder: 'Select an environment for War Room',
            title: 'War Room - Step 1/5: Environment'
        }
    );

    return selected?.id || null;
}

async function getEnvironmentName(
    accountService: AccountService,
    context: vscode.ExtensionContext,
    environmentId: string
): Promise<string> {
    let storedEnvs = await accountService.getActiveAccountEnvironments();
    if (!storedEnvs) {
        storedEnvs = await context.secrets.get('anypoint.environments');
    }

    if (storedEnvs) {
        try {
            const environments = JSON.parse(storedEnvs);
            const env = environments.data?.find((e: any) => e.id === environmentId);
            if (env) { return env.name; }
        } catch { /* ignore */ }
    }

    return environmentId;
}

interface AppPickItem extends vscode.QuickPickItem {
    appName: string;
    appId: string;
    deploymentId?: string;
}

async function selectApplications(
    context: vscode.ExtensionContext,
    organizationId: string,
    environmentId: string
): Promise<Array<{ name: string; id: string; deploymentId?: string }> | null> {
    const apiHelper = new ApiHelper(context);
    const baseUrl = await getBaseUrl(context);
    const appItems: AppPickItem[] = [];

    // Fetch CH2 apps
    try {
        const ch2Url = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationId}/environments/${environmentId}/deployments`;
        const response = await apiHelper.get(ch2Url);

        if (response.status === 200) {
            let ch2Apps = response.data;
            if (!Array.isArray(ch2Apps)) {
                ch2Apps = ch2Apps?.data || ch2Apps?.items || ch2Apps?.applications || [];
            }
            for (const app of ch2Apps) {
                appItems.push({
                    label: `$(rocket) ${app.name}`,
                    description: `CH2 - ${app.status || 'unknown'}`,
                    appName: app.name,
                    appId: app.id || app.name,
                    deploymentId: app.id
                });
            }
        }
    } catch (error: any) {
        console.log('War Room: CH2 apps fetch failed:', error.message);
    }

    // Fetch CH1 apps
    try {
        const ch1Url = `${baseUrl}/cloudhub/api/applications`;
        const response = await apiHelper.get(ch1Url, {
            headers: {
                'X-ANYPNT-ENV-ID': environmentId,
                'X-ANYPNT-ORG-ID': organizationId,
            }
        });

        if (response.status === 200) {
            const ch1Apps = Array.isArray(response.data) ? response.data : [];
            for (const app of ch1Apps) {
                const name = app.domain || app.name;
                if (!appItems.some(a => a.appName === name)) {
                    appItems.push({
                        label: `$(package) ${name}`,
                        description: `CH1 - ${app.status || 'unknown'}`,
                        appName: name,
                        appId: name
                    });
                }
            }
        }
    } catch (error: any) {
        console.log('War Room: CH1 apps fetch failed:', error.message);
    }

    if (appItems.length === 0) {
        vscode.window.showErrorMessage('No applications found in this environment.');
        return null;
    }

    const selected = await vscode.window.showQuickPick(appItems, {
        placeHolder: 'Select application(s) for incident triage',
        title: 'War Room - Step 2/5: Applications (multi-select)',
        canPickMany: true
    });

    if (!selected || selected.length === 0) {
        vscode.window.showInformationMessage('No applications selected.');
        return null;
    }

    return selected.map(item => ({
        name: item.appName,
        id: item.appId,
        deploymentId: item.deploymentId
    }));
}

async function selectTimeWindow(): Promise<{ start: Date; end: Date } | null> {
    const options = [
        { label: '15 minutes', value: 15 },
        { label: '30 minutes (default)', value: 30 },
        { label: '1 hour', value: 60 },
        { label: '2 hours', value: 120 },
        { label: 'Custom...', value: -1 }
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select incident time window',
        title: 'War Room - Step 3/5: Time Window'
    });

    if (!selected) { return null; }

    let minutes = selected.value;

    if (minutes === -1) {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter time window in minutes',
            placeHolder: 'e.g., 45',
            title: 'War Room - Custom Time Window',
            validateInput: (value) => {
                const num = parseInt(value);
                if (isNaN(num) || num < 5 || num > 1440) {
                    return 'Enter a number between 5 and 1440 (24 hours)';
                }
                return null;
            }
        });

        if (!input) { return null; }
        minutes = parseInt(input);
    }

    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000);

    return { start, end };
}

async function selectSeverity(): Promise<'SEV1' | 'SEV2' | 'SEV3' | null> {
    const options = [
        { label: 'SEV1 - Critical', description: 'Production down, customer-facing impact', value: 'SEV1' as const },
        { label: 'SEV2 - Major', description: 'Significant degradation, partial outage', value: 'SEV2' as const },
        { label: 'SEV3 - Minor', description: 'Limited impact, workaround available', value: 'SEV3' as const }
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select incident severity',
        title: 'War Room - Step 4/5: Severity'
    });

    return selected?.value || null;
}

async function selectAutoExpand(): Promise<boolean | undefined> {
    const options = [
        { label: '$(check) Auto-expand blast radius (recommended)', description: 'Automatically include upstream and downstream apps', value: true },
        { label: '$(x) Selected apps only', description: 'Only analyze the selected applications', value: false }
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Auto-expand blast radius?',
        title: 'War Room - Step 5/5: Blast Radius Expansion'
    });

    return selected?.value;
}
