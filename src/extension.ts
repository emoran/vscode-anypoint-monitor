// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as http from 'http';
import * as path from 'path';
import { showApplicationsWebview } from './anypoint/cloudhub2Applications';
import { showApplicationsWebview1 } from './anypoint/cloudhub1Applications';
import { getUserInfoWebviewContent } from './anypoint/userInfoContent'; 
import {getOrgInfoWebviewContent} from './anypoint/organizationInfo';
import {showDashboardWebview} from './anypoint/ApplicationDetails';
 import {showEnvironmentAndOrgPanel} from './anypoint/DeveloperInfo';

//These are hardcoded in porpose until find a feature to store them in a secure way
const CLIENT_ID = '05ce4abd0fc047b4bcd512f15b3445c9';
const CLIENT_SECRET = 'b5d7dBEe693c4C3fa50C183A3f6570D2';

const BASE_URL = 'https://anypoint.mulesoft.com';

// MuleSoft OAuth Endpoints
const AUTHORIZATION_ENDPOINT = BASE_URL + '/accounts/api/v2/oauth2/authorize';
const TOKEN_ENDPOINT = BASE_URL + '/accounts/api/v2/oauth2/token';
const REVOKE_ENDPOINT = BASE_URL + '/accounts/api/v2/oauth2/revoke';

// Example redirect URL (You must configure something like http://localhost:3000/callback
// in your MuleSoft OAuth app settings, or use a custom URI scheme).
const LOCAL_REDIRECT_URI = 'http://localhost:8082/callback';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	 // Register a command for the login
	const loginCommand = vscode.commands.registerCommand('anypoint-monitor.login', async () => {
		try {
			await loginToAnypointWithOAuth(context);
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


	context.subscriptions.push(userInfo);
	context.subscriptions.push(getApplications);
	context.subscriptions.push(revokeAccessCommand);
	context.subscriptions.push(loginCommand); 
	context.subscriptions.push(loginCommand);
	context.subscriptions.push(getCH1Apps);
	context.subscriptions.push(organizationInformation);
	context.subscriptions.push(applicationDetails);
	//context.subscriptions.push(devInfo);
	context.subscriptions.push(subcriptionExpiration);
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
  
	showDashboardWebview(context, dashboardData);
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

/**
 * Revokes the token and removes it from SecretStorage.
 * @param context The VS Code extension context (to access secrets).
 * @param tokenType 'access' or 'refresh' depending on which token you want to revoke.
 */
export async function revokeAnypointToken(context: vscode.ExtensionContext, tokenType: 'access' | 'refresh') {
	// 1. Retrieve the token from VS Code's SecretStorage
	const storageKey = tokenType === 'access' ? 'anypoint.accessToken' : 'anypoint.refreshToken';
	const token = await context.secrets.get(storageKey);
	
	if (!token) {
	  vscode.window.showWarningMessage(`No ${tokenType} token found to revoke.`);
	  return;
	}
  
	// 2. Build form data (POST x-www-form-urlencoded)
	const formData = new URLSearchParams();
	// MuleSoft expects the parameter to be "token" (the one you want to revoke)
	formData.append('token', token);
  
	// If your org requires client_id/client_secret in the body or Basic Auth:
	formData.append('client_id', CLIENT_ID);
	formData.append('client_secret', CLIENT_SECRET);
  
	// Basic Auth header (if required):
	const base64Creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  
	try {
	  // 3. Make the request to revoke
	  const response = await axios.post(REVOKE_ENDPOINT, formData.toString(), {
		headers: {
		  'Authorization': `Basic ${base64Creds}`,
		  'Content-Type': 'application/x-www-form-urlencoded'
		}
	  });
  
	  if (response.status === 200) {
		vscode.window.showInformationMessage(`Successfully revoked the ${tokenType} token.`);
		// 4. Remove the token from storage
		await context.secrets.delete(storageKey);
	  } else {
		throw new Error(`Revoke endpoint returned status ${response.status}`);
	  }
	} catch (error: any) {
	  vscode.window.showErrorMessage(`Error revoking token: ${error.message}`);
	}
}

// A command to start the OAuth flow
export async function loginToAnypointWithOAuth(context: vscode.ExtensionContext) {
	// 1. Start a local server to handle the OAuth redirect
	const server = http.createServer(async (req, res) => {
	  if (req.url && req.url.startsWith('/callback')) {
		// Extract 'code' from the query string
		const urlObj = new URL(req.url, `http://localhost:8082`);
		const code = urlObj.searchParams.get('code');
  
		if (!code) {
		  res.writeHead(400);
		  res.end('No code found in callback.');
		  return;
		}
  
		try {
		  // 2. Exchange the authorization code for tokens
		  await exchangeAuthorizationCodeForTokens(context, code);
  
		  res.writeHead(200);
		  res.end('Login successful! You can close this window.');
		  server.close();
		} catch (error: any) {
		  vscode.window.showErrorMessage(`Token exchange error: ${error.message || error}`);
		  res.writeHead(500);
		  res.end('Error exchanging tokens. Check VS Code for details.');
		  server.close();
		}
	  }
	});

	server.listen(8082, () => {
		//vscode.window.showInformationMessage('Starting local server on port 8082 for OAuth callback...');
	
		// 3. Build the authorization URL
		const authUrl = new URL(AUTHORIZATION_ENDPOINT);
		authUrl.searchParams.set('response_type', 'code');
		authUrl.searchParams.set('client_id', CLIENT_ID);
		authUrl.searchParams.set('redirect_uri', LOCAL_REDIRECT_URI);
		// Add any scopes or other params as needed
		authUrl.searchParams.set('scope', 'offline_access full');
	
		vscode.env.openExternal(vscode.Uri.parse(authUrl.toString())).then(success => {
			if (!success) {
			  vscode.window.showErrorMessage('Failed to open browser for Anypoint login.');
			}
		  });
	  });
}

// Helper function to exchange authorization code for tokens
async function exchangeAuthorizationCodeForTokens(context: vscode.ExtensionContext, code: string) {
	// Prepare request body (x-www-form-urlencoded)
	const data = new URLSearchParams();
	data.append('code', code);
	data.append('redirect_uri', LOCAL_REDIRECT_URI);
	data.append('grant_type', 'authorization_code');
	data.append('client_id', CLIENT_ID);
	// If your MuleSoft app requires basic auth or client_secret in body:
	data.append('client_secret', CLIENT_SECRET);
  
	// For Basic Auth, build the base64 credential string:
	const base64Creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  
	// Make the request
	const response = await axios.post(TOKEN_ENDPOINT, data.toString(), {
	  headers: {
		'Authorization': `Basic ${base64Creds}`,
		'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
	  },
	});
  
	if (response.status !== 200) {
	  throw new Error(`Token endpoint returned status ${response.status}`);
	}
  
	// The response should contain 'access_token' and 'refresh_token'
	const result = response.data as {
	  access_token?: string;
	  refresh_token?: string;
	  [key: string]: any;
	};
  
	if (!result.access_token) {
	  throw new Error(`No access_token found in response: ${JSON.stringify(result)}`);
	}
  
	vscode.window.showInformationMessage(`Received access token from Anypoint.`);
  
	// Store tokens securely in VS Code's SecretStorage
	await context.secrets.store('anypoint.accessToken', result.access_token);

	await getUserInfo(context);
	await getEnvironments(context);

	if (result.refresh_token) {
	  await context.secrets.store('anypoint.refreshToken', result.refresh_token);
	}
  
	// Optionally store user info or full response if needed
	// e.g., await context.secrets.store('anypoint.userInfo', JSON.stringify(result));
  
	// After storing, you can perform additional steps, like calling user info:
	// await getUserInfo(result.access_token);
}

async function refreshAccessToken(context: vscode.ExtensionContext): Promise<boolean> {
	// Retrieve the stored refresh token
	const storedRefreshToken = await context.secrets.get('anypoint.refreshToken');
	if (!storedRefreshToken) {
	  vscode.window.showErrorMessage('No refresh token found. Please log in again.');
	  return false;
	}
  
	// MuleSoft Token Endpoint
	const refreshData = new URLSearchParams();
	refreshData.append('grant_type', 'refresh_token');
	refreshData.append('refresh_token', storedRefreshToken);
  
	// If your MuleSoft config requires client ID/secret here:
	refreshData.append('client_id', CLIENT_ID);
	refreshData.append('client_secret', CLIENT_SECRET);
  
	// Build Basic Auth header (if needed)
	const base64Creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  
	try {
	  const response = await axios.post(TOKEN_ENDPOINT, refreshData.toString(), {
		headers: {
		  'Authorization': `Basic ${base64Creds}`,
		  'Content-Type': 'application/x-www-form-urlencoded'
		}
	  });
  
	  if (response.status !== 200) {
		throw new Error(`Refresh token request failed with status ${response.status}`);
	  }
  
	  const tokenData = response.data as {
		access_token?: string;
		refresh_token?: string;
	  };
  
	  if (!tokenData.access_token) {
		throw new Error(`No new access_token in refresh response: ${JSON.stringify(tokenData)}`);
	  }
  
	  // Store the new tokens
	  await context.secrets.store('anypoint.accessToken', tokenData.access_token);
	  if (tokenData.refresh_token) {
		await context.secrets.store('anypoint.refreshToken', tokenData.refresh_token);
	  }
  
	  vscode.window.showInformationMessage('Access token refreshed successfully!');
	  return true;
	} catch (err: any) {
	  vscode.window.showErrorMessage(`Failed to refresh token: ${err.message}`);
	  return false;
	}
}


// This method is called when your extension is deactivated
export function deactivate() {}
