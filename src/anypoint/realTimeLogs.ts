import * as vscode from 'vscode';
import axios from 'axios';
import { BASE_URL, getBaseUrl } from '../constants';
import { refreshAccessToken } from '../controllers/oauthService';
import { AccountService } from '../controllers/accountService.js';
import { ApiHelper } from '../controllers/apiHelper.js';
import * as fs from 'fs';
import { getGitHubStarBannerHtml, getGitHubStarBannerStyles, getGitHubStarBannerScript } from '../utils/starPrompt.js';
import { wrapWebviewHtml, badge, escapeHtml, stripScriptTags } from '../webview/ui-kit';
import { telemetryService } from '../services/telemetryService';
import { jumpToSource, buildReplaySession, getInlineHypotheses } from '../fire/orchestrator.js';
import { isActionableLogEntry } from '../fire/logParser.js';
import { showReplayPanel } from '../fire/replayPanel.js';

interface LogEntry {
    timestamp: number;
    priority: string;
    threadName: string;
    message: string;
}

interface RealTimeLogSession {
    panel: vscode.WebviewPanel;
    intervalId: NodeJS.Timeout | null;
    isStreaming: boolean;
    lastLogTimestamp: number;
    environmentId: string;
    applicationDomain: string;
    logBuffer: LogEntry[];
    context: vscode.ExtensionContext;
    refreshRate: number;
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID';
    deploymentId?: string;
    specificationId?: string;
}

const activeSessions = new Map<string, RealTimeLogSession>();

/**
 * Show real-time logs for a CloudHub application
 */
export async function showRealTimeLogs(
    context: vscode.ExtensionContext,
    environmentId: string,
    applicationDomain: string,
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID' = 'CH1',
    deploymentId?: string,
    specificationId?: string
) {
    telemetryService.trackPageView('realTimeLogs');
    const sessionKey = `${environmentId}-${applicationDomain}`;
    
    // Close existing session if any
    if (activeSessions.has(sessionKey)) {
        const existingSession = activeSessions.get(sessionKey)!;
        existingSession.panel.dispose();
        if (existingSession.intervalId) {
            clearInterval(existingSession.intervalId);
        }
        activeSessions.delete(sessionKey);
    }

    const panel = vscode.window.createWebviewPanel(
        'realTimeLogs',
        `Real-Time Logs - ${applicationDomain} (${cloudhubVersion})`,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    const session: RealTimeLogSession = {
        panel,
        intervalId: null,
        isStreaming: false,
        lastLogTimestamp: Date.now() - (5 * 60 * 1000), // Start from 5 minutes ago
        environmentId,
        applicationDomain,
        logBuffer: [],
        context,
        refreshRate: 2000, // Default 2 seconds
        cloudhubVersion,
        deploymentId,
        specificationId
    };

    activeSessions.set(sessionKey, session);

    panel.webview.html = getRealTimeLogsHtml(panel.webview, context.extensionUri, applicationDomain, cloudhubVersion);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(async (message) => {
        console.log('Real-time logs: Received message from webview:', message);
        
        switch (message.command) {
            case 'startStreaming':
                console.log('Real-time logs: Starting streaming');
                await startLogStreaming(context, session);
                break;
            case 'stopStreaming':
                console.log('Real-time logs: Stopping streaming');
                stopLogStreaming(session);
                break;
            case 'clearLogs':
                console.log('Real-time logs: Clearing logs');
                session.logBuffer = [];
                session.lastLogTimestamp = Date.now();
                panel.webview.postMessage({ command: 'clearLogs' });
                break;
            case 'exportLogs':
                console.log('Real-time logs: Export logs requested, format:', message.format);
                await exportLogs(session, message.format);
                break;
            case 'setRefreshRate':
                console.log('Real-time logs: Setting refresh rate to:', message.rate);
                await setRefreshRate(session, message.rate);
                break;
            case 'jumpToSource': {
                console.log('FIRE: Jump to source requested for log index:', message.logIndex);
                const entries = session.logBuffer.map(e => ({
                    priority: e.priority,
                    message: e.message,
                    timestamp: e.timestamp,
                }));
                // Send surrounding context entries (up to 20 before the failing entry)
                const startIdx = Math.max(0, message.logIndex - 20);
                const contextEntries = entries.slice(startIdx, message.logIndex + 1);
                const success = await jumpToSource(contextEntries, session.applicationDomain);
                if (!success) {
                    panel.webview.postMessage({
                        command: 'jumpToSourceFailed',
                        logIndex: message.logIndex,
                    });
                }
                break;
            }

            case 'replayFailure': {
                console.log('FIRE: Replay failure requested for log index:', message.logIndex);
                const entries = session.logBuffer.map(e => ({
                    priority: e.priority,
                    message: e.message,
                    timestamp: e.timestamp,
                }));
                const startIdx = Math.max(0, message.logIndex - 20);
                const contextEntries = entries.slice(startIdx, message.logIndex + 1);
                const replaySession = await buildReplaySession(
                    contextEntries,
                    session.applicationDomain,
                    message.logIndex
                );
                if (replaySession) {
                    panel.webview.postMessage({
                        command: 'replaySessionReady',
                        session: replaySession,
                    });
                    await showReplayPanel(context, replaySession);
                } else {
                    panel.webview.postMessage({
                        command: 'replaySessionFailed',
                        logIndex: message.logIndex,
                    });
                }
                break;
            }
            case 'openGitHubRepo':
                try {
                    await vscode.env.openExternal(vscode.Uri.parse(message.url));
                } catch (error: any) {
                    console.error('Failed to open GitHub URL:', error);
                    vscode.window.showErrorMessage(`Failed to open GitHub: ${error.message}`);
                }
                break;
            default:
                console.log('Real-time logs: Unknown command:', message.command);
        }
    });

    // Clean up when panel is closed
    panel.onDidDispose(() => {
        if (session.intervalId) {
            clearInterval(session.intervalId);
        }
        activeSessions.delete(sessionKey);
    });

    // Auto-start streaming
    await startLogStreaming(context, session);
}

/**
 * Start streaming logs for the given session
 */
async function startLogStreaming(context: vscode.ExtensionContext, session: RealTimeLogSession) {
    console.log(`Real-time logs: Starting log streaming for ${session.cloudhubVersion} app ${session.applicationDomain}`);
    
    if (session.isStreaming) {
        console.log('Real-time logs: Already streaming, skipping');
        return;
    }

    session.isStreaming = true;
    console.log('Real-time logs: Set streaming status to true');
    
    session.panel.webview.postMessage({ 
        command: 'streamingStatus', 
        isStreaming: true 
    });
    console.log('Real-time logs: Sent streaming status message to webview');

    const fetchLogs = async () => {
        try {
            console.log(`Real-time logs: Fetching logs for ${session.cloudhubVersion} app ${session.applicationDomain}`);
            console.log(`Real-time logs: Last timestamp: ${session.lastLogTimestamp}, Deployment ID: ${session.deploymentId}, Spec ID: ${session.specificationId}`);
            
            const logs = await fetchNewLogs(context, session);
            console.log(`Real-time logs: Fetched ${logs.length} new logs`);
            
            if (logs.length > 0) {
                session.logBuffer.push(...logs);
                // Keep buffer manageable (last 1000 logs)
                if (session.logBuffer.length > 1000) {
                    session.logBuffer = session.logBuffer.slice(-1000);
                }
                
                session.panel.webview.postMessage({
                    command: 'newLogs',
                    logs: logs
                });

                // Update last timestamp
                const lastLog = logs[logs.length - 1];
                session.lastLogTimestamp = lastLog.timestamp;
                console.log(`Real-time logs: Updated last timestamp to ${session.lastLogTimestamp}`);
            } else {
                console.log(`Real-time logs: No new logs found since ${new Date(session.lastLogTimestamp).toISOString()}`);
            }
        } catch (error: any) {
            console.error(`Real-time logs: Error fetching logs:`, error);
            session.panel.webview.postMessage({
                command: 'error',
                message: `Failed to fetch logs: ${error.message}`
            });
        }
    };

    // Initial fetch
    await fetchLogs();

    // Set up interval for continuous streaming
    session.intervalId = setInterval(fetchLogs, session.refreshRate);
}

/**
 * Stop streaming logs
 */
function stopLogStreaming(session: RealTimeLogSession) {
    session.isStreaming = false;
    if (session.intervalId) {
        clearInterval(session.intervalId);
        session.intervalId = null;
    }
    session.panel.webview.postMessage({ 
        command: 'streamingStatus', 
        isStreaming: false 
    });
}

/**
 * Fetch new logs since the last timestamp for both CH1 and CH2
 */
async function fetchNewLogs(
    context: vscode.ExtensionContext,
    session: RealTimeLogSession
): Promise<LogEntry[]> {
    if (session.cloudhubVersion === 'CH2') {
        return await fetchCH2Logs(context, session);
    } else if (session.cloudhubVersion === 'HYBRID') {
        return await fetchHybridLogs(context, session);
    } else {
        return await fetchCH1Logs(context, session);
    }
}

/**
 * Fetch CloudHub 1.0 logs
 */
async function fetchCH1Logs(
    context: vscode.ExtensionContext,
    session: RealTimeLogSession
): Promise<LogEntry[]> {
    const accountService = new AccountService(context);
    const apiHelper = new ApiHelper(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in.');
    }

    // Use effective organization ID to respect selected business group
    const organizationID = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;

    // Get region-specific base URL
    const baseUrl = await getBaseUrl(context);

    // Get deployment info first if not already available
    let deploymentId = session.deploymentId;
    if (!deploymentId) {
        const deploymentsURL = `${baseUrl}/cloudhub/api/v2/applications/${session.applicationDomain}/deployments?orderByDate=DESC`;

        try {
            const deploymentsResponse = await apiHelper.get(deploymentsURL, {
                headers: {
                    'X-ANYPNT-ENV-ID': session.environmentId,
                    'X-ANYPNT-ORG-ID': organizationID,
                }
            });
            if (deploymentsResponse.status !== 200) {
                throw new Error(`Deployments request failed with status ${deploymentsResponse.status}`);
            }
            deploymentId = deploymentsResponse.data.data[0].deploymentId;
            session.deploymentId = deploymentId; // Cache for future calls
        } catch (error: any) {
            throw error;
        }
    }

    // Fetch logs since last timestamp
    const startTime = session.lastLogTimestamp;
    const endTime = Date.now();

    const logsURL = `${baseUrl}/cloudhub/api/v2/applications/${session.applicationDomain}/deployments/${deploymentId}/logs?startTime=${startTime}&endTime=${endTime}&limit=100`;
    
    try {
        const logsResponse = await apiHelper.get(logsURL, {
            headers: {
                'X-ANYPNT-ENV-ID': session.environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            }
        });
        
        if (logsResponse.status !== 200) {
            throw new Error(`Logs request failed with status ${logsResponse.status}`);
        }

        const logsData = logsResponse.data;
        const logs = Array.isArray(logsData.data) ? logsData.data : Array.isArray(logsData) ? logsData : [];
        
        return logs.filter((log: LogEntry) => log.timestamp > session.lastLogTimestamp);
    } catch (error: any) {
        throw error;
    }
}

/**
 * Fetch CloudHub 2.0 logs
 */
async function fetchCH2Logs(
    context: vscode.ExtensionContext,
    session: RealTimeLogSession
): Promise<LogEntry[]> {
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in.');
    }

    // Use effective organization ID to respect selected business group
    const organizationID = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;
    const accessToken = await accountService.getActiveAccountAccessToken();

    if (!accessToken) {
        throw new Error('No access token found for active account');
    }

    // For CH2, we need deploymentId and specificationId
    if (!session.deploymentId || !session.specificationId) {
        throw new Error('CloudHub 2.0 requires deploymentId and specificationId');
    }

    // Get region to determine which API to use
    const regionId = activeAccount.region || 'us';
    const baseUrl = await getBaseUrl(context);

    // CH2 logs API endpoint - use region-specific URL
    // API expects timestamps as Long values (milliseconds since epoch), not ISO strings
    const startTimeMs = session.lastLogTimestamp;
    const endTimeMs = Date.now();

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('limit', '100');
    queryParams.append('offset', '0');
    queryParams.append('startTime', startTimeMs.toString());
    queryParams.append('endTime', endTimeMs.toString());

    // Use region-specific base URL - all regions use Application Manager API for logs
    const logsURL = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${session.environmentId}/deployments/${session.deploymentId}/specs/${session.specificationId}/logs?${queryParams.toString()}`;

    console.log(`Real-time logs CH2: Region: ${regionId}`);
    console.log(`Real-time logs CH2: Fetching from URL: ${logsURL}`);
    console.log(`Real-time logs CH2: Organization ID: ${organizationID}`);
    console.log(`Real-time logs CH2: Environment ID: ${session.environmentId}`);
    console.log(`Real-time logs CH2: Deployment ID: ${session.deploymentId}`);
    console.log(`Real-time logs CH2: Specification ID: ${session.specificationId}`);
    console.log(`Real-time logs CH2: Time range: ${startTimeMs} (${new Date(startTimeMs).toISOString()}) to ${endTimeMs} (${new Date(endTimeMs).toISOString()})`);

    // Build headers - EU/GOV may need additional headers (TBD based on testing)
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };

    try {
        const response = await fetch(logsURL, {
            method: 'GET',
            headers
        });

        console.log(`Real-time logs CH2: Response status: ${response.status}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Real-time logs CH2: Response not ok: ${response.status} ${response.statusText}`);
            console.error(`Real-time logs CH2: Error response body:`, errorText);
            
            if (response.status === 401) {
                const didRefresh = await refreshAccessToken(context, activeAccount.id);
                if (!didRefresh) {
                    throw new Error('Unable to refresh token');
                }
                const newAccessToken = await accountService.getActiveAccountAccessToken();
                if (!newAccessToken) {
                    throw new Error('Failed to get refreshed access token');
                }
                // Retry with new token - use same region-specific URL
                const retryResponse = await fetch(logsURL, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${newAccessToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!retryResponse.ok) {
                    throw new Error(`Failed to fetch CH2 logs: ${retryResponse.status} ${retryResponse.statusText}`);
                }
                
                const logsData = await retryResponse.json();
                return processCH2LogsResponse(logsData, session);
            } else {
                throw new Error(`Failed to fetch CH2 logs: ${response.status} ${response.statusText}`);
            }
        }

        const logsData = await response.json();
        console.log(`Real-time logs CH2: Raw response data:`, JSON.stringify(logsData, null, 2));
        
        const processedLogs = processCH2LogsResponse(logsData, session);
        console.log(`Real-time logs CH2: Processed ${processedLogs.length} logs`);
        
        return processedLogs;
    } catch (error: any) {
        throw new Error(`CH2 logs fetch error: ${error.message}`);
    }
}

/**
 * Fetch Hybrid application logs
 * NOTE: The ARM API may not support real-time log streaming for Hybrid applications.
 * Logs are typically accessed through the Mule Runtime server's log files directly.
 */
async function fetchHybridLogs(
    context: vscode.ExtensionContext,
    session: RealTimeLogSession
): Promise<LogEntry[]> {
    const accountService = new AccountService(context);
    const apiHelper = new ApiHelper(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in.');
    }

    // Use effective organization ID to respect selected business group
    const organizationID = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;
    const { ARM_BASE } = await import('../constants.js');

    // Hybrid logs are typically not available through the ARM REST API
    // They need to be accessed directly from the Mule Runtime server's log files
    // However, we'll try a few potential ARM endpoints

    // Try ARM monitoring query endpoint for Hybrid logs
    try {
        const startTime = session.lastLogTimestamp;
        const endTime = Date.now();

        // Attempt 1: Try ARM monitoring query API
        // https://anypoint.mulesoft.com/armui/api/v1/servers/{serverId}/logs
        console.log(`Real-time logs Hybrid: Attempting to fetch logs from ARM monitoring API`);

        // We would need the server ID to fetch logs, which we might not have here
        // This is a limitation of the ARM API for Hybrid deployments

        // Show a helpful message to the user
        try {
            session.panel.webview.postMessage({
                command: 'error',
                message: 'Real-time log streaming is not available for Hybrid deployments through the Anypoint API. ' +
                         'To view logs for Hybrid applications, please access the log files directly on the Mule Runtime server where the application is deployed. ' +
                         'Log files are typically located in the $MULE_HOME/logs directory.'
            });
        } catch (postError) {
            console.error('Failed to post message to webview:', postError);
        }

        // Return empty array - no logs available through API
        return [];

    } catch (error: any) {
        console.error('Hybrid logs: API not available:', error.message);

        try {
            session.panel.webview.postMessage({
                command: 'error',
                message: 'Real-time logs are not available for Hybrid deployments via API. Please access logs directly on the Mule Runtime server.'
            });
        } catch (postError) {
            console.error('Failed to post message to webview:', postError);
        }

        return [];
    }
}

/**
 * Process CloudHub 2.0 logs response for export (no timestamp filtering)
 */
function processCH2LogsResponseForExport(logsData: any): LogEntry[] {
    console.log('Processing CH2 logs response for export, data type:', typeof logsData);
    console.log('Processing CH2 logs response for export, data keys:', Object.keys(logsData || {}));
    
    // Handle different CH2 response structures
    let logs: any[] = [];
    
    if (Array.isArray(logsData)) {
        console.log('Found logs as direct array, length:', logsData.length);
        logs = logsData;
    } else if (logsData.items && Array.isArray(logsData.items)) {
        console.log('Found logs in items property, length:', logsData.items.length);
        logs = logsData.items;
    } else if (logsData.data && Array.isArray(logsData.data)) {
        console.log('Found logs in data property, length:', logsData.data.length);
        logs = logsData.data;
    } else if (logsData.logs && Array.isArray(logsData.logs)) {
        console.log('Found logs in logs property, length:', logsData.logs.length);
        logs = logsData.logs;
    } else {
        // Try to find any array property as fallback
        const arrayProps = Object.keys(logsData).filter(key => 
            Array.isArray(logsData[key])
        );
        
        console.log('No standard log array found, array properties found:', arrayProps);
        
        if (arrayProps.length > 0) {
            logs = logsData[arrayProps[0]];
            console.log('Using first array property:', arrayProps[0], 'length:', logs.length);
        }
    }

    console.log('Raw logs count before processing:', logs.length);

    // Convert CH2 log format to standard LogEntry format
    const processedLogs = logs
        .map((log: any) => ({
            timestamp: new Date(log.timestamp || log.time || log.date).getTime(),
            priority: log.logLevel || log.level || log.priority || log.severity || 'INFO',
            threadName: log.thread || log.threadName || log.source || '',
            message: log.message || log.content || log.text || ''
        }));

    console.log('Export: Processed logs count (no filtering):', processedLogs.length);
    
    // For export, return ALL logs sorted by timestamp
    return processedLogs.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Process CloudHub 2.0 logs response and filter by timestamp (for real-time streaming)
 */
function processCH2LogsResponse(logsData: any, session: RealTimeLogSession): LogEntry[] {
    console.log('Processing CH2 logs response, data type:', typeof logsData);
    console.log('Processing CH2 logs response, data keys:', Object.keys(logsData || {}));
    
    // Handle different CH2 response structures
    let logs: any[] = [];
    
    if (Array.isArray(logsData)) {
        console.log('Found logs as direct array, length:', logsData.length);
        logs = logsData;
    } else if (logsData.items && Array.isArray(logsData.items)) {
        console.log('Found logs in items property, length:', logsData.items.length);
        logs = logsData.items;
    } else if (logsData.data && Array.isArray(logsData.data)) {
        console.log('Found logs in data property, length:', logsData.data.length);
        logs = logsData.data;
    } else if (logsData.logs && Array.isArray(logsData.logs)) {
        console.log('Found logs in logs property, length:', logsData.logs.length);
        logs = logsData.logs;
    } else {
        // Try to find any array property as fallback
        const arrayProps = Object.keys(logsData).filter(key => 
            Array.isArray(logsData[key])
        );
        
        console.log('No standard log array found, array properties found:', arrayProps);
        
        if (arrayProps.length > 0) {
            logs = logsData[arrayProps[0]];
            console.log('Using first array property:', arrayProps[0], 'length:', logs.length);
        }
    }

    console.log('Raw logs count before processing:', logs.length);

    // Convert CH2 log format to standard LogEntry format
    const processedLogs = logs
        .map((log: any) => ({
            timestamp: new Date(log.timestamp || log.time || log.date).getTime(),
            priority: log.level || log.priority || log.severity || 'INFO',
            threadName: log.thread || log.threadName || log.source || '',
            message: log.message || log.content || log.text || ''
        }));

    console.log('Processed logs count:', processedLogs.length);
    
    // For export, don't filter by lastLogTimestamp since we want ALL logs
    // Only filter by timestamp if this is called from real-time streaming
    const isRealTimeCall = session.lastLogTimestamp && session.lastLogTimestamp > 0;
    
    if (isRealTimeCall) {
        console.log('Filtering by last log timestamp:', session.lastLogTimestamp);
        const filteredLogs = processedLogs.filter((log: LogEntry) => log.timestamp > session.lastLogTimestamp);
        console.log('Filtered logs count:', filteredLogs.length);
        return filteredLogs.sort((a, b) => a.timestamp - b.timestamp);
    } else {
        console.log('Not filtering by timestamp (export mode)');
        return processedLogs.sort((a, b) => a.timestamp - b.timestamp);
    }
}

/**
 * Export logs in various formats
 */
async function exportLogs(session: RealTimeLogSession, format: 'json' | 'txt' | 'csv') {
    console.log(`Export: Starting full log export in ${format} format for ${session.cloudhubVersion} app ${session.applicationDomain}`);
    
    // Fetch all available logs for the application, not just the streamed buffer
    let allLogs: LogEntry[] = [];
    
    try {
        if (session.cloudhubVersion === 'CH1') {
            allLogs = await fetchFullCH1Logs(session);
        } else {
            allLogs = await fetchFullCH2Logs(session);
        }
        
        console.log(`Export: Fetched ${allLogs.length} total logs for export`);
        
        if (allLogs.length === 0) {
            console.log('Export: No logs found for application');
            vscode.window.showInformationMessage('No logs found for this application.');
            session.panel.webview.postMessage({
                command: 'error',
                message: 'No logs available for this application'
            });
            return;
        }
    } catch (error: any) {
        console.error('Export: Error fetching logs:', error);
        vscode.window.showErrorMessage(`Failed to fetch logs for export: ${error.message}`);
        session.panel.webview.postMessage({
            command: 'error',
            message: `Failed to fetch logs: ${error.message}`
        });
        return;
    }

    let content = '';
    let extension = '';
    
    switch (format) {
        case 'json':
            content = JSON.stringify(allLogs, null, 2);
            extension = 'json';
            break;
        case 'txt':
            content = allLogs
                .map(log => {
                    const timestamp = new Date(log.timestamp).toISOString();
                    const priority = log.priority || 'INFO';
                    const message = (log.message || '').replace(/\\n/g, '\n');
                    return `[${timestamp}] ${priority}: ${message}`;
                })
                .join('\n\n');
            extension = 'txt';
            break;
        case 'csv':
            const headers = ['Timestamp', 'Priority', 'Thread Name', 'Message'];
            const csvRows = allLogs.map(log => {
                const timestamp = new Date(log.timestamp).toISOString();
                const priority = log.priority || '';
                const threadName = log.threadName || '';
                const message = (log.message || '').replace(/"/g, '""');
                return `"${timestamp}","${priority}","${threadName}","${message}"`;
            });
            content = [headers.join(','), ...csvRows].join('\n');
            extension = 'csv';
            break;
    }

    const defaultFileName = `application-logs-${session.applicationDomain}-${new Date().toISOString().split('T')[0]}.${extension}`;
    console.log(`Export: Default filename: ${defaultFileName}`);
    
    const uri = await vscode.window.showSaveDialog({
        filters: {
            'JSON Files': ['json'],
            'Text Files': ['txt'],
            'CSV Files': ['csv']
        },
        defaultUri: vscode.Uri.file(defaultFileName),
        saveLabel: 'Export Application Logs'
    });

    console.log(`Export: Save dialog result:`, uri?.fsPath || 'User cancelled');

    if (uri) {
        try {
            console.log(`Export: Writing ${content.length} characters to ${uri.fsPath}`);
            fs.writeFileSync(uri.fsPath, content, 'utf-8');
            console.log(`Export: Successfully wrote file`);
            
            vscode.window.showInformationMessage(`Application logs exported to ${uri.fsPath}`);
            
            // Send success message to webview
            session.panel.webview.postMessage({
                command: 'exportComplete',
                filePath: uri.fsPath,
                format: format
            });
        } catch (error: any) {
            console.error('Export: Error writing file:', error);
            vscode.window.showErrorMessage(`Failed to export logs: ${error.message}`);
            session.panel.webview.postMessage({
                command: 'error',
                message: `Export failed: ${error.message}`
            });
        }
    } else {
        console.log('Export: User cancelled save dialog');
        session.panel.webview.postMessage({
            command: 'error',
            message: 'Export cancelled by user'
        });
    }
}

/**
 * Fetch all available CloudHub 1.0 logs for export
 */
async function fetchFullCH1Logs(session: RealTimeLogSession): Promise<LogEntry[]> {
    const context = session.context;
    const accountService = new AccountService(context);
    const apiHelper = new ApiHelper(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in.');
    }

    // Use effective organization ID to respect selected business group
    const organizationID = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;

    // Get region-specific base URL
    const baseUrl = await getBaseUrl(context);

    // Get deployment info
    let deploymentId = session.deploymentId;
    if (!deploymentId) {
        const deploymentsURL = `${baseUrl}/cloudhub/api/v2/applications/${session.applicationDomain}/deployments?orderByDate=DESC`;

        const deploymentsResponse = await apiHelper.get(deploymentsURL, {
            headers: {
                'X-ANYPNT-ENV-ID': session.environmentId,
                'X-ANYPNT-ORG-ID': organizationID,
            }
        });
        deploymentId = deploymentsResponse.data.data[0].deploymentId;
    }

    // Fetch logs for a longer time period (last 24 hours or more)
    const endTime = Date.now();
    const startTime = endTime - (7 * 24 * 60 * 60 * 1000); // Last 7 days

    const logsURL = `${baseUrl}/cloudhub/api/v2/applications/${session.applicationDomain}/deployments/${deploymentId}/logs?startTime=${startTime}&endTime=${endTime}&limit=2000`;
    
    const logsResponse = await apiHelper.get(logsURL, {
        headers: {
            'X-ANYPNT-ENV-ID': session.environmentId,
            'X-ANYPNT-ORG-ID': organizationID,
        }
    });
    const logsData = logsResponse.data;
    const logs = Array.isArray(logsData.data) ? logsData.data : Array.isArray(logsData) ? logsData : [];
    
    return logs.sort((a: LogEntry, b: LogEntry) => a.timestamp - b.timestamp);
}

/**
 * Fetch all available CloudHub 2.0 logs for export
 */
async function fetchFullCH2Logs(session: RealTimeLogSession): Promise<LogEntry[]> {
    console.log('Export: Starting fetchFullCH2Logs');
    const context = session.context;
    const accountService = new AccountService(context);

    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        throw new Error('No active account found. Please log in.');
    }

    let accessToken = await accountService.getActiveAccountAccessToken();
    if (!accessToken) {
        throw new Error('No access token found for active account');
    }

    // Use effective organization ID to respect selected business group
    const organizationID = await accountService.getEffectiveOrganizationId() || activeAccount.organizationId;

    // Get region-specific base URL
    const regionId = activeAccount.region || 'us';
    const baseUrl = await getBaseUrl(context);

    console.log('Export: Region:', regionId);
    console.log('Export: Base URL:', baseUrl);
    console.log('Export: Organization ID:', organizationID);
    console.log('Export: Environment ID:', session.environmentId);
    console.log('Export: Deployment ID:', session.deploymentId);
    console.log('Export: Specification ID:', session.specificationId);

    if (!session.deploymentId || !session.specificationId) {
        throw new Error('CloudHub 2.0 requires deploymentId and specificationId');
    }

    // Fetch logs for last 7 days to get more comprehensive data (API might limit longer periods)
    const endTimeMs = Date.now();
    const startTimeMs = endTimeMs - (7 * 24 * 60 * 60 * 1000); // Last 7 days

    console.log('Export: Time range:', new Date(startTimeMs).toISOString(), 'to', new Date(endTimeMs).toISOString());
    
    // CloudHub 2.0 API appears to have a hard limit of 10 logs per request
    // We need to use pagination to get all logs
    console.log('Export: CH2 API has 10-log limit, implementing pagination');
    
    const allLogs: LogEntry[] = [];
    const pageSize = 10; // API hard limit observed
    const maxLogs = 2000; // Maximum logs to export
    let offset = 0;
    let hasMoreLogs = true;
    let totalFetched = 0;
    
    // Send initial progress update to UI
    session.panel.webview.postMessage({
        command: 'exportProgress',
        message: `Starting log export (max ${maxLogs} logs)...`,
        offset: 0,
        totalLogs: 0
    });
    
    // Fetch logs in pages until we get all available logs or hit the limit
    while (hasMoreLogs && totalFetched < maxLogs && offset < 50000) { // Safety limits
        console.log(`Export: Fetching page with offset ${offset}`);
        
        // Send progress update to UI
        session.panel.webview.postMessage({
            command: 'exportProgress',
            message: `Fetching logs... (${totalFetched}/${maxLogs})`,
            offset: offset,
            totalLogs: totalFetched
        });
        
        const queryParams = new URLSearchParams();
        queryParams.append('limit', pageSize.toString());
        queryParams.append('offset', offset.toString());
        queryParams.append('startTime', startTimeMs.toString());
        queryParams.append('endTime', endTimeMs.toString());

        // Use region-specific base URL
        const logsURL = `${baseUrl}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${session.environmentId}/deployments/${session.deploymentId}/specs/${session.specificationId}/logs?${queryParams.toString()}`;

        console.log(`Export: Fetching page URL: ${logsURL}`);
        
        // Retry logic for failed requests
        let retryCount = 0;
        const maxRetries = 3;
        let response: Response | null = null;
        let lastError: string = '';
        
        while (retryCount <= maxRetries) {
            try {
                response = await fetch(logsURL, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                console.log(`Export: Page ${Math.floor(offset/pageSize) + 1} response status:`, response.status);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Export: Error response for offset ${offset}:`, errorText);
                    
                    if (response.status === 401) {
                        // Refresh token and retry this page
                        console.log(`Export: Token expired, refreshing...`);
                        session.panel.webview.postMessage({
                            command: 'exportProgress',
                            message: `Refreshing authentication token...`,
                            offset: offset,
                            totalLogs: totalFetched
                        });
                        
                        const didRefresh = await refreshAccessToken(context, activeAccount.id);
                        if (!didRefresh) {
                            throw new Error('Unable to refresh token');
                        }
                        accessToken = await accountService.getActiveAccountAccessToken();
                        if (!accessToken) {
                            throw new Error('Failed to get refreshed access token');
                        }
                        retryCount++; // Count token refresh as a retry
                        continue;
                    } else if (response.status >= 500 && retryCount < maxRetries) {
                        // Server error - retry
                        lastError = `Server error: ${response.status} ${response.statusText}`;
                        console.log(`Export: Server error at offset ${offset}, retrying (${retryCount + 1}/${maxRetries + 1})...`);
                        session.panel.webview.postMessage({
                            command: 'exportProgress',
                            message: `Server error, retrying... (${retryCount + 1}/${maxRetries + 1})`,
                            offset: offset,
                            totalLogs: totalFetched
                        });
                        retryCount++;
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                        continue;
                    } else {
                        throw new Error(`Failed to fetch CH2 logs at offset ${offset}: ${response.status} ${response.statusText}`);
                    }
                }
                
                // Success - break out of retry loop
                break;
                
            } catch (error: any) {
                lastError = error.message;
                console.error(`Export: Network error at offset ${offset}:`, error);
                
                if (retryCount < maxRetries) {
                    console.log(`Export: Network error, retrying (${retryCount + 1}/${maxRetries + 1})...`);
                    session.panel.webview.postMessage({
                        command: 'exportProgress',
                        message: `Network error, retrying... (${retryCount + 1}/${maxRetries + 1})`,
                        offset: offset,
                        totalLogs: totalFetched
                    });
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                    continue;
                } else {
                    throw new Error(`Failed to fetch logs after ${maxRetries + 1} attempts: ${lastError}`);
                }
            }
        }

        const logsData = await response!.json();
        const logsArray = Array.isArray(logsData) ? logsData : [];
        console.log(`Export: Page ${Math.floor(offset/pageSize) + 1} returned ${logsArray.length} logs`);
        
        if (logsArray.length === 0) {
            console.log(`Export: No more logs available at offset ${offset}`);
            session.panel.webview.postMessage({
                command: 'exportProgress',
                message: 'No more logs found, completing export...',
                offset: offset,
                totalLogs: totalFetched
            });
            hasMoreLogs = false;
            break;
        }
        
        // Process this page of logs
        const processedLogs = processCH2LogsResponseForExport(logsArray);
        console.log(`Export: Page ${Math.floor(offset/pageSize) + 1} processed ${processedLogs.length} logs`);
        
        // Check if adding these logs would exceed the limit
        const logsToAdd = Math.min(processedLogs.length, maxLogs - allLogs.length);
        allLogs.push(...processedLogs.slice(0, logsToAdd));
        totalFetched += logsArray.length;
        
        // Send progress update with current totals
        const isAtLimit = allLogs.length >= maxLogs;
        session.panel.webview.postMessage({
            command: 'exportProgress',
            message: isAtLimit ? `Reached limit: ${allLogs.length}/${maxLogs} logs` : `Downloaded ${allLogs.length}/${maxLogs} logs...`,
            offset: offset,
            totalLogs: allLogs.length
        });
        
        // Check if we've reached the maximum logs limit
        if (allLogs.length >= maxLogs) {
            console.log(`Export: Reached maximum log limit of ${maxLogs}`);
            session.panel.webview.postMessage({
                command: 'exportProgress',
                message: `Export limited to ${maxLogs} logs (maximum allowed)`,
                offset: offset,
                totalLogs: allLogs.length
            });
            hasMoreLogs = false;
        }
        
        // Check if we got fewer logs than expected (end of data)
        if (logsArray.length < pageSize) {
            console.log(`Export: Received ${logsArray.length} logs (less than page size ${pageSize}), reached end`);
            session.panel.webview.postMessage({
                command: 'exportProgress',
                message: 'Reached end of logs, completing export...',
                offset: offset,
                totalLogs: totalFetched
            });
            hasMoreLogs = false;
        } else {
            offset += pageSize;
        }
        
        // Add a small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Send final progress update
    const limitReached = allLogs.length >= maxLogs;
    const finalMessage = limitReached 
        ? `Export complete! Limited to ${allLogs.length} logs (max allowed)`
        : `Export complete! Downloaded ${allLogs.length} logs.`;
        
    session.panel.webview.postMessage({
        command: 'exportProgress',
        message: finalMessage,
        offset: offset,
        totalLogs: allLogs.length
    });
    
    console.log(`Export: Pagination complete. Total raw logs fetched: ${totalFetched}, total processed logs: ${allLogs.length}`);
    return allLogs;
}

/**
 * Set refresh rate for log streaming
 */
async function setRefreshRate(session: RealTimeLogSession, rate: number) {
    session.refreshRate = rate;
    
    if (session.intervalId) {
        clearInterval(session.intervalId);
        session.intervalId = null;
    }

    if (session.isStreaming) {
        // Restart streaming with new rate
        await startLogStreaming(session.context, session);
    }
}

/**
 * Strip outer <script> tags so banner script can be merged into webview script bundle.
 */
const stripOuterScriptTags = stripScriptTags;

function getRealTimeLogsExtraStyles(): string {
    return `
        /* ── Page ──────────────────────────────────────────────────────── */
        .rtl-page { max-width: 1200px; margin: 0 auto; padding: 36px 40px; animation: rtl-fadeIn 0.4s ease-out; }
        @keyframes rtl-fadeIn { from { opacity: 0; } to { opacity: 1; } }

        /* ── Header ────────────────────────────────────────────────────── */
        .rtl-header {
            display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px;
        }
        .rtl-title {
            font-size: 26px; font-weight: 300; letter-spacing: -0.5px;
            color: var(--am-text-primary); margin: 0 0 8px 0;
        }
        .rtl-meta {
            display: flex; gap: 8px;
            font-size: 10px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.8px; color: var(--am-text-muted);
        }
        .rtl-meta span::after { content: '\\00b7'; margin-left: 6px; }
        .rtl-meta span:last-child::after { content: ''; margin: 0; }

        .rtl-header-right { display: flex; align-items: center; }
        .rtl-status-pill {
            display: flex; align-items: center; gap: 8px;
            font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px;
            color: var(--am-text-muted);
        }
        .rtl-status-dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: var(--am-text-muted); opacity: 0.4;
        }
        .rtl-status-dot.streaming {
            background: var(--am-success); opacity: 1;
            animation: am-pulse 2s infinite;
        }

        /* ── Stats strip (matches Command Center hero) ─────────────── */
        .rtl-hero { margin-bottom: 32px; }
        .rtl-stats { display: flex; flex-wrap: wrap; gap: 36px; }
        .rtl-stat-label {
            font-size: 10px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.8px; color: var(--am-text-muted); margin-bottom: 4px;
        }
        .rtl-stat-value {
            font-size: 17px; font-weight: 500; color: var(--am-text-primary);
        }

        /* ── Toolbar (icon buttons like CC) ─────────────────────────── */
        .rtl-toolbar {
            display: flex; gap: 6px; padding: 8px 0; margin-bottom: 24px;
            border-bottom: 1px solid var(--am-border); align-items: center; flex-wrap: wrap;
        }
        .rtl-toolbar-group { display: flex; gap: 4px; align-items: center; }
        .rtl-toolbar-sep { width: 1px; background: var(--am-border); margin: 4px 10px; align-self: stretch; }
        .rtl-tool-btn {
            background: none; border: 1px solid transparent; border-radius: var(--am-radius-sm);
            color: var(--am-text-muted); width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: all 0.15s; position: relative; font-family: inherit;
        }
        .rtl-tool-btn:hover:not(:disabled) { color: var(--am-text-primary); border-color: var(--am-border); background: var(--am-bg-surface); }
        .rtl-tool-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .rtl-tool-btn svg { width: 15px; height: 15px; }
        .rtl-tool-start { color: var(--am-success); }
        .rtl-tool-start:hover:not(:disabled) { color: var(--am-success); border-color: var(--am-success); background: color-mix(in srgb, var(--am-success) 8%, transparent); }

        .rtl-tool-btn[title]:hover::after {
            content: attr(title);
            position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
            padding: 4px 8px; font-size: 10px; white-space: nowrap;
            background: var(--am-bg-secondary); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm); color: var(--am-text-primary);
            margin-top: 4px; z-index: 10;
        }

        .rtl-select {
            background: transparent; border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm); color: var(--am-text-secondary);
            font-size: 11px; font-weight: 600; padding: 6px 10px;
            cursor: pointer; font-family: inherit;
        }
        .rtl-select:focus { border-color: var(--am-info); outline: none; }

        .rtl-search-wrap {
            flex: 1; max-width: 360px; position: relative; margin-left: auto;
        }
        .rtl-search-icon {
            position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
            color: var(--am-text-muted); pointer-events: none;
        }
        .rtl-search-input {
            width: 100%; background: transparent; border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm); color: var(--am-text-primary);
            font-size: 12px; padding: 7px 32px 7px 32px; font-family: inherit;
        }
        .rtl-search-input::placeholder { color: var(--am-text-muted); }
        .rtl-search-input:focus { border-color: var(--am-info); outline: none; }
        .rtl-search-clear {
            position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
            background: none; border: none; color: var(--am-text-muted); cursor: pointer;
            font-size: 14px; padding: 4px 6px; font-family: inherit;
        }
        .rtl-search-clear:hover { color: var(--am-text-primary); }

        /* ── Export progress ────────────────────────────────────────── */
        .rtl-export-progress {
            padding: 12px 16px; margin-bottom: 16px;
            background: var(--am-bg-surface); border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm); animation: rtl-fadeIn 0.3s ease;
        }
        .rtl-progress-content { display: flex; align-items: center; gap: 12px; }
        .rtl-progress-spinner {
            width: 16px; height: 16px; border: 2px solid var(--am-border);
            border-top-color: var(--am-text-secondary); border-radius: 50%;
            animation: rtl-spin 1s linear infinite;
        }
        @keyframes rtl-spin { to { transform: rotate(360deg); } }
        .rtl-progress-message { font-weight: 500; font-size: 12px; color: var(--am-text-primary); }
        .rtl-progress-details { font-size: 11px; color: var(--am-text-muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }

        /* ── Log panel ─────────────────────────────────────────────── */
        .rtl-panel {
            border: 1px solid var(--am-border); border-radius: var(--am-radius-sm);
            overflow: hidden; display: flex; flex-direction: column;
            height: calc(100vh - 320px); min-height: 400px;
        }
        .rtl-panel-bar {
            display: flex; justify-content: space-between; align-items: center;
            padding: 10px 20px; border-bottom: 1px solid var(--am-border);
            flex-wrap: wrap; gap: 8px;
        }
        .rtl-panel-stats {
            font-size: 11px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.6px; color: var(--am-text-muted);
        }
        .status-message {
            font-size: 11px; font-weight: 600; letter-spacing: 0.4px;
            padding: 4px 10px; border-radius: var(--am-radius-sm); transition: all 0.3s ease;
        }
        .status-message.success { color: var(--am-success); background: color-mix(in srgb, var(--am-success) 10%, transparent); }
        .status-message.info { color: var(--am-text-secondary); background: color-mix(in srgb, var(--am-info) 8%, transparent); }
        .status-message.error { color: var(--am-error); background: color-mix(in srgb, var(--am-error) 10%, transparent); }

        .rtl-logs-content { flex: 1; overflow-y: auto; }

        /* ── Log entries ───────────────────────────────────────────── */
        .log-entry {
            padding: 8px 20px;
            border-bottom: 1px solid color-mix(in srgb, var(--am-border) 40%, transparent);
            font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
            font-size: 12px; line-height: 1.5;
            display: flex; align-items: flex-start; gap: 12px;
            transition: background-color 0.1s;
        }
        .log-entry:hover { background: var(--am-bg-surface-hover); }
        .log-entry:last-child { border-bottom: none; }

        .log-timestamp {
            color: var(--am-text-muted); white-space: nowrap; min-width: 170px; font-size: 11px;
        }
        .log-level {
            min-width: 44px; font-weight: 600; text-align: center;
            font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
            padding: 1px 6px; border-radius: 3px;
        }
        .log-level.ERROR { color: var(--am-error); background: color-mix(in srgb, var(--am-error) 12%, transparent); }
        .log-level.WARN  { color: var(--am-warning); background: color-mix(in srgb, var(--am-warning) 12%, transparent); }
        .log-level.INFO  { color: var(--am-text-secondary); background: color-mix(in srgb, var(--am-text-secondary) 10%, transparent); }
        .log-level.DEBUG { color: var(--am-text-muted); background: color-mix(in srgb, var(--am-text-muted) 8%, transparent); }

        .log-message {
            flex: 1; word-break: break-word; white-space: pre-wrap;
            color: var(--am-text-primary); font-size: 12px;
        }

        /* ── Empty / error states ──────────────────────────────────── */
        .rtl-empty-state {
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; height: 100%;
            color: var(--am-text-muted); text-align: center; padding: 40px 20px;
        }
        .rtl-empty-state p { font-size: 13px; margin: 0; font-weight: 400; }
        .rtl-empty-state strong { color: var(--am-success); }

        .rtl-error-banner {
            background: color-mix(in srgb, var(--am-error) 12%, transparent);
            color: var(--am-error); padding: 10px 16px; margin: 8px 16px;
            border-radius: var(--am-radius-sm); font-size: 12px; font-weight: 500;
        }

        /* ── FIRE actions ──────────────────────────────────────────── */
        .log-entry-actionable { border-left: 2px solid var(--am-error); }
        .fire-actions { display: inline-flex; gap: 4px; margin-left: 8px; vertical-align: middle; }
        .fire-btn {
            padding: 1px 8px; font-size: 10px; font-weight: 600;
            border-radius: 3px; border: 1px solid; cursor: pointer;
            transition: opacity 0.15s; font-family: inherit; text-transform: uppercase; letter-spacing: 0.3px;
        }
        .fire-btn:hover { opacity: 0.75; }
        .fire-jump { border-color: var(--am-text-muted); color: var(--am-text-secondary); background: transparent; }
        .fire-replay { border-color: var(--am-text-muted); color: var(--am-text-secondary); background: transparent; }
        .fire-hypothesis {
            margin-top: 4px; padding: 6px 10px;
            border-left: 2px solid var(--am-error);
            border-radius: 0 3px 3px 0; font-size: 11px; line-height: 1.5;
        }
        .fire-hypothesis-title { font-weight: 600; color: var(--am-error); margin-bottom: 2px; }
        .fire-hypothesis-suggestion { color: var(--am-text-muted); }

        /* ── Responsive ────────────────────────────────────────────── */
        @media (max-width: 768px) {
            .rtl-page { padding: 20px; }
            .rtl-stats { gap: 24px; }
            .rtl-toolbar { flex-direction: column; align-items: stretch; }
            .rtl-search-wrap { max-width: none; margin-left: 0; }
        }

        ${getGitHubStarBannerStyles()}
    `;
}

function getRealTimeLogsWebviewScript(): string {
    return `
        console.log('Real-time logs: Script starting to load');
        
        try {
            const vscode = acquireVsCodeApi();
            console.log('Real-time logs: VSCode API acquired');
            
            let logs = [];
            let filteredLogs = [];
            let isStreaming = false;
            let startTime = null;
            let searchTerm = '';
            
            console.log('Real-time logs: Variables initialized');
        
            console.log('Real-time logs: Finding DOM elements');
            
            const elements = {
                startBtn: document.getElementById('startBtn'),
                stopBtn: document.getElementById('stopBtn'),
                clearBtn: document.getElementById('clearBtn'),
                exportBtn: document.getElementById('exportBtn'),
                searchInput: document.getElementById('searchInput'),
                searchBtn: document.getElementById('searchBtn'),
                refreshRate: document.getElementById('refreshRate'),
                statusDot: document.getElementById('statusDot'),
                statusText: document.getElementById('statusText'),
                logsContent: document.getElementById('logsContent'),
                totalCount: document.getElementById('totalCount'),
                filteredCount: document.getElementById('filteredCount'),
                startTimeEl: document.getElementById('startTime'),
                statusMessage: document.getElementById('statusMessage')
            };
            
            console.log('Real-time logs: DOM elements found, checking export button specifically');
            console.log('Export button element:', elements.exportBtn);
            console.log('Export button exists:', !!elements.exportBtn);
        
            // Event listeners
            console.log('Real-time logs: Attaching event listeners');
            elements.logsContent.addEventListener('click', (e) => {
                const jumpBtn = e.target.closest('[data-fire-jump]');
                const replayBtn = e.target.closest('[data-fire-replay]');
                if (jumpBtn) {
                    const logIndex = parseInt(jumpBtn.getAttribute('data-fire-jump'));
                    console.log('FIRE: Jump to source for log index:', logIndex);
                    showStatusMessage('⟶ Locating source file...', 'info', 3000);
                    vscode.postMessage({ command: 'jumpToSource', logIndex });
                }
                if (replayBtn) {
                    const logIndex = parseInt(replayBtn.getAttribute('data-fire-replay'));
                    console.log('FIRE: Replay failure for log index:', logIndex);
                    showStatusMessage('↺ Building replay session...', 'info', 3000);
                    vscode.postMessage({ command: 'replayFailure', logIndex });
                }
            });
            
            elements.startBtn.addEventListener('click', () => {
                console.log('Start button clicked');
                vscode.postMessage({ command: 'startStreaming' });
                startTime = new Date();
                elements.startTimeEl.textContent = startTime.toLocaleTimeString();
                const startTimeHeader = document.getElementById('startTimeHeader');
                if (startTimeHeader) startTimeHeader.textContent = startTime.toLocaleTimeString();
            });
            
            elements.stopBtn.addEventListener('click', () => {
                console.log('Stop button clicked');
                vscode.postMessage({ command: 'stopStreaming' });
            });
            
            elements.clearBtn.addEventListener('click', () => {
                console.log('Clear button clicked');
                vscode.postMessage({ command: 'clearLogs' });
                logs = [];
                filteredLogs = [];
                renderLogs();
                updateStats();
            });
            
            
            console.log('Real-time logs: Attaching export button event listener');
            console.log('Export button element found:', !!elements.exportBtn);

            
            
            if (elements.exportBtn) {
                // Add a simple click test first
                elements.exportBtn.addEventListener('click', (event) => {
                    console.log('🔥 EXPORT BUTTON CLICKED! Event:', event);
                    console.log('🔥 Button element:', elements.exportBtn);
                    console.log('🔥 Event target:', event.target);
                    
                    // Prevent any default behavior
                    event.preventDefault();
                    event.stopPropagation();
                    
                    // Show immediate feedback
                    alert('Export button was clicked! Check console for details.');
                    
                    console.log('Starting full log export process');
                    
                    // For now, let's just test with a simple format selection
                    const format = 'json'; // Hard-code for testing
                    console.log('Using hardcoded JSON format for testing');
                    
                    console.log('Sending export message to extension with format:', format);
                    showStatusMessage('📥 Fetching all application logs for export...', 'info', 2000);
                    
                    try {
                        vscode.postMessage({ command: 'exportLogs', format });
                        console.log('Export message sent successfully');
                    } catch (error) {
                        console.error('Error sending message:', error);
                    }
                });
                console.log('Real-time logs: Export button event listener attached');
            } else {
                console.error('Real-time logs: Export button element not found!');
            }

            
        
        elements.searchInput.addEventListener('input', (e) => {
            searchTerm = e.target.value.toLowerCase();
            applyFilter();
        });
        
        elements.searchBtn.addEventListener('click', () => {
            applyFilter();
        });
        
        elements.refreshRate.addEventListener('change', (e) => {
            vscode.postMessage({ command: 'setRefreshRate', rate: parseInt(e.target.value) });
        });
        
        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'streamingStatus':
                    updateStreamingStatus(message.isStreaming);
                    break;
                case 'newLogs':
                    addNewLogs(message.logs);
                    break;
                case 'clearLogs':
                    logs = [];
                    filteredLogs = [];
                    renderLogs();
                    updateStats();
                    break;
                case 'error':
                    showError(message.message);
                    showStatusMessage(\`❌ Error: \${message.message}\`, 'error', 5000);
                    break;
                case 'exportProgress':
                    showExportProgress(message.message, message.offset, message.totalLogs);
                    break;
                case 'exportComplete':
                    hideExportProgress();
                    showStatusMessage(\`✅ All application logs exported successfully as \${message.format.toUpperCase()}\`, 'success', 4000);
                    break;
                case 'replaySessionReady':
                    showStatusMessage('↺ Replay debugger opening...', 'success', 3000);
                    break;
                case 'replaySessionFailed':
                    showStatusMessage('↺ Could not build replay session — not enough log context', 'error', 4000);
                    break;
                case 'jumpToSourceFailed':
                    showStatusMessage('⟶ Source not found — is the Mule project open in VS Code?', 'error', 4000);
                    break;
            }
        });
        
        function updateStreamingStatus(streaming) {
            isStreaming = streaming;
            elements.statusDot.classList.toggle('streaming', streaming);
            elements.statusText.textContent = streaming ? 'Streaming' : 'Stopped';
            elements.startBtn.disabled = streaming;
            elements.stopBtn.disabled = !streaming;
            
            // Update stats card
            const streamStatusEl = document.getElementById('streamStatus');
            if (streamStatusEl) {
                streamStatusEl.textContent = streaming ? 'Active' : 'Stopped';
            }
            
            // Show status message
            if (streaming) {
                showStatusMessage('🟢 Real-time log streaming started', 'success');
            } else {
                showStatusMessage('🔴 Real-time log streaming stopped', 'info');
            }
        }
        
        function showStatusMessage(message, type = 'info', duration = 3000) {
            elements.statusMessage.textContent = message;
            elements.statusMessage.className = \`status-message \${type}\`;
            
            // Auto-hide after duration
            setTimeout(() => {
                elements.statusMessage.textContent = '';
                elements.statusMessage.className = 'status-message';
            }, duration);
        }
        
        function showExportProgress(message, offset, totalLogs) {
            const progressDiv = document.getElementById('exportProgress');
            if (progressDiv) {
                progressDiv.style.display = 'block';
                progressDiv.innerHTML = \`
                    <div class="rtl-progress-content">
                        <div class="rtl-progress-spinner"></div>
                        <div class="rtl-progress-text">
                            <div class="rtl-progress-message">\${message}</div>
                            <div class="rtl-progress-details">Offset: \${offset} | Total logs: \${totalLogs}</div>
                        </div>
                    </div>
                \`;
            }
        }
        
        function hideExportProgress() {
            const progressDiv = document.getElementById('exportProgress');
            if (progressDiv) {
                progressDiv.style.display = 'none';
                progressDiv.innerHTML = '';
            }
        }
        
        function addNewLogs(newLogs) {
            const logsContainer = elements.logsContent;
            const wasAtBottom = logsContainer.scrollTop + logsContainer.clientHeight >= logsContainer.scrollHeight - 50;
            
            newLogs.forEach(log => logs.push(log));
            applyFilter();
            
            // Auto-scroll to bottom if user was already at bottom
            if (wasAtBottom) {
                setTimeout(() => {
                    logsContainer.scrollTop = logsContainer.scrollHeight;
                }, 100);
            }
        }
        
        function applyFilter() {
            if (!searchTerm.trim()) {
                filteredLogs = [...logs];
            } else {
                filteredLogs = logs.filter(log => 
                    (log.message || '').toLowerCase().includes(searchTerm) ||
                    (log.priority || '').toLowerCase().includes(searchTerm) ||
                    (log.threadName || '').toLowerCase().includes(searchTerm)
                );
            }
            renderLogs();
            updateStats();
        }
        
        function renderLogs() {
            const container = elements.logsContent;
            if (filteredLogs.length === 0) {
                container.innerHTML = \`
                    <div class="rtl-empty-state">
                        <div class="rtl-empty-state-icon">\${logs.length === 0 ? '📋' : '🔍'}</div>
                        <p>\${logs.length === 0 ? 'No logs yet. Waiting for new log entries...' : 'No logs match your filter criteria'}</p>
                    </div>
\`;
                return;
            }
            const logsHtml = filteredLogs.slice(-500).map((log, index) => {
                const timestamp = new Date(log.timestamp).toISOString().replace('T', ' ').replace('Z', '');
                const level = (log.priority || 'INFO').toUpperCase();
                const message = (log.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const isActionable = /[A-Z]{2,}:[A-Z]{2,}/.test(log.message || '') &&
                                    /(Error type|MULE:|HTTP:|DB:|FTP:|SFTP:|FlowStack|error\.description|ERROR in )/i.test(log.message || '');
                const globalIndex = logs.indexOf(log);
const fireButtons = isActionable ? \`
                    <div class="fire-actions">
                        <button class="fire-btn fire-jump" data-fire-jump="\${globalIndex}" title="Jump to failing component in source XML">
                            ⟶ Jump to Source
                        </button>
                        <button class="fire-btn fire-replay" data-fire-replay="\${globalIndex}" title="Load real payload and DataWeave script for debugging">
                            ↺ Replay Failure
                        </button>
                    </div>\` : '';
                return \`
                    <div class="log-entry \${isActionable ? 'log-entry-actionable' : ''}">
                        <div class="log-timestamp">\${timestamp}</div>
                        <div class="log-level \${level}">\${level}</div>
                        <div class="log-message">\${message}\${fireButtons}</div>
                    </div>
\`;
            }).join('');
            container.innerHTML = logsHtml;
        }
        
        function updateStats() {
            elements.totalCount.textContent = logs.length;
            elements.filteredCount.textContent = filteredLogs.length;
            
            // Update header stats as well
            const totalCountHeader = document.getElementById('totalCountHeader');
            const filteredCountHeader = document.getElementById('filteredCountHeader');
            if (totalCountHeader) totalCountHeader.textContent = logs.length;
            if (filteredCountHeader) filteredCountHeader.textContent = filteredLogs.length;
        }

        function showError(message) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'rtl-error-banner';
            errorDiv.textContent = message;
            document.body.insertBefore(errorDiv, document.body.firstChild);
            
            setTimeout(() => {
                errorDiv.remove();
            }, 5000);
        }
        
        function showFormatDialog() {
            return new Promise((resolve) => {
                console.log('Showing format selection prompt');
                const format = prompt('Export all application logs in which format?\\n\\n1. JSON - Structured data format\\n2. TXT - Human-readable text\\n3. CSV - Spreadsheet format\\n\\nEnter 1, 2, or 3 (or cancel to abort):\\n\\nNote: This will export ALL logs from the last 7 days, not just the currently streamed logs.');
                console.log('User input from prompt:', format);
                
                switch(format?.trim()) {
                    case '1': 
                        console.log('User selected JSON format');
                        resolve('json'); 
                        break;
                    case '2': 
                        console.log('User selected TXT format');
                        resolve('txt'); 
                        break;
                    case '3': 
                        console.log('User selected CSV format');
                        resolve('csv'); 
                        break;
                    default: 
                        console.log('User cancelled or entered invalid option');
                        resolve(null);
                }
            });
        }
        
            // Initialize
            console.log('Real-time logs: Initializing');
            updateStats();



            
            
            // Debug: Check if all elements are found
            console.log('Export button element:', elements.exportBtn);
            console.log('All elements found:', {
                startBtn: !!elements.startBtn,
                stopBtn: !!elements.stopBtn,
                clearBtn: !!elements.clearBtn,
                exportBtn: !!elements.exportBtn,
                searchInput: !!elements.searchInput,
                searchBtn: !!elements.searchBtn,
                refreshRate: !!elements.refreshRate,
                statusDot: !!elements.statusDot,
                statusText: !!elements.statusText,
                logsContent: !!elements.logsContent,
                totalCount: !!elements.totalCount,
                filteredCount: !!elements.filteredCount,
                startTimeEl: !!elements.startTimeEl,
                statusMessage: !!elements.statusMessage
            });
            
            console.log('Real-time logs: Script loaded successfully');
        } catch (error) {
            console.error('Real-time logs: Script error:', error);
            console.error('Error stack:', error.stack);
        }

    `;
}

/**
 * Generate HTML for real-time logs viewer
 */
function getRealTimeLogsHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    applicationDomain: string,
    cloudhubVersion: 'CH1' | 'CH2' | 'HYBRID' = 'CH1'
): string {
    const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
    const logoSrc = webview.asWebviewUri(logoPath);
    const chLabel =
        cloudhubVersion === 'CH1' ? 'CloudHub 1.0' :
        cloudhubVersion === 'CH2' ? 'CloudHub 2.0' :
        'Hybrid';

    const body = `
<div class="rtl-page">
    <!-- Header -->
    <div class="rtl-header">
        <div>
            <h1 class="rtl-title">${escapeHtml(applicationDomain)}</h1>
            <div class="rtl-meta">
                <span>${chLabel.toUpperCase()}</span>
                <span>REAL-TIME LOGS</span>
            </div>
        </div>
        <div class="rtl-header-right">
            <div class="rtl-status-pill" id="statusPill">
                <div class="rtl-status-dot" id="statusDot"></div>
                <span id="statusText">Stopped</span>
            </div>
        </div>
    </div>

    <!-- Stats strip -->
    <div class="rtl-hero">
        <div class="rtl-stats">
            <div class="rtl-stat">
                <div class="rtl-stat-label">TOTAL</div>
                <div class="rtl-stat-value" id="totalCount">0</div>
            </div>
            <div class="rtl-stat">
                <div class="rtl-stat-label">FILTERED</div>
                <div class="rtl-stat-value" id="filteredCount">0</div>
            </div>
            <div class="rtl-stat">
                <div class="rtl-stat-label">STATUS</div>
                <div class="rtl-stat-value" id="streamStatus">Idle</div>
            </div>
            <div class="rtl-stat">
                <div class="rtl-stat-label">SINCE</div>
                <div class="rtl-stat-value" id="startTime">&mdash;</div>
            </div>
        </div>
    </div>

    <!-- Toolbar -->
    <div class="rtl-toolbar">
        <div class="rtl-toolbar-group">
            <button type="button" class="rtl-tool-btn rtl-tool-start" id="startBtn" title="Start Streaming">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            </button>
            <button type="button" class="rtl-tool-btn" id="stopBtn" title="Stop" disabled>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            </button>
            <button type="button" class="rtl-tool-btn" id="clearBtn" title="Clear">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/></svg>
            </button>
            <div class="rtl-toolbar-sep"></div>
            <button type="button" class="rtl-tool-btn" id="exportBtn" title="Export Logs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21,15v4a2,2,0,0,1-2,2H5a2,2,0,0,1-2-2V15"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
        </div>
        <div class="rtl-toolbar-group">
            <select id="refreshRate" class="rtl-select">
                <option value="1000">1 s</option>
                <option value="2000" selected>2 s</option>
                <option value="5000">5 s</option>
                <option value="10000">10 s</option>
            </select>
        </div>
        <div class="rtl-search-wrap">
            <svg class="rtl-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="rtl-search-input" id="searchInput" placeholder="Filter by message, level, or thread…" />
            <button type="button" class="rtl-search-clear" id="searchBtn" title="Apply">&crarr;</button>
        </div>
    </div>

    <!-- Export progress -->
    <div id="exportProgress" class="rtl-export-progress" style="display: none;"></div>

    <!-- Log panel -->
    <div class="rtl-panel">
        <div class="rtl-panel-bar">
            <span class="rtl-panel-stats">
                <span id="totalCountHeader">0</span> total &middot;
                <span id="filteredCountHeader">0</span> visible &middot;
                since <span id="startTimeHeader">&mdash;</span>
            </span>
            <div id="statusMessage" class="status-message"></div>
        </div>
        <div class="rtl-logs-content" id="logsContent">
            <div class="rtl-empty-state">
                <p>Press <strong>&#9654;</strong> to begin streaming</p>
            </div>
        </div>
    </div>
</div>
${getGitHubStarBannerHtml()}
`;

    return wrapWebviewHtml({
        title: `Real-Time Logs - ${applicationDomain}`,
        body,
        extraStyles: getRealTimeLogsExtraStyles(),
        scripts: `${getRealTimeLogsWebviewScript()}\n${stripOuterScriptTags(getGitHubStarBannerScript())}`,
    });
}
