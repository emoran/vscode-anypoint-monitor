// applicationDetailsCH2.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import {getCH2Deployments } from './cloudhub2Applications';

// ==================== MAIN APPLICATION DETAILS WEBVIEW ====================

// Updated showApplicationDetailsCH2Webview function in applicationDetailsCH2.ts
export async function showApplicationDetailsCH2Webview(
  context: vscode.ExtensionContext,
  appName: string,
  appData: any,
  environmentId: string // FIXED: Changed to accept environment ID directly as string
) {
  console.log('🎯 === SHOW APPLICATION DETAILS CH2 WEBVIEW ===');
  console.log(`📱 Opening application details for: ${appName}`);
  console.log(`🌍 Environment ID: ${environmentId}`);
  console.log(`📊 App data keys:`, Object.keys(appData || {}));
  
  const panel = vscode.window.createWebviewPanel(
    'applicationDetailsCH2',
    `Application Details - ${appName}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Store environment ID in panel context
  (panel as any).environmentId = environmentId;
  console.log(`💾 Stored environment ID in panel: ${environmentId}`);

  // FIXED: Fetch additional data using the correct environment ID
  console.log(`🔍 About to fetch additional data for app: ${appName}`);
  const additionalData = await fetchCH2ApplicationDetails(context, appName, appData, environmentId);
  console.log(`📋 Additional data fetched:`, {
    logs: additionalData.logs?.length || 0,
    schedulers: additionalData.schedulers?.length || 0,
    alerts: additionalData.alerts?.length || 0,
    deploymentId: additionalData.deploymentId,
    specificationId: additionalData.specificationId,
    error: additionalData.error
  });

  panel.webview.html = getApplicationDetailsCH2Html(
    appName, 
    appData, 
    additionalData, 
    panel.webview, 
    context.extensionUri
  );

  console.log(`🎨 Webview HTML generated and set for: ${appName}`);
  console.log('✅ === END SHOW APPLICATION DETAILS CH2 WEBVIEW ===');

// Updated message handler in showApplicationDetailsCH2Webview function
// Replace the existing panel.webview.onDidReceiveMessage section with this simplified version:

panel.webview.onDidReceiveMessage(async (message) => {
  try {
    switch (message.command) {
      case 'stopApp':
        const accessTokenStop = await context.secrets.get('anypoint.accessToken');
        if (!accessTokenStop) throw new Error('No access token found. Please log in first.');
        await updateCH2ApplicationStatus(appName, 'stop', accessTokenStop, additionalData.deploymentId);
        vscode.window.showInformationMessage(`Application ${appName} is being stopped...`);
        break;

      case 'startApp':
        const accessTokenStart = await context.secrets.get('anypoint.accessToken');
        if (!accessTokenStart) throw new Error('No access token found. Please log in first.');
        await updateCH2ApplicationStatus(appName, 'start', accessTokenStart, additionalData.deploymentId);
        vscode.window.showInformationMessage(`Application ${appName} is being started...`);
        break;

      case 'restartApp':
        const accessTokenRestart = await context.secrets.get('anypoint.accessToken');
        if (!accessTokenRestart) throw new Error('No access token found. Please log in first.');
        await updateCH2ApplicationStatus(appName, 'restart', accessTokenRestart, additionalData.deploymentId);
        vscode.window.showInformationMessage(`Application ${appName} is being restarted...`);
        break;

      case 'downloadAppData':
        const csvData = generateCH2ApplicationDetailsCsv(appData);
        if (!csvData) {
          vscode.window.showInformationMessage('No application data to export.');
          return;
        }
        const appUri = await vscode.window.showSaveDialog({
          filters: { 'CSV Files': ['csv'] },
          saveLabel: 'Save as CSV',
          defaultUri: vscode.Uri.file(`${appName}-details-${new Date().toISOString().split('T')[0]}.csv`)
        });
        if (appUri) {
          fs.writeFileSync(appUri.fsPath, csvData, 'utf-8');
          vscode.window.showInformationMessage(`CSV file saved to ${appUri.fsPath}`);
        }
        break;

      case 'downloadLogs':
        const logs = additionalData.logs || [];
        if (logs.length === 0) {
          vscode.window.showInformationMessage('No log data to export.');
          return;
        }

        const format = await vscode.window.showQuickPick(
          [
            { label: 'JSON', description: 'Structured JSON format', value: 'json' },
            { label: 'Text', description: 'Human-readable text format', value: 'txt' },
            { label: 'CSV', description: 'Comma-separated values', value: 'csv' }
          ],
          { placeHolder: 'Select log file format' }
        );

        if (!format) return;

        const logContent = generateLogContent(logs, format.value as 'json' | 'txt' | 'csv');
        const fileExtension = format.value;
        const defaultFileName = `${appName}-logs-${new Date().toISOString().split('T')[0]}.${fileExtension}`;

        const logUri = await vscode.window.showSaveDialog({
          filters: {
            'JSON Files': ['json'],
            'Text Files': ['txt'],
            'CSV Files': ['csv']
          },
          defaultUri: vscode.Uri.file(defaultFileName),
          saveLabel: 'Save Logs'
        });

        if (logUri) {
          fs.writeFileSync(logUri.fsPath, logContent, 'utf-8');
          vscode.window.showInformationMessage(`Log file saved to ${logUri.fsPath}`);
        }
        break;

      // REMOVED: loadMoreLogs case - no longer needed
      // REMOVED: searchLogs case - since we removed date filtering

      default:
        console.log('Unknown command:', message.command);
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
});
}

// ==================== CLOUDHUB 2.0 API FUNCTIONS ====================

/**
 * Modified getStoredOrgAndEnvInfo to accept optional environment ID
 */
export async function getStoredOrgAndEnvInfo(context: vscode.ExtensionContext, providedEnvId?: string): Promise<{orgId: string, envId: string, environments: any[]}> {
  const storedUserInfo = await context.secrets.get('anypoint.userInfo');
  const storedEnvironments = await context.secrets.get('anypoint.environments');

  if (!storedUserInfo || !storedEnvironments) {
    throw new Error('User info or environment info not found. Please log in first.');
  }

  const userInfo = JSON.parse(storedUserInfo);
  const parsedEnvironments = JSON.parse(storedEnvironments); // { data: [...], total: N }

  return {
    orgId: userInfo.organization.id,
    envId: providedEnvId || parsedEnvironments.data[0]?.id || '', // Use provided env ID or fallback
    environments: parsedEnvironments.data
  };
}

/**
 * Step 2: Get specific deployment details by ID
 */
async function getCH2DeploymentById(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string,
  deploymentId: string
): Promise<any> {
  try {
    const accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
      throw new Error('No access token found. Please log in first.');
    }

    const url = `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;
    
    console.log('Fetching CH2 deployment details from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CloudHub 2.0 deployment details API error:', response.status, errorText);
      throw new Error(`Failed to fetch deployment details: ${response.status} ${response.statusText}`);
    }

    const deploymentData = await response.json();
    console.log('Retrieved deployment details for:', deploymentId);
    return deploymentData;

  } catch (error: any) {
    console.error('Error fetching CloudHub 2.0 deployment details:', error);
    throw error;
  }
}

/**
 * Step 3: Get deployment specs - FIXED to handle version field correctly
 */
async function getCH2DeploymentSpecs(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string,
  deploymentId: string
): Promise<any[]> {
  try {
    const accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
      throw new Error('No access token found. Please log in first.');
    }

    const url = `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs`;
    
    console.log('Fetching CH2 deployment specs from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CloudHub 2.0 deployment specs API error:', response.status, errorText);
      throw new Error(`Failed to fetch deployment specs: ${response.status} ${response.statusText}`);
    }

    const specsData = await response.json();
    console.log('CH2 deployment specs response structure:', Object.keys(specsData as any));
    console.log('Full specs response:', JSON.stringify(specsData, null, 2));

    // FIXED: Handle the actual response structure - specs come as a direct array
    let specs = [];
    if (Array.isArray(specsData)) {
      specs = specsData;
      console.log('✅ Found specs as direct array');
    } else {
      console.error('❌ Expected array but got:', typeof specsData);
      console.error('❌ Available properties:', Object.keys(specsData as any));
      specs = [];
    }

    // IMPORTANT: Transform specs to have 'id' field for compatibility with existing code
    // The API returns 'version' field, but we need 'id' for the getLatestSpec function
    specs = specs.map(spec => ({
      ...spec,
      id: spec.version, // Map version to id for compatibility
      // Keep the original version field as well
      originalVersion: spec.version
    }));

    console.log(`Retrieved ${specs.length} deployment specs`);
    
    // Debug: Log the first spec to see its structure
    if (specs.length > 0) {
      console.log('📋 First spec structure:', Object.keys(specs[0]));
      console.log('📋 First spec sample:', JSON.stringify(specs[0], null, 2));
      console.log('📋 Version/ID mapping:', {
        originalVersion: specs[0].originalVersion,
        mappedId: specs[0].id,
        createdAt: specs[0].createdAt
      });
    }

    return specs;

  } catch (error: any) {
    console.error('Error fetching CloudHub 2.0 deployment specs:', error);
    throw error;
  }
}

/**
 * Step 4: Get logs using deployment ID and specification ID
 */
async function getCH2DeploymentLogs(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string,
  deploymentId: string,
  specificationId: string,
  options: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
    priority?: string[];
    search?: string;
  } = {}
): Promise<any[]> {
  try {
    const accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
      throw new Error('No access token found. Please log in first.');
    }

    // Set default options
    const defaultOptions = {
      limit: 100,
      offset: 0,
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
      endTime: new Date().toISOString(),
    };

    const finalOptions = { ...defaultOptions, ...options };

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('limit', finalOptions.limit.toString());
    queryParams.append('offset', finalOptions.offset.toString());
    queryParams.append('startTime', finalOptions.startTime);
    queryParams.append('endTime', finalOptions.endTime);

    if (finalOptions.priority && finalOptions.priority.length > 0) {
      finalOptions.priority.forEach(p => queryParams.append('priority', p));
    }

    if (finalOptions.search) {
      queryParams.append('search', finalOptions.search);
    }

    const url = `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs/${specificationId}/logs`;
    
    console.log('Fetching CH2 logs from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CloudHub 2.0 logs API error:', response.status, errorText);
      throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
    }

 const logsData = await response.json();
    console.log('CH2 logs response structure:', Object.keys(logsData as any));
    console.log('Full logs response sample:', JSON.stringify(logsData, null, 2));

    // FIXED: Handle different response structures - logs might come as direct array
    let logs = [];
    if (Array.isArray(logsData)) {
      logs = logsData;
      console.log('✅ Found logs as direct array');
    } else if ((logsData as any).items && Array.isArray((logsData as any).items)) {
      logs = (logsData as any).items;
      console.log('✅ Found logs in items property');
    } else if ((logsData as any).data && Array.isArray((logsData as any).data)) {
      logs = (logsData as any).data;
      console.log('✅ Found logs in data property');
    } else if ((logsData as any).logs && Array.isArray((logsData as any).logs)) {
      logs = (logsData as any).logs;
      console.log('✅ Found logs in logs property');
    } else {
      console.error('❌ Unknown logs response structure. Available properties:', Object.keys(logsData as any));
      // Try to find any array property as fallback
      const arrayProps = Object.keys(logsData as any).filter(key =>
        Array.isArray((logsData as any)[key])
      );

      if (arrayProps.length > 0) {
        console.log(`🔍 Found array properties: ${arrayProps.join(', ')}`);
        logs = (logsData as any)[arrayProps[0]];
        console.log(`⚠️ Using first array property '${arrayProps[0]}' with ${logs.length} items`);
      }
    }

    console.log(`Retrieved ${logs.length} log entries`);
    
    // Debug: Log a sample log entry structure
    if (logs.length > 0) {
      console.log('📋 First log entry structure:', Object.keys(logs[0]));
      console.log('📋 First log entry sample:', JSON.stringify(logs[0], null, 2));
    }

    return logs;

  } catch (error: any) {
    console.error('Error fetching CloudHub 2.0 logs:', error);
    throw error;
  }
}

// Updated fetchCH2ApplicationDetails with improved schedulers fetching
async function fetchCH2ApplicationDetails(
  context: vscode.ExtensionContext,
  appName: string,
  appData: any,
  environmentId?: string
): Promise<any> {
  try {
    console.log('=== FETCH CH2 APPLICATION DETAILS DEBUG ===');
    console.log(`Fetching details for CloudHub 2.0 application: ${appName}`);
    console.log(`Provided environment ID: ${environmentId}`);
    console.log(`App data keys:`, Object.keys(appData || {}));

    // Step 1: Get org and env info - use provided environment ID if available
    const { orgId, envId } = await getStoredOrgAndEnvInfo(context, environmentId);
    console.log(`Using orgId: ${orgId}, envId: ${envId}`);

    // VALIDATION: Make sure we're using the correct environment ID
    if (environmentId && envId !== environmentId) {
      console.warn(`Environment ID mismatch! Provided: ${environmentId}, Using: ${envId}`);
    }

    // Step 2: Get all deployments for this specific environment
    console.log(`Fetching deployments for environment: ${envId}`);
    const deployments = await getCH2Deployments(context, orgId, envId);
    console.log(`Retrieved ${deployments.length} deployments`);
    
    // DEBUG: Log all deployment names to help identify the issue
    console.log('Available deployments:', deployments.map(d => ({
      name: d.name,
      applicationName: d.applicationName,
      id: d.id,
      allKeys: Object.keys(d)
    })));

    // Step 3: Find the deployment for this application
    const deployment = findDeploymentByAppName(deployments, appName);
    if (!deployment) {
      console.error(`No deployment found for application: ${appName}`);
      console.error('Available deployment names:', deployments.map(d => d.name || d.applicationName || 'Unknown'));
      return {
        logs: [],
        schedulers: [],
        alerts: [],
        deployment: null,
        error: `No deployment found for application: ${appName}`,
        environmentId: envId
      };
    }

    const deploymentId = deployment.id;
    console.log(`Found deployment ID: ${deploymentId} for app: ${appName}`);

    // Step 4: Get deployment details (optional, for additional info)
    console.log(`Fetching deployment details for ID: ${deploymentId}`);
    const deploymentDetails = await getCH2DeploymentById(context, orgId, envId, deploymentId);

    // Step 5: Get deployment specs
    console.log(`Fetching deployment specs for ID: ${deploymentId}`);
    const specs = await getCH2DeploymentSpecs(context, orgId, envId, deploymentId);
    console.log(`Retrieved ${specs.length} specs`);
    
    // Step 6: Get the latest spec
    const latestSpec = getLatestSpec(specs);
    if (!latestSpec) {
      console.error(`No specs found for deployment: ${deploymentId}`);
      // Don't return early, try to fetch logs without spec ID
    }

    const specificationId = latestSpec ? latestSpec.id : deploymentId;
    console.log(`Using spec ID: ${specificationId} (fallback to deployment ID if no spec)`);

    // Step 7: Fetch all data in parallel for better performance
    console.log(`Fetching logs, schedulers, and alerts in parallel...`);
    
    const [logs, schedulers, alerts] = await Promise.allSettled([
      // Fetch logs
      getCH2DeploymentLogs(context, orgId, envId, deploymentId, specificationId, {
        limit: 50,
        priority: ['ERROR', 'WARN', 'INFO']
      }).catch(error => {
        console.error('Failed to fetch logs:', error.message);
        return [];
      }),
      
      // Fetch schedulers
      fetchCH2Schedulers(context, orgId, envId, deploymentId).catch(error => {
        console.error('Failed to fetch schedulers:', error.message);
        return [];
      }),
      
      // Fetch alerts
      fetchCH2Alerts(context, orgId, envId, deploymentId).catch(error => {
        console.error('Failed to fetch alerts:', error.message);
        return [];
      })
    ]);

    // Extract results from Promise.allSettled
    const logsResult = logs.status === 'fulfilled' ? logs.value : [];
    const schedulersResult = schedulers.status === 'fulfilled' ? schedulers.value : [];
    const alertsResult = alerts.status === 'fulfilled' ? alerts.value : [];

    console.log(`Successfully fetched application details:`, {
      logs: logsResult.length,
      schedulers: schedulersResult.length,
      alerts: alertsResult.length,
      deploymentId,
      specificationId
    });
    console.log('=== END DEBUG ===');

    return {
      logs: logsResult,
      schedulers: schedulersResult,
      alerts: alertsResult,
      deployment: deploymentDetails,
      specs: specs,
      latestSpec: latestSpec,
      deploymentId,
      specificationId,
      environmentId: envId,
      organizationId: orgId
    };

  } catch (error: any) {
    console.error('=== ERROR in fetchCH2ApplicationDetails ===');
    console.error('Error details:', error);
    console.error('Stack trace:', error.stack);
    vscode.window.showErrorMessage(`Failed to fetch application details: ${error.message}`);
    
    return {
      logs: [],
      schedulers: [],
      alerts: [],
      deployment: null,
      error: error.message,
      environmentId: environmentId
    };
  }
}

/**
 * Modified fetchMoreCH2Logs to use stored environment ID
 */
async function fetchMoreCH2Logs(
  context: vscode.ExtensionContext,
  appName: string,
  deploymentId: string,
  specificationId: string,
  offset: number = 0,
  limit: number = 100,
  environmentId?: string // Add environment ID parameter
): Promise<{logs: any[], hasMore: boolean}> {
  try {
    const { orgId, envId } = await getStoredOrgAndEnvInfo(context, environmentId);
    
    const logs = await getCH2DeploymentLogs(context, orgId, envId, deploymentId, specificationId, {
      offset,
      limit: limit + 1 // Fetch one extra to check if there are more
    });

    const hasMore = logs.length > limit;
    const actualLogs = hasMore ? logs.slice(0, limit) : logs;

    return {
      logs: actualLogs,
      hasMore
    };

  } catch (error: any) {
    console.error('Error fetching more logs:', error);
    return {
      logs: [],
      hasMore: false
    };
  }
}

/**
 * Modified searchCH2Logs to use stored environment ID
 */
async function searchCH2Logs(
  context: vscode.ExtensionContext,
  appName: string,
  deploymentId: string,
  specificationId: string,
  searchOptions: {
    search?: string;
    priority?: string[];
    startTime?: string;
    endTime?: string;
    limit?: number;
  },
  environmentId?: string // Add environment ID parameter
): Promise<any[]> {
  try {
    const { orgId, envId } = await getStoredOrgAndEnvInfo(context, environmentId);
    return await getCH2DeploymentLogs(context, orgId, envId, deploymentId, specificationId, searchOptions);
  } catch (error: any) {
    console.error('Error searching logs:', error);
    return [];
  }
}

/**
 * Updated Fetch schedulers for CloudHub 2.0 API
 */
async function fetchCH2Schedulers(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string,
  deploymentId: string
): Promise<any[]> {
  try {
    const accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) throw new Error('No access token found.');

    const url = `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/schedulers`;
    
    console.log('Fetching CH2 schedulers from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CloudHub 2.0 schedulers API error:', response.status, errorText);
      
      // If it's a 404, the endpoint might not exist for this deployment
      if (response.status === 404) {
        console.log('Schedulers endpoint not found - deployment may not have schedulers');
        return [];
      }
      
      throw new Error(`Failed to fetch schedulers: ${response.status} ${response.statusText}`);
    }

    const schedulersData = await response.json();
    console.log('CH2 schedulers response structure:', Object.keys(schedulersData as any));
    console.log('Full schedulers response:', JSON.stringify(schedulersData, null, 2));

    // Handle the response structure: { items: [...], total: N }
    let schedulers = [];
    if ((schedulersData as any).items && Array.isArray((schedulersData as any).items)) {
      schedulers = (schedulersData as any).items;
      console.log('✅ Found schedulers in items property');
    } else if (Array.isArray(schedulersData)) {
      schedulers = schedulersData;
      console.log('✅ Found schedulers as direct array');
    } else {
      console.error('❌ Unknown schedulers response structure. Available properties:', Object.keys(schedulersData as any));
      schedulers = [];
    }

    console.log(`Retrieved ${schedulers.length} schedulers`);
    
    // Debug: Log a sample scheduler entry structure
    if (schedulers.length > 0) {
      console.log('📋 First scheduler structure:', Object.keys(schedulers[0]));
      console.log('📋 First scheduler sample:', JSON.stringify(schedulers[0], null, 2));
    }

    return schedulers;

  } catch (error: any) {
    console.error('Error fetching CloudHub 2.0 schedulers:', error);
    // Return empty array instead of throwing to not break the entire flow
    return [];
  }
}

/**
 * Updated Build schedulers table for CloudHub 2.0 response format
 */
function buildSchedulersTable(schedulers: any[]): string {
  if (!schedulers || schedulers.length === 0) {
    return `
      <div class="card">
        <h2>Schedulers</h2>
        <p>No schedulers available for this deployment.</p>
      </div>
    `;
  }

  // Map CloudHub 2.0 scheduler fields to display columns
  const columns = [
    { key: 'flowName', label: 'Flow Name' },
    { key: 'type', label: 'Type' },
    { key: 'enabled', label: 'Enabled' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'timeUnit', label: 'Time Unit' },
    { key: 'startDelay', label: 'Start Delay' }
  ];
  const rowsHtml = schedulers
    .map((scheduler) => {
      const cells = columns.map((col) => {
        let val: string;
        
        switch (col.key) {
          case 'enabled':
            val = `<input type="checkbox" disabled ${scheduler.enabled ? 'checked' : ''} />`;
            break;
          case 'schedule':
            // Combine frequency and timeUnit for better readability
            if (scheduler.frequency && scheduler.timeUnit) {
              val = `${scheduler.frequency} ${scheduler.timeUnit}`;
            } else if (scheduler.frequency) {
              val = scheduler.frequency;
            } else if (scheduler.timeUnit) {
              val = scheduler.timeUnit;
            } else {
              val = '';
            }
            break;
          case 'flowName':
            val = scheduler.flowName || '';
            break;
          case 'type':
            val = scheduler.type || '';
            break;
          case 'startDelay':
            val = scheduler.startDelay || '';
            break;
          default:
            val = scheduler[col.key] || '';
        }
        
        return `<td>${val}</td>`;
      });

      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  // Filter out the timeUnit column header since we're combining it with frequency
  const filteredColumns = columns.filter(col => col.key !== 'timeUnit');

return `
    <div class="card">
      <div class="card-header">
        <h2>Schedulers</h2>
      </div>
      <div class="table-container">
        <table class="app-table">
          <thead>
            <tr>
              ${columns.map(c => `<th>${c.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div style="margin-top: 16px; font-size: 13px; color: var(--text-secondary); padding-top: 16px; border-top: 1px solid var(--border-muted);">
        Total schedulers: ${schedulers.length}
      </div>
    </div>
  `;
}

/**
 * Helper function to format scheduler information for better display
 */
function formatSchedulerInfo(scheduler: any): string {
  const parts = [];
  
  if (scheduler.type) {
    parts.push(`Type: ${scheduler.type}`);
  }
  
  if (scheduler.frequency && scheduler.timeUnit) {
    parts.push(`Every ${scheduler.frequency} ${scheduler.timeUnit.toLowerCase()}`);
  }
  
  if (scheduler.startDelay && scheduler.startDelay !== '0') {
    parts.push(`Start delay: ${scheduler.startDelay}`);
  }
  
  return parts.join(' | ');
}

/**
 * Fetch alerts (if available in CH2 API)
 */
async function fetchCH2Alerts(
  context: vscode.ExtensionContext,
  orgId: string,
  envId: string,
  deploymentId: string
): Promise<any[]> {
  try {
    const accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) throw new Error('No access token found.');

    // This endpoint might not exist in CH2, check documentation
    const url = `https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/alerts`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.log('Alerts endpoint not available or no alerts found');
      return [];
    }

    const alertsData = await response.json();
    return Array.isArray(alertsData) ? alertsData : (alertsData as any).data || [];

  } catch (error: any) {
    console.log('Alerts not available:', error.message);
    return [];
  }
}

/**
 * Update CloudHub 2.0 application status using deployment ID
 */
async function updateCH2ApplicationStatus(
  applicationName: string,
  status: 'stop' | 'start' | 'restart',
  authToken: string,
  deploymentId?: string
): Promise<void> {
  try {
    // If we don't have deployment ID, we need to get it first
    if (!deploymentId) {
      throw new Error('Deployment ID is required for CloudHub 2.0 operations');
    }

    // Note: CloudHub 2.0 API for start/stop might be different
    // This is a placeholder - you may need to adjust based on actual CloudHub 2.0 API
    const url = `https://anypoint.mulesoft.com/amc/application-manager/api/v2/deployments/${deploymentId}/${status}`;
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ action: status })
    });
    
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Failed to ${status} application: ${resp.status} ${resp.statusText} => ${txt}`);
    }

    console.log(`Successfully initiated ${status} for deployment ${deploymentId}`);

  } catch (error: any) {
    console.error(`Error updating application status:`, error);
    throw error;
  }
}

// ==================== HELPER FUNCTIONS ====================

function findDeploymentByAppName(deployments: any[], appName: string): any {
  return deployments.find(deployment => {
    return deployment.name === appName || 
           deployment.applicationName === appName ||
           deployment.application?.name === appName ||
           (deployment.spec && deployment.spec.name === appName);
  });
}

function getLatestSpec(specs: any[]): any {
  console.log('🔍 getLatestSpec called with:', specs);
  
  if (!specs || specs.length === 0) {
    console.log('⚠️ getLatestSpec: No specs provided or empty array');
    return null;
  }
  
  console.log(`📊 Processing ${specs.length} specs for latest determination`);
  
  // Log each spec's date info
  specs.forEach((spec, index) => {
    console.log(`  Spec ${index} date info:`, {
      id: spec.id,
      version: spec.version || spec.originalVersion,
      createdAt: spec.createdAt,
      createdAtDate: spec.createdAt ? new Date(spec.createdAt).toISOString() : 'N/A',
      hasValidId: !!spec.id
    });
  });
  
  try {
    const sortedSpecs = specs.sort((a, b) => {
      // Handle Unix timestamps (numbers) vs ISO strings
      let timestampA = 0;
      let timestampB = 0;

      if (a.createdAt) {
        // If it's a number (Unix timestamp), use it directly
        // If it's a string (ISO), convert to timestamp
        timestampA = typeof a.createdAt === 'number' ? a.createdAt : new Date(a.createdAt).getTime();
      }

      if (b.createdAt) {
        timestampB = typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt).getTime();
      }
      
      console.log(`📅 Comparing timestamps: A=${timestampA} (${new Date(timestampA).toISOString()}) vs B=${timestampB} (${new Date(timestampB).toISOString()})`);
      
      // Sort descending (newest first)
      return timestampB - timestampA;
    });
    
    console.log('✅ Sorted specs:', sortedSpecs.map(s => ({ 
      id: s.id,
      version: s.version || s.originalVersion,
      createdAt: s.createdAt,
      date: new Date(s.createdAt).toISOString()
    })));
    
    const latestSpec = sortedSpecs[0];
    console.log('🎯 Selected latest spec:', {
      id: latestSpec?.id,
      version: latestSpec?.version || latestSpec?.originalVersion,
      hasId: !!latestSpec?.id,
      createdAt: latestSpec?.createdAt,
      createdAtDate: latestSpec?.createdAt ? new Date(latestSpec.createdAt).toISOString() : 'N/A'
    });
    
    return latestSpec;
  } catch (error) {
    console.error('❌ Error in getLatestSpec:', error);
    return specs[0] || null; // Fallback to first spec
  }
}

function renderCH2AppInfoCell(key: string, value: any): string {
  if (typeof value === 'boolean') {
    return `<input type="checkbox" disabled ${value ? 'checked' : ''} />`;
  }
  if (key.match(/date$/i)) {
    try {
      return new Date(value).toISOString().split('T')[0];
    } catch {
      return value;
    }
  }
  if (key === 'application.status' || key === 'status') {
    if (value === 'RUNNING' || value === 'STARTED') {
      return `<span class="status-badge status-running"><span class="status-dot"></span>RUNNING</span>`;
    }
    if (['STOPPED', 'UNDEPLOYED'].includes(value)) {
      return `<span class="status-badge status-stopped"><span class="status-dot"></span>${value}</span>`;
    }
  }
  return value ?? '';
}

/** Flatten objects into dot-notation */
function flattenObject(obj: any, parentKey = '', res: any = {}): any {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const newKey = parentKey ? `${parentKey}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, newKey, res);
    } else {
      res[newKey] = value;
    }
  }
  return res;
}

// ==================== UI BUILDING FUNCTIONS ====================

/**
 * Build the CloudHub 2.0 application information table
 */
function buildCH2ApplicationInfoTable(appData: any): string {
  if (!appData || Object.keys(appData).length === 0) {
    return `
      <div class="card">
        <h2>Application Information</h2>
        <p>No application data available.</p>
      </div>
    `;
  }

  const flattened = flattenObject(appData);
  const visibleKeys = new Set(['name', 'creationDate', 'lastModifiedDate', 'currentRuntimeVersion', 'lastSuccessfulRuntimeVersion']);
  const normalFields: Record<string, any> = {};
  const propFields: Record<string, any> = {};

  const allKeys = Object.keys(flattened).sort();
  for (const key of allKeys) {
    const val = flattened[key];
    if (visibleKeys.has(key) || typeof val === 'boolean') {
      normalFields[key] = val;
    } else {
      propFields[key] = val;
    }
  }

  // Build normal rows
  const normalRowsHtml = Object.keys(normalFields)
    .map((key) => {
      return `
        <tr>
          <td><strong>${key}</strong></td>
          <td>${renderCH2AppInfoCell(key, normalFields[key])}</td>
        </tr>
      `;
    })
    .join('');

  // Build hidden property rows
  const propRowsHtml = Object.keys(propFields)
    .map((key) => {
      return `
        <tr>
          <td><strong>${key}</strong></td>
          <td>${renderCH2AppInfoCell(key, propFields[key])}</td>
        </tr>
      `;
    })
    .join('');

  const propsSection = Object.keys(propFields).length
    ? `
      <tr>
        <td colspan="2">
          <details>
            <summary style="cursor: pointer; font-weight: bold;">
              Show/Hide properties (${Object.keys(propFields).length})
            </summary>
            <table>
              ${propRowsHtml}
            </table>
          </details>
        </td>
      </tr>
    `
    : '';

  return `
    <div class="card">
      <div class="card-header">
        <h2>Application Information</h2>
        <div class="button-group">
          <button id="btnStopApp" class="button">Stop Application</button>
          <button id="btnStartApp" class="button">Start Application</button>
          <button id="btnRestartApp" class="button">Restart Application</button>
        </div>
      </div>
      <div class="table-container">
        <table class="app-table">
          <thead>
            <tr><th>Attribute</th><th>Value</th></tr>
          </thead>
          <tbody>
            ${normalRowsHtml}
            ${propsSection}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==================== DATA GENERATION FUNCTIONS ====================

function generateCH2ApplicationDetailsCsv(appData: any): string {
  if (!appData || typeof appData !== 'object') return '';

  const flattened = flattenObject(appData);
  const allKeys = Object.keys(flattened).sort();
  const header = allKeys.join(',');
  const row = allKeys
    .map((k) => {
      let val = flattened[k] ?? '';
      if (k.match(/date$/i)) {
        try {
          val = new Date(val).toISOString().split('T')[0];
        } catch {
          // Keep original value if date parsing fails
        }
      }
      return `"${String(val).replace(/"/g, '""')}"`;
    })
    .join(',');
  return [header, row].join('\n');
}

/** Generate log file content in different formats */
function generateLogContent(logs: any[], format: 'json' | 'txt' | 'csv'): string {
  if (!logs || !Array.isArray(logs) || logs.length === 0) {
    return format === 'json' ? '[]' : '';
  }

  switch (format) {
    case 'json':
      return JSON.stringify(logs, null, 2);
    
    case 'txt':
      return logs
        .map(log => {
          const timestamp = new Date(log.timestamp).toISOString();
          const priority = log.priority || 'INFO';
          const message = (log.message || '').replace(/\\n/g, '\n');
          return `[${timestamp}] ${priority}: ${message}`;
        })
        .join('\n\n');
    
    case 'csv':
      const headers = ['Timestamp', 'Priority', 'Thread Name', 'Message'];
      const csvRows = logs.map(log => {
        const timestamp = new Date(log.timestamp).toISOString();
        const priority = log.priority || '';
        const threadName = log.threadName || '';
        const message = (log.message || '').replace(/"/g, '""');
        return `"${timestamp}","${priority}","${threadName}","${message}"`;
      });
      return [headers.join(','), ...csvRows].join('\n');
    
    default:
      return '';
  }
}

// ==================== HTML GENERATION FUNCTION ====================


function getApplicationDetailsCH2Html(
  appName: string,
  appData: any,
  additionalData: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  // Build each section
  const applicationHtml = buildCH2ApplicationInfoTable(appData);
  const schedulersHtml = buildSchedulersTable(additionalData.schedulers || []);
  const alertsHtml = `
    <div class="card">
      <div class="card-header">
        <h2>Alerts</h2>
      </div>
      <p>${JSON.stringify(additionalData.alerts || [])}</p>
    </div>
  `;
  
  
// Updated logs HTML section in getApplicationDetailsCH2Html function
// Replace the existing logsHtml variable with this:
// Updated logs HTML with Code Time styling
  const logsHtml = `
    <div class="card logs">
      <div class="card-header">
        <h2>Logs</h2>
        <div class="button-group">
          <button id="btnDownloadLogs" class="button">Download Logs</button>
        </div>
      </div>
      <div class="logs-filters">
        <input 
          id="logFilter" 
          type="text" 
          placeholder="Filter logs by text..."
        />
        <select id="priorityFilter">
          <option value="">All Priorities</option>
          <option value="ERROR">ERROR</option>
          <option value="WARN">WARN</option>
          <option value="INFO">INFO</option>
          <option value="DEBUG">DEBUG</option>
        </select>
      </div>
      <div class="table-container" style="max-height: 600px; overflow-y: auto;">
        <table class="logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Priority</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody id="logsTbody"></tbody>
        </table>
      </div>
      <div class="logs-pagination">
        <button id="logsPrev" class="button">Previous</button>
        <button id="logsNext" class="button">Next</button>
        <span id="logsPageInfo" class="logs-info"></span>
      </div>
    </div>
  `;

const updatedScript = `
<script>
  const vscode = acquireVsCodeApi();

  // Tab switching logic
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      btn.classList.add('active');
      const tabId = 'tab-' + btn.dataset.tab;
      document.getElementById(tabId)?.classList.add('active');
    });
  });

  // Logs filtering & paging
  const logsRaw = ${JSON.stringify(additionalData.logs || [])};
  let logsData = Array.isArray(logsRaw) ? logsRaw : [];
  let filteredLogs = [...logsData];
  let currentPage = 1;
  const pageSize = 10;

  const logFilter = document.getElementById('logFilter');
  const logsTbody = document.getElementById('logsTbody');
  const logsPrev = document.getElementById('logsPrev');
  const logsNext = document.getElementById('logsNext');
  const logsPageInfo = document.getElementById('logsPageInfo');

  // Listen for messages from extension
  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
      case 'searchResults':
        // Replace current logs with search results
        logsData = message.logs;
        filteredLogs = [...logsData];
        currentPage = 1;
        renderLogsTable();
        break;
    }
  });

  function renderLogsTable() {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageLogs = filteredLogs.slice(startIndex, endIndex);
    const rowsHtml = pageLogs.map(log => {
      const dateStr = log.timestamp ? new Date(log.timestamp).toISOString() : 'Unknown';
      const msg = (log.message || '').replace(/\\n/g, '<br/>').replace(/\\r/g, '');
      return \`
        <tr>
          <td>\${dateStr}</td>
          <td>\${log.priority || log.level || ''}</td>
          <td style="max-width: 400px; word-wrap: break-word;">\${msg}</td>
        </tr>
      \`;
    }).join('');
    
    logsTbody.innerHTML = rowsHtml || '<tr><td colspan="3" style="text-align: center;">No logs available</td></tr>';
    
    const totalPages = Math.ceil(filteredLogs.length / pageSize);
    logsPageInfo.textContent = \`Page \${currentPage} of \${totalPages} (\${filteredLogs.length} total logs)\`;
    logsPrev.disabled = (currentPage <= 1);
    logsNext.disabled = (currentPage >= totalPages);
  }

  function applyLogFilter() {
    const term = (logFilter.value || '').toLowerCase();
    const selectedPriority = document.getElementById('priorityFilter')?.value || '';
    
    filteredLogs = logsData.filter(log => {
      if (!log) return false;
      
      // Text filter
      let textMatch = true;
      if (term) {
        const combined = [log.threadName, log.priority, log.level, log.message, log.logger]
          .filter(val => val != null)
          .join(' ')
          .toLowerCase();
        textMatch = combined.includes(term);
      }
      
      // Priority filter
      let priorityMatch = true;
      if (selectedPriority) {
        priorityMatch = (log.priority || log.level || '').toLowerCase() === selectedPriority.toLowerCase();
      }
      
      return textMatch && priorityMatch;
    });
    
    currentPage = 1;
    renderLogsTable();
  }

  // Event listeners
  logsPrev?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderLogsTable();
    }
  });
  
  logsNext?.addEventListener('click', () => {
    const totalPages = Math.ceil(filteredLogs.length / pageSize);
    if (currentPage < totalPages) {
      currentPage++;
      renderLogsTable();
    }
  });
  
  // Real-time filtering
  logFilter?.addEventListener('input', applyLogFilter);
  
  // Priority filter change
  document.getElementById('priorityFilter')?.addEventListener('change', applyLogFilter);
  
  // Initial render
  renderLogsTable();

  // Application control buttons
  document.getElementById('btnStopApp')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'stopApp' });
  });
  document.getElementById('btnStartApp')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'startApp' });
  });
  document.getElementById('btnRestartApp')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'restartApp' });
  });

  // Download logs button
  document.getElementById('btnDownloadLogs')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'downloadLogs' });
  });

  // COMMENTED OUT DATE FILTER FUNCTIONALITY
  /*
  // Set default time range (last 24 hours)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const startTimeInput = document.getElementById('startTime');
  const endTimeInput = document.getElementById('endTime');
  
  if (startTimeInput) {
    startTimeInput.value = yesterday.toISOString().slice(0, 16);
  }
  if (endTimeInput) {
    endTimeInput.value = now.toISOString().slice(0, 16);
  }

  // Apply Time Filter button
  document.getElementById('btnApplyTimeFilter')?.addEventListener('click', () => {
    const startTime = document.getElementById('startTime')?.value || '';
    const endTime = document.getElementById('endTime')?.value || '';
    const priority = document.getElementById('priorityFilter')?.value || '';

    if (!startTime && !endTime && !priority) {
      alert('Please select at least a start time, end time, or priority level.');
      return;
    }

    vscode.postMessage({
      command: 'searchLogs',
      searchTerm: '',
      priority: priority ? [priority] : [],
      startTime: startTime ? new Date(startTime).toISOString() : '',
      endTime: endTime ? new Date(endTime).toISOString() : '',
      limit: 200
    });
  });
  */
</script>
`;

return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Application Details - ${appName}</title>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&display=swap" />
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

          /* Tabs */
          .tabs {
            margin-top: 0;
          }

          .tab-header {
            display: flex;
            gap: 8px;
            margin-bottom: 24px;
            border-bottom: 1px solid var(--border-primary);
            padding-bottom: 0;
          }

          .tab-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            padding: 12px 16px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
          }

          .tab-btn:hover {
            color: var(--text-primary);
            background-color: var(--surface-secondary);
          }

          .tab-btn.active {
            color: var(--accent-blue);
            border-bottom-color: var(--accent-blue);
          }

          .tab-content {
            display: none;
          }

          .tab-content.active {
            display: block;
          }

          /* Cards */
          .card {
            background-color: var(--surface-primary);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            transition: all 0.2s;
          }

          .card:hover {
            border-color: var(--border-muted);
            transform: translateY(-1px);
          }

          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-muted);
          }

          .card-header h2 {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
            color: var(--text-primary);
          }

          /* Buttons */
          .button-group {
            display: flex;
            gap: 8px;
          }

          .button {
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 500;
            color: var(--text-primary);
            background-color: var(--accent-blue);
            border: 1px solid var(--accent-blue);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
          }

          .button:hover {
            background-color: var(--accent-light);
            border-color: var(--accent-light);
          }

          .button:disabled {
            background-color: var(--surface-secondary);
            border-color: var(--surface-secondary);
            color: var(--text-muted);
            cursor: not-allowed;
          }

          /* Tables */
          .table-container {
            width: 100%;
            overflow-x: auto;
            border: 1px solid var(--border-primary);
            border-radius: 8px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }

          th {
            background-color: var(--surface-secondary);
            color: var(--text-secondary);
            font-weight: 500;
            padding: 12px 16px;
            text-align: left;
            border-bottom: 1px solid var(--border-primary);
          }

          td {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-muted);
            color: var(--text-primary);
          }

          tr:hover {
            background-color: var(--surface-secondary);
          }

          tr:last-child td {
            border-bottom: none;
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

          .status-running {
            background-color: rgba(63, 185, 80, 0.15);
            color: var(--success);
          }

          .status-stopped {
            background-color: rgba(248, 81, 73, 0.15);
            color: var(--error);
          }

          .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: currentColor;
          }

          /* Logs specific styling */
          .logs-table {
            font-family: 'Fira Code', monospace;
            font-size: 12px;
          }

          .logs-table td {
            padding: 8px 12px;
            vertical-align: top;
          }

          .logs-filters {
            display: flex;
            gap: 12px;
            align-items: center;
            margin-bottom: 16px;
            flex-wrap: wrap;
          }

          .logs-filters input,
          .logs-filters select {
            padding: 8px 12px;
            background-color: var(--surface-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            font-size: 13px;
          }

          .logs-filters input {
            min-width: 250px;
          }

          .logs-pagination {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--border-muted);
          }

          .logs-pagination .button {
            padding: 6px 12px;
            font-size: 12px;
          }

          .logs-info {
            font-size: 13px;
            color: var(--text-secondary);
          }

          /* Responsive Design */
          @media (max-width: 768px) {
            .header {
              padding: 16px;
            }
            
            .container {
              padding: 16px;
            }
            
            .card {
              padding: 16px;
            }
            
            .card-header {
              flex-direction: column;
              align-items: flex-start;
              gap: 12px;
            }
            
            .button-group {
              width: 100%;
            }
            
            .button {
              flex: 1;
            }
            
            .logs-filters {
              flex-direction: column;
              align-items: stretch;
            }
            
            .logs-filters input {
              min-width: auto;
              width: 100%;
            }
          }
        </style>
      </head>
      <body>
        <!-- Header Section -->
        <div class="header">
          <div class="header-content">
            <h1>${appName}</h1>
            <p>CloudHub 2.0 Application Dashboard</p>
          </div>
        </div>

        <div class="container">
          <div class="tabs">
            <nav class="tab-header">
              <button data-tab="app-info" class="tab-btn active">Application Info</button>
              <button data-tab="schedulers" class="tab-btn">Schedulers</button>
              <button data-tab="alerts" class="tab-btn">Alerts</button>
              <button data-tab="logs" class="tab-btn">Logs</button>
            </nav>
            <div class="tab-content active" id="tab-app-info">
              ${applicationHtml}
            </div>
            <div class="tab-content" id="tab-schedulers">
              ${schedulersHtml}
            </div>
            <div class="tab-content" id="tab-alerts">
              ${alertsHtml}
            </div>
            <div class="tab-content" id="tab-logs">
              ${logsHtml}
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          // Tab switching logic
          const tabBtns = document.querySelectorAll('.tab-btn');
          const tabContents = document.querySelectorAll('.tab-content');
          tabBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
              tabBtns.forEach(b => b.classList.remove('active'));
              tabContents.forEach(tc => tc.classList.remove('active'));
              btn.classList.add('active');
              const tabId = 'tab-' + btn.dataset.tab;
              document.getElementById(tabId)?.classList.add('active');
            });
          });

          // Logs filtering & paging
          const logsRaw = ${JSON.stringify(additionalData.logs || [])};
          let logsData = Array.isArray(logsRaw) ? logsRaw : [];
          let filteredLogs = [...logsData];
          let currentPage = 1;
          const pageSize = 10;

          const logFilter = document.getElementById('logFilter');
          const logsTbody = document.getElementById('logsTbody');
          const logsPrev = document.getElementById('logsPrev');
          const logsNext = document.getElementById('logsNext');
          const logsPageInfo = document.getElementById('logsPageInfo');

          // Listen for messages from extension
          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
              case 'searchResults':
                // Replace current logs with search results
                logsData = message.logs;
                filteredLogs = [...logsData];
                currentPage = 1;
                renderLogsTable();
                break;
            }
          });

          function renderLogsTable() {
            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            const pageLogs = filteredLogs.slice(startIndex, endIndex);
            const rowsHtml = pageLogs.map(log => {
              const dateStr = log.timestamp ? new Date(log.timestamp).toISOString() : 'Unknown';
              const msg = (log.message || '').replace(/\\n/g, '<br/>').replace(/\\r/g, '');
              return \`
                <tr>
                  <td>\${dateStr}</td>
                  <td>\${log.priority || log.level || ''}</td>
                  <td style="max-width: 400px; word-wrap: break-word;">\${msg}</td>
                </tr>
              \`;
            }).join('');
            
            logsTbody.innerHTML = rowsHtml || '<tr><td colspan="3" style="text-align: center;">No logs available</td></tr>';
            
            const totalPages = Math.ceil(filteredLogs.length / pageSize);
            logsPageInfo.textContent = \`Page \${currentPage} of \${totalPages} (\${filteredLogs.length} total logs)\`;
            logsPrev.disabled = (currentPage <= 1);
            logsNext.disabled = (currentPage >= totalPages);
          }

          function applyLogFilter() {
            const term = (logFilter.value || '').toLowerCase();
            const selectedPriority = document.getElementById('priorityFilter')?.value || '';
            
            filteredLogs = logsData.filter(log => {
              if (!log) return false;
              
              // Text filter
              let textMatch = true;
              if (term) {
                const combined = [log.threadName, log.priority, log.level, log.message, log.logger]
                  .filter(val => val != null)
                  .join(' ')
                  .toLowerCase();
                textMatch = combined.includes(term);
              }
              
              // Priority filter
              let priorityMatch = true;
              if (selectedPriority) {
                priorityMatch = (log.priority || log.level || '').toLowerCase() === selectedPriority.toLowerCase();
              }
              
              return textMatch && priorityMatch;
            });
            
            currentPage = 1;
            renderLogsTable();
          }

          // Event listeners
          logsPrev?.addEventListener('click', () => {
            if (currentPage > 1) {
              currentPage--;
              renderLogsTable();
            }
          });
          
          logsNext?.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredLogs.length / pageSize);
            if (currentPage < totalPages) {
              currentPage++;
              renderLogsTable();
            }
          });
          
          // Real-time filtering
          logFilter?.addEventListener('input', applyLogFilter);
          
          // Priority filter change
          document.getElementById('priorityFilter')?.addEventListener('change', applyLogFilter);
          
          // Initial render
          renderLogsTable();

          // Application control buttons
          document.getElementById('btnStopApp')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'stopApp' });
          });
          document.getElementById('btnStartApp')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'startApp' });
          });
          document.getElementById('btnRestartApp')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'restartApp' });
          });

          // Download logs button
          document.getElementById('btnDownloadLogs')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'downloadLogs' });
          });

\

          /*
          // COMMENTED OUT DATE FILTER FUNCTIONALITY
          const now = new Date();
          const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          
          const startTimeInput = document.getElementById('startTime');
          const endTimeInput = document.getElementById('endTime');
          
          if (startTimeInput) {
            startTimeInput.value = yesterday.toISOString().slice(0, 16);
          }
          if (endTimeInput) {
            endTimeInput.value = now.toISOString().slice(0, 16);
          }

          document.getElementById('btnApplyTimeFilter')?.addEventListener('click', () => {
            const startTime = document.getElementById('startTime')?.value || '';
            const endTime = document.getElementById('endTime')?.value || '';
            const priority = document.getElementById('priorityFilter')?.value || '';

            if (!startTime && !endTime && !priority) {
              alert('Please select at least a start time, end time, or priority level.');
              return;
            }

            vscode.postMessage({
              command: 'searchLogs',
              searchTerm: '',
              priority: priority ? [priority] : [],
              startTime: startTime ? new Date(startTime).toISOString() : '',
              endTime: endTime ? new Date(endTime).toISOString() : '',
              limit: 200
            });
          });

          document.getElementById('btnLoadMoreLogs')?.addEventListener('click', () => {
            vscode.postMessage({ 
              command: 'loadMoreLogs', 
              offset: totalLogsOffset 
            });
          });

          document.getElementById('btnAdvancedSearch')?.addEventListener('click', () => {
            const searchTerm = document.getElementById('logFilter')?.value || '';
            const priority = document.getElementById('priorityFilter')?.value || '';
            const startTime = document.getElementById('startTime')?.value || '';
            const endTime = document.getElementById('endTime')?.value || '';

            vscode.postMessage({
              command: 'searchLogs',
              searchTerm,
              priority: priority ? [priority] : [],
              startTime: startTime ? new Date(startTime).toISOString() : '',
              endTime: endTime ? new Date(endTime).toISOString() : ''
            });
          });
          */
        </script>
      </body>
    </html>
  `;
}