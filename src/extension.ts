// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import {
    loginToAnypointWithOAuth,
    refreshAccessToken,
    revokeAnypointToken
} from './controllers/oauthService';
import {
    CLIENT_ID,
    CLIENT_SECRET,
    BASE_URL,
    AUTHORIZATION_ENDPOINT,
    TOKEN_ENDPOINT,
    REVOKE_ENDPOINT,
    LOCAL_REDIRECT_URI
} from './constants';
import { showApplicationsWebview } from './anypoint/cloudhub2Applications';
import { showApplicationsWebview1 } from './anypoint/cloudhub1Applications';
import { getUserInfoWebviewContent } from './anypoint/userInfoContent';
import {getOrgInfoWebviewContent} from './anypoint/organizationInfo';
import {showDashboardWebview} from './anypoint/ApplicationDetails';
import {showEnvironmentAndOrgPanel} from './anypoint/DeveloperInfo';
import {showAPIManagerWebview} from './anypoint/apiMananagerAPIs';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	 // Register a command for the login
        const loginCommand = vscode.commands.registerCommand('anypoint-monitor.login', async () => {
                try {
                        await loginToAnypointWithOAuth(context);
                        await getUserInfo(context);
                        await getEnvironments(context);
                }
                catch (error: any) {
                        vscode.window.showErrorMessage(`Login failed: ${error.message || error}`);
                }
        });

	const revokeAccessCommand = vscode.commands.registerCommand('anypoint-monitor.logout', async () => {
		try {
			await revokeAnypointToken(context, 'access');
		} 
		catch (err: any) {
			vscode.window.showErrorMessage(`Failed to revoke access token: ${err.message}`);
		}
	});

	const userInfo = vscode.commands.registerCommand('anypoint-monitor.userInfo', async () => {
		try {
			await getUserInfo(context);
		} 
		catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message || error}`);
		}
	});

	const organizationInformation = vscode.commands.registerCommand('anypoint-monitor.organizationInfo', async () => {
		try {
			await getOrganizationInfo(context);
		} 
		catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message || error}`);
		}
	});

	const devInfo = vscode.commands.registerCommand('anypoint-monitor.developerUtilities', async () => {
		try {
			await developerInfo(context);
		} 
		catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message || error}`);
		}
	});

	const applicationDetails = vscode.commands.registerCommand('anypoint-monitor.applicationDetails', async () => {
		try {
		  // Retrieve stored environments from secure storage
		  const storedEnvironments = await context.secrets.get('anypoint.environments');
		  if (!storedEnvironments) {
			vscode.window.showErrorMessage('No environment information found. Please log in first.');
			return;
		  }
	  
		  // Parse the stored environments JSON
		  const environments = JSON.parse(storedEnvironments) as {
			data: { id: string; name: string }[];
			total: number;
		  };
	  
		  if (!environments.data || environments.data.length === 0) {
			vscode.window.showErrorMessage('No environments available.');
			return;
		  }
	  
		  // Extract environment names and map to IDs
		  const environmentOptions = environments.data.map(env => ({
			label: env.name,
			id: env.id,
		  }));
	  
		  // Prompt the user to select an environment
		  const selectedEnvironment = await vscode.window.showQuickPick(
			environmentOptions.map(option => option.label),
			{
			  placeHolder: 'Select an environment',
			}
		  );
	  
		  if (!selectedEnvironment) {
			vscode.window.showInformationMessage('No environment selected.');
			return;
		  }
	  
		  // Find the corresponding environment ID
		  const selectedEnvironmentId = environmentOptions.find(option => option.label === selectedEnvironment)?.id;
		  if (!selectedEnvironmentId) {
			vscode.window.showErrorMessage('Failed to find the selected environment ID.');
			return;
		  }
	  
		  await retrieveApplications(context, selectedEnvironmentId);
		 
	  
		} catch (error: any) {
		  vscode.window.showErrorMessage(`Error: ${error.message || error}`);
		}
	  });
	  
	const getCH1Apps = vscode.commands.registerCommand('anypoint-monitor.cloudhub1Apps', async () => {
		// Retrieve stored environments from secure storage
		const storedEnvironments = await context.secrets.get('anypoint.environments');
		if (!storedEnvironments) {
			vscode.window.showErrorMessage('No environment information found. Please log in first.');
			return;
		}

		try{
			// Parse the stored environments JSON
			const environments = JSON.parse(storedEnvironments) as {
				data: { id: string; name: string }[];
				total: number;
			};

			if (!environments.data || environments.data.length === 0) {
				vscode.window.showErrorMessage('No environments available.');
				return;
			}

			// Extract environment names and map to IDs
			const environmentOptions = environments.data.map(env => ({
				label: env.name,
				id: env.id,
			}));

			// Prompt the user to select an environment
			const selectedEnvironment = await vscode.window.showQuickPick(
				environmentOptions.map(option => option.label),
				{
					placeHolder: 'Select an environment',
				}
			);

			if (!selectedEnvironment) {
				vscode.window.showInformationMessage('No environment selected.');
				return;
			}
	
			// Find the corresponding environment ID
			const selectedEnvironmentId = environmentOptions.find(option => option.label === selectedEnvironment)?.id;
			if (!selectedEnvironmentId) {
				vscode.window.showErrorMessage('Failed to find the selected environment ID.');
				return;
			}

			await getCH1Applications(context,selectedEnvironmentId);
		}
		catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message}`);
		}			
	});

	const getApplications = vscode.commands.registerCommand('anypoint-monitor.cloudhub2Apps', async () => {
		// Retrieve stored environments from secure storage
		const storedEnvironments = await context.secrets.get('anypoint.environments');
		if (!storedEnvironments) {
			vscode.window.showErrorMessage('No environment information found. Please log in first.');
			return;
		}

		try{
			// Parse the stored environments JSON
			const environments = JSON.parse(storedEnvironments) as {
				data: { id: string; name: string }[];
				total: number;
			};

			if (!environments.data || environments.data.length === 0) {
				vscode.window.showErrorMessage('No environments available.');
				return;
			}

			// Extract environment names and map to IDs
			const environmentOptions = environments.data.map(env => ({
				label: env.name,
				id: env.id,
			}));

			// Prompt the user to select an environment
			const selectedEnvironment = await vscode.window.showQuickPick(
				environmentOptions.map(option => option.label),
				{
					placeHolder: 'Select an environment',
				}
			);

			if (!selectedEnvironment) {
				vscode.window.showInformationMessage('No environment selected.');
				return;
			}
	
			// Find the corresponding environment ID
			const selectedEnvironmentId = environmentOptions.find(option => option.label === selectedEnvironment)?.id;
			if (!selectedEnvironmentId) {
				vscode.window.showErrorMessage('Failed to find the selected environment ID.');
				return;
			}

			await getCH2Applications(context,selectedEnvironmentId);
		}
		catch (error: any) {
        	vscode.window.showErrorMessage(`Error: ${error.message}`);
    	}
	});

	const subcriptionExpiration = vscode.commands.registerCommand('anypoint-monitor.subscriptionExpiration', async () => {
		try{
			const userInfoStr = await context.secrets.get('anypoint.userInfo');
	
			if (!userInfoStr) {
				vscode.window.showErrorMessage('No user info found. Please log in first.');
			return;
			}
  
			const userInfoData = JSON.parse(userInfoStr);

			// Example usage in a command or function
			const expirationString = userInfoData.organization.subscription?.expiration ?? 'N/A';

			if (expirationString === 'N/A') {
			vscode.window.showInformationMessage('Your subscription expiration date is not available.');
			} else {
			// Convert the string into a Date object
			const expirationDate = new Date(expirationString);

			// Format the date (e.g., "July 31, 2027")
			// You can customize the locale ("en-US") or the options as needed
			const formattedExpiration = expirationDate.toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			});

			// Calculate days remaining
			const now = new Date();
			const diffInMs = expirationDate.getTime() - now.getTime();
			const daysRemaining = Math.ceil(diffInMs / (1000 * 60 * 60 * 24));

			vscode.window.showInformationMessage(
				`Your subscription expires on: ${formattedExpiration} (in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'})`
			);
			}

			
		}
		catch (error: any) {
        	vscode.window.showErrorMessage(`Error: ${error.message}`);
    	}
	});

	const retrieveAccessToken = vscode.commands.registerCommand('anypoint-monitor.retrieveAccessToken', async () => {
		// Attempt to refresh the access token using your existing refresh logic
		const didRefresh = await refreshAccessToken(context);
		if (!didRefresh) {
		  vscode.window.showErrorMessage('Failed to refresh access token. Please log in again.');
		  return;
		}
		
		// Retrieve the newly refreshed access token from secret storage
		const refreshedToken = await context.secrets.get('anypoint.accessToken');
		if (!refreshedToken) {
		  vscode.window.showErrorMessage('No access token found after refresh. Please log in again.');
		  return;
		}
		
		vscode.window.showInformationMessage(`Access token: ${refreshedToken}`);
	});

	const retrieveAPIManagerAPIs = vscode.commands.registerCommand('anypoint-monitor.retrieveAPIManagerAPIs', async () => {
		
		const storedEnvironments = await context.secrets.get('anypoint.environments');
		if (!storedEnvironments) {
			vscode.window.showErrorMessage('No environment information found. Please log in first.');
			return;
		}
		
		try{
			// Parse the stored environments JSON
			const environments = JSON.parse(storedEnvironments) as {
				data: { id: string; name: string }[];
				total: number;
			};

			if (!environments.data || environments.data.length === 0) {
				vscode.window.showErrorMessage('No environments available.');
				return;
			}

			// Extract environment names and map to IDs
			const environmentOptions = environments.data.map(env => ({
				label: env.name,
				id: env.id,
			}));

			// Prompt the user to select an environment
			const selectedEnvironment = await vscode.window.showQuickPick(
				environmentOptions.map(option => option.label),
				{
					placeHolder: 'Select an environment',
				}
			);

			if (!selectedEnvironment) {
				vscode.window.showInformationMessage('No environment selected.');
				return;
			}
	
			// Find the corresponding environment ID
			const selectedEnvironmentId = environmentOptions.find(option => option.label === selectedEnvironment)?.id;
			if (!selectedEnvironmentId) {
				vscode.window.showErrorMessage('Failed to find the selected environment ID.');
				return;
			}

			const userInfo = await context.secrets.get('anypoint.userInfo');	
			
			if (userInfo) {			
				const userInfoData = JSON.parse(userInfo);
				const organizationID = userInfoData.organization.id;
				showAPIManagerWebview(context,selectedEnvironmentId,organizationID);
			}
		
		} 
		catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message || error}`);
	 	}
	});

	context.subscriptions.push(userInfo);
	context.subscriptions.push(getApplications);
	context.subscriptions.push(revokeAccessCommand);
	context.subscriptions.push(loginCommand); 
	context.subscriptions.push(loginCommand);
	context.subscriptions.push(getCH1Apps);
	context.subscriptions.push(organizationInformation);
	context.subscriptions.push(applicationDetails);
	context.subscriptions.push(subcriptionExpiration);
	context.subscriptions.push(retrieveAccessToken);
	context.subscriptions.push(retrieveAPIManagerAPIs);
}

export async function retrieveApplications(context: vscode.ExtensionContext, selectedEnvironmentId: string) {
	let accessToken = await context.secrets.get('anypoint.accessToken');
	const userInfoStr = await context.secrets.get('anypoint.userInfo');
	
	if (!accessToken || !userInfoStr) {
	  vscode.window.showErrorMessage('No access token or user info found. Please log in first.');
	  return;
	}
  
	const userInfoData = JSON.parse(userInfoStr);
	const organizationID = userInfoData.organization.id;
  
	// =====================
	// 1) Fetch Applications
	// =====================
	const appsUrl = BASE_URL+ '/cloudhub/api/applications';
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
	  // Check if it's a 401
	  if (error.response?.status === 401) {
		vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
  
		const didRefresh = await refreshAccessToken(context);
		if (!didRefresh) {
		  vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
		  return;
		}
		// Retrieve the new token from secrets
		accessToken = await context.secrets.get('anypoint.accessToken');
		if (!accessToken) {
		  vscode.window.showErrorMessage('No access token found after refresh. Please log in again.');
		  return;
		}
  
		// Retry the request once
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
  
	// Prompt user to select an application
	const applicationOptions = appsList.map(app => ({
	  label: app.domain || app.name || 'Unknown',
	  domain: app.domain,
	}));
  
	const selectedAppLabel = await vscode.window.showQuickPick(
	  applicationOptions.map(opt => opt.label),
	  {
		placeHolder: 'Select an application',
	  }
	);
  
	if (!selectedAppLabel) {
	  vscode.window.showInformationMessage('No application selected.');
	  return;
	}
  
	const selectedAppDomain = applicationOptions.find(opt => opt.label === selectedAppLabel)?.domain;
	if (!selectedAppDomain) {
	  vscode.window.showErrorMessage('Failed to find the selected application domain.');
	  return;
	}
  
	// =======================
	// 2) Fetch Single App Data
	// =======================
	const appDetailsUrl = BASE_URL+`/cloudhub/api/applications/${selectedAppDomain}`;
	let singleAppData: any;
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
	  // Same 401 pattern if you like
	  vscode.window.showErrorMessage(`Error fetching application details: ${error.message}`);
	  return;
	}
  
	// =======================
	// 3) Fetch Schedules, etc.
	// =======================
	// Repeat the same pattern if you want each call to attempt refresh on 401
  
	const schedulesURL = BASE_URL+`/cloudhub/api/applications/${selectedAppDomain}/schedules`;
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
  
	// ... do the same for deployments, logs, etc. if needed ...

	  
	const deploymentsURL = BASE_URL+`/cloudhub/api/v2/applications/${selectedAppDomain}/deployments?orderByDate=DESC`;
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

	const logsURL= BASE_URL+ `/cloudhub/api/v2/applications/${selectedAppDomain}/deployments/${deploymentId}/logs?limit=100`;
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


  
	// =====================
	// Build & Show Webview
	// =====================
	const dashboardData = {
	  application: singleAppData,
	  schedulers: schedules,
	  alerts: [],
	  analytics: [],
	  logs: logs,
	};
  
	showDashboardWebview(context, singleAppData.domain ,dashboardData,selectedEnvironmentId);
  }
/**
 * getUserInfo get the user information from the Anypoint platform.
 * @param context 
 * @returns 
 */
export async function getUserInfo(context: vscode.ExtensionContext) {
	// Retrieve the stored access token
	let accessToken = await context.secrets.get('anypoint.accessToken');
	if (!accessToken) {
	  throw new Error('No access token found. Please log in first.');
	}
  
	// Our MuleSoft endpoint
	const apiUrl = BASE_URL+'/accounts/api/me';
  
	try {
	  // 1. Attempt the initial API call
	  const response = 	await axios.get(apiUrl, {
		headers: {
		  Authorization: `Bearer ${accessToken}`
		}
	  });
  
	  // 2. Check for non-200
	  if (response.status !== 200) {
		throw new Error(`API request failed with status ${response.status}`);
	  }
  
	  // 3. If we got here, the call succeeded!
	  const data = response.data;

	  await context.secrets.store('anypoint.userInfo',JSON.stringify(data.user));
  
	  // Create a webview to display user info
	  const panel = vscode.window.createWebviewPanel(
		'userInfoWebview',
		'User Information',
		vscode.ViewColumn.One,
		{ enableScripts: true }
	  );


	  panel.webview.html = getUserInfoWebviewContent(data,panel.webview,context.extensionUri);
		//vscode.window.showInformationMessage(`API response: ${JSON.stringify(data)}`);
  
	} catch (error: any) {
	  // 4. If we got a 401, try to refresh
	  if (error.response?.status === 401) {
		vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
  
		const didRefresh = await refreshAccessToken(context);
		if (!didRefresh) {
		  vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
		  return;
		}
  
		// 5. Token refreshed, retrieve the new access token and retry
		accessToken = await context.secrets.get('anypoint.accessToken');
		if (!accessToken) {
		  vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
		  return;
		}
  
		// Retry the request
		try {
		  const retryResponse = await axios.get(apiUrl, {
			headers: {
			  Authorization: `Bearer ${accessToken}`
			}
		  });
  
		  if (retryResponse.status !== 200) {
			throw new Error(`Retry API request failed with status ${retryResponse.status}`);
		  }
  
		  const data = retryResponse.data;
  
		  // Display or log data
		  const panel = vscode.window.createWebviewPanel(
			'userInfoWebview',
			'User Information',
			vscode.ViewColumn.One,
			{ enableScripts: true }
		  );
		  panel.webview.html =getUserInfoWebviewContent(data,panel.webview,context.extensionUri);
  
		  vscode.window.showInformationMessage(`API response (after refresh): ${JSON.stringify(data)}`);
		} catch (retryError: any) {
		  vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
		}
	  } else {
		// Another error (not 401) - handle as needed
		vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
	  }
	}
}

export async function getOrganizationInfo(context: vscode.ExtensionContext) {
	// Retrieve the stored access token
	let accessToken = await context.secrets.get('anypoint.accessToken');
	if (!accessToken) {
	  throw new Error('No access token found. Please log in first.');
	}
  
	// Our MuleSoft endpoint
	const apiUrl = BASE_URL+'/cloudhub/api/organization';
  
	try {
	  // 1. Attempt the initial API call
	  const response = 	await axios.get(apiUrl, {
		headers: {
		  Authorization: `Bearer ${accessToken}`
		}
	  });
  
	  // 2. Check for non-200
	  if (response.status !== 200) {
		throw new Error(`API request failed with status ${response.status}`);
	  }
  
	  // 3. If we got here, the call succeeded!
	  const data = response.data;
  
	  // Create a webview to display user info
	  const panel = vscode.window.createWebviewPanel(
		'orgInfoWebview',
		'Organization Details',
		vscode.ViewColumn.One,
		{ enableScripts: true }
	  );

	  panel.webview.html = getOrgInfoWebviewContent(data,panel.webview,context.extensionUri);
  
	} catch (error: any) {
	  // 4. If we got a 401, try to refresh
	  if (error.response?.status === 401) {
		vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
  
		const didRefresh = await refreshAccessToken(context);
		if (!didRefresh) {
		  vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
		  return;
		}
  
		// 5. Token refreshed, retrieve the new access token and retry
		accessToken = await context.secrets.get('anypoint.accessToken');
		if (!accessToken) {
		  vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
		  return;
		}
  
		// Retry the request
		try {
			const retryResponse = await axios.get(apiUrl, {
				headers: {
				Authorization: `Bearer ${accessToken}`
				}
			});
  
			if (retryResponse.status !== 200) {
				throw new Error(`Retry API request failed with status ${retryResponse.status}`);
			}
  
		  	const data = retryResponse.data;
	
			// Create a webview to display user info
			const panel = vscode.window.createWebviewPanel(
				'orgInfoWebview',
				'Organization Details',
				vscode.ViewColumn.One,
				{ enableScripts: true }
			);
	
			panel.webview.html = getOrgInfoWebviewContent(data,panel.webview,context.extensionUri);
  
		  vscode.window.showInformationMessage(`API response (after refresh): ${JSON.stringify(data)}`);
		} catch (retryError: any) {
		  vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
		}
	  } else {
		// Another error (not 401) - handle as needed
		vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
	  }
	}
}

export async function developerInfo(context: vscode.ExtensionContext) {
	// Retrieve from secret storage
	const storedUserInfo = await context.secrets.get('anypoint.userInfo');
	const storedEnvironments = await context.secrets.get('anypoint.environments');

	if (!storedUserInfo || !storedEnvironments) {
		vscode.window.showErrorMessage('User info or environment info not found. Please log in first.');
		return;
	}

	// Parse them
	const userInfo = JSON.parse(storedUserInfo);
	const environments = JSON.parse(storedEnvironments);
	const parsedEnvironments = JSON.parse(storedEnvironments); // e.g. { data: [ ... ], total: 2 }
	//let organizationID = JSON.parse(userInfo).organization.id;
	
	showEnvironmentAndOrgPanel(
	  context,
	  { orgName:"-", orgId: userInfo.organization.id },
	  parsedEnvironments.data // or whatever contains your environment objects
	);
}


export async function getEnvironments(context: vscode.ExtensionContext) {
	// Retrieve the stored access token
	let accessToken = await context.secrets.get('anypoint.accessToken');
	let userInfo = await context.secrets.get('anypoint.userInfo');
	
	if (userInfo) {
		
		let organizationID = JSON.parse(userInfo).organization.id;

		if (!accessToken) {
			throw new Error('No access token found. Please log in first.');
		}
	
	  // Our MuleSoft endpoint
	  const apiUrl = BASE_URL+'/accounts/api/organizations/'+organizationID+''+'/environments';
	
	  try {
		// 1. Attempt the initial API call
		const response = 	await axios.get(apiUrl, {
		  headers: {
			Authorization: `Bearer ${accessToken}`
		  }
		});
	
		// 2. Check for non-200
		if (response.status !== 200) {
		  throw new Error(`API request failed with status ${response.status}`);
		}
	
		// 3. If we got here, the call succeeded!
		const data = response.data;
  
		await context.secrets.store('anypoint.environments',JSON.stringify(response.data));

		vscode.window.showInformationMessage('environment saved');
  
	
	  } catch (error: any) {
		// 4. If we got a 401, try to refresh
		if (error.response?.status === 401) {
		  vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
	
		  const didRefresh = await refreshAccessToken(context);
		  if (!didRefresh) {
			vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
			return;
		  }
	
		  // 5. Token refreshed, retrieve the new access token and retry
		  accessToken = await context.secrets.get('anypoint.accessToken');
		  if (!accessToken) {
			vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
			return;
		  }
	
		  // Retry the request
		  try {
			const retryResponse = await axios.get(apiUrl, {
			  headers: {
				Authorization: `Bearer ${accessToken}`
			  }
			});
	
			if (retryResponse.status !== 200) {
			  throw new Error(`Retry API request failed with status ${retryResponse.status}`);
			}
	
			const data = retryResponse.data;
	
			// Display or log data
			const panel = vscode.window.createWebviewPanel(
			  'userInfoWebview',
			  'User Information',
			  vscode.ViewColumn.One,
			  { enableScripts: true }
			);
			vscode.window.showInformationMessage('environment saved');
	
			vscode.window.showInformationMessage(`API response (after refresh): ${JSON.stringify(data)}`);
		  } catch (retryError: any) {
			vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
		  }
		} else {
		  // Another error (not 401) - handle as needed
		  vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
		}
	  }
		
	} else {
		throw new Error('User info not found. Please log in first.');
	}
	
	
}


export async function getCH2Applications(context: vscode.ExtensionContext,environmentId: string) {

	// Retrieve the stored access token
	let accessToken = await context.secrets.get('anypoint.accessToken');
	let userInfo = await context.secrets.get('anypoint.userInfo');

	if (userInfo) {
		let organizationID = JSON.parse(userInfo).organization.id;

		
		if (!accessToken) {
			throw new Error('No access token found. Please log in first.');
		}

		// Our MuleSoft endpoint
		const apiUrl = BASE_URL+'/amc/application-manager/api/v2/organizations/'+organizationID+'/environments/'+environmentId+'/deployments';


		try {
			// 1. Attempt the initial API call
			const response = await axios.get(apiUrl, {
				headers: {
					Authorization: `Bearer ${accessToken}`
				}
			});
		
			// 2. Check for non-200
			if (response.status !== 200) {
				throw new Error(`API request failed with status ${response.status}`);
			}
		
			// 3. If we got here, the call succeeded!
			const data = response.data;
		
			
			// Show them in a webview
			showApplicationsWebview(context, data);
		
			} catch (error: any) {
			// 4. If we got a 401, try to refresh
			if (error.response?.status === 401) {
				vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
		
				const didRefresh = await refreshAccessToken(context);
				if (!didRefresh) {
				vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
				return;
				}
		
				// 5. Token refreshed, retrieve the new access token and retry
				accessToken = await context.secrets.get('anypoint.accessToken');
				if (!accessToken) {
				vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
				return;
				}
		
				// Retry the request
				try {
				const retryResponse = await axios.get(apiUrl, {
					headers: {
					Authorization: `Bearer ${accessToken}`
					}
				});
		
				if (retryResponse.status !== 200) {
					throw new Error(`Retry API request failed with status ${retryResponse.status}`);
				}
		
				const data = retryResponse.data;
		
				// Show them in a webview
				showApplicationsWebview(context, data);

				} catch (retryError: any) {
				vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
				}
			} else {
				// Another error (not 401) - handle as needed
				vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
			}
		}	
	}
}


export async function getCH1Applications(context: vscode.ExtensionContext,environmentId: string) {

	// Retrieve the stored access token
	let accessToken = await context.secrets.get('anypoint.accessToken');
	let userInfo = await context.secrets.get('anypoint.userInfo');

	if (userInfo) {
		let organizationID = JSON.parse(userInfo).organization.id;

		
		if (!accessToken) {
			throw new Error('No access token found. Please log in first.');
		}

		// Our MuleSoft endpoint
		const apiUrl = BASE_URL+'/cloudhub/api/applications';


		try {
			// 1. Attempt the initial API call
			const response = await axios.get(apiUrl, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'X-ANYPNT-ENV-ID': environmentId,
					'X-ANYPNT-ORG-ID': organizationID
				}
			});
		
			// 2. Check for non-200
			if (response.status !== 200) {
				throw new Error(`API request failed with status ${response.status}`);
			}
		
			// 3. If we got here, the call succeeded!
			const data = response.data;
		
			
			// Show them in a webview
			showApplicationsWebview1(context, data);
		
			} catch (error: any) {
			// 4. If we got a 401, try to refresh
			if (error.response?.status === 401) {
				vscode.window.showInformationMessage('Access token expired. Attempting to refresh...');
		
				const didRefresh = await refreshAccessToken(context);
				if (!didRefresh) {
				vscode.window.showErrorMessage('Unable to refresh token. Please log in again.');
				return;
				}
		
				// 5. Token refreshed, retrieve the new access token and retry
				accessToken = await context.secrets.get('anypoint.accessToken');
				if (!accessToken) {
					vscode.window.showErrorMessage('No new access token found after refresh. Please log in again.');
				return;
				}
		
				// Retry the request
				try {
				const retryResponse = await axios.get(apiUrl, {
					headers: {
					Authorization: `Bearer ${accessToken}`
					}
				});
		
				if (retryResponse.status !== 200) {
					throw new Error(`Retry API request failed with status ${retryResponse.status}`);
				}
		
				const data = retryResponse.data;
		
				// Show them in a webview
				showApplicationsWebview1(context, data);
		
				vscode.window.showInformationMessage(`API response (after refresh): ${JSON.stringify(data)}`);
				} catch (retryError: any) {
				vscode.window.showErrorMessage(`API request failed after refresh: ${retryError.message}`);
				}
			}
			else if (error.response?.status === 403) { 
				vscode.window.showErrorMessage(`Error calling API: ${error.message}`+ ' Check CloudHub 1.0 Entitlement / Permissions');
			}
			else {
				// Another error (not 401) - handle as needed
				vscode.window.showErrorMessage(`Error calling API: ${error.message}`);
			}
		}	
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
