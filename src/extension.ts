// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import {
    loginToAnypointWithOAuth,
    refreshAccessToken,
    revokeAnypointToken
} from "./controllers/oauthService";
import {
    retrieveApplications,
    getUserInfo,
    getOrganizationInfo,
    developerInfo,
    getEnvironments,
    getCH2Applications,
    getCH1Applications,
    retrieveAPIManagerAPIs
} from "./controllers/anypointService";
import { auditAPIs } from "./anypoint/apiAudit";
import { showCommunityEvents } from "./anypoint/communityEvents";
import { showRealTimeLogs } from "./anypoint/realTimeLogs";
import { BASE_URL } from "./constants";

interface EnvironmentOption {
	label: string;
	id: string;
}

async function selectEnvironment(context: vscode.ExtensionContext): Promise<string | null> {
	const storedEnvironments = await context.secrets.get('anypoint.environments');
	if (!storedEnvironments) {
		vscode.window.showErrorMessage('No environment information found. Please log in first.');
		return null;
	}

	const environments = JSON.parse(storedEnvironments) as {
		data: { id: string; name: string }[];
		total: number;
	};

	if (!environments.data || environments.data.length === 0) {
		vscode.window.showErrorMessage('No environments available.');
		return null;
	}

	const environmentOptions: EnvironmentOption[] = environments.data.map(env => ({
		label: env.name,
		id: env.id,
	}));

	const selectedEnvironment = await vscode.window.showQuickPick(
		environmentOptions.map(option => option.label),
		{
			placeHolder: 'Select an environment',
		}
	);

	if (!selectedEnvironment) {
		vscode.window.showInformationMessage('No environment selected.');
		return null;
	}

	const selectedEnvironmentId = environmentOptions.find(option => option.label === selectedEnvironment)?.id;
	if (!selectedEnvironmentId) {
		vscode.window.showErrorMessage('Failed to find the selected environment ID.');
		return null;
	}

	return selectedEnvironmentId;
}
import { provideFeedback } from "./anypoint/feedbackService";

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
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await retrieveApplications(context, selectedEnvironmentId);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message || error}`);
		}
	});
	  
	const getCH1Apps = vscode.commands.registerCommand('anypoint-monitor.cloudhub1Apps', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await getCH1Applications(context, selectedEnvironmentId);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message}`);
		}
	});

	const getApplications = vscode.commands.registerCommand('anypoint-monitor.cloudhub2Apps', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await getCH2Applications(context, selectedEnvironmentId);
		} catch (error: any) {
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

        const retrieveAPIManagerAPIsCmd = vscode.commands.registerCommand('anypoint-monitor.retrieveAPIManagerAPIs', async () => {
                await retrieveAPIManagerAPIs(context);
        });

	const communityEventsCmd = vscode.commands.registerCommand('anypoint-monitor.communityEvents', async () => {
		try {
			await showCommunityEvents(context);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error loading community events: ${error.message}`);
		}
	});

	const provideFeedbackCmd = vscode.commands.registerCommand('anypoint-monitor.provideFeedback', async () => {
		try {
			await provideFeedback(context);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error providing feedback: ${error.message}`);
		}
	});

	const auditAPIsCmd = vscode.commands.registerCommand('anypoint-monitor.auditAPIs', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await auditAPIs(context, selectedEnvironmentId);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error auditing APIs: ${error.message}`);
		}
	});

	const realTimeLogsCmd = vscode.commands.registerCommand('anypoint-monitor.realTimeLogs', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			
			// Get applications for the selected environment
			const userInfoStr = await context.secrets.get('anypoint.userInfo');
			const accessToken = await context.secrets.get('anypoint.accessToken');
			
			if (!userInfoStr || !accessToken) {
				vscode.window.showErrorMessage('Please log in first.');
				return;
			}

			const userInfoData = JSON.parse(userInfoStr);
			const organizationID = userInfoData.organization.id;

			console.log('Real-time logs: Environment ID:', selectedEnvironmentId);
			console.log('Real-time logs: Organization ID:', organizationID);
			console.log('Real-time logs: Access token exists:', !!accessToken);

			// Fetch both CloudHub 1.0 and 2.0 applications
			const axios = require('axios');
			let ch1Apps: any[] = [];
			let ch2Apps: any[] = [];

			// Fetch CloudHub 1.0 applications
			try {
				const ch1Response = await axios.get(BASE_URL + '/cloudhub/api/applications', {
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'X-ANYPNT-ENV-ID': selectedEnvironmentId,
						'X-ANYPNT-ORG-ID': organizationID,
					},
				});
				if (ch1Response.status === 200) {
					ch1Apps = Array.isArray(ch1Response.data) ? ch1Response.data : [];
					console.log(`Real-time logs: Found ${ch1Apps.length} CloudHub 1.0 applications`);
				}
			} catch (error: any) {
				console.error('CloudHub 1.0 apps fetch failed:', {
					status: error.response?.status,
					statusText: error.response?.statusText,
					data: error.response?.data,
					message: error.message
				});
				
				// Handle token refresh for 401 errors
				if (error.response?.status === 401) {
					console.log('Real-time logs: Attempting to refresh access token for CH1...');
					const didRefresh = await refreshAccessToken(context);
					if (didRefresh) {
						const newAccessToken = await context.secrets.get('anypoint.accessToken');
						try {
							const ch1RetryResponse = await axios.get(BASE_URL + '/cloudhub/api/applications', {
								headers: {
									Authorization: `Bearer ${newAccessToken}`,
									'X-ANYPNT-ENV-ID': selectedEnvironmentId,
									'X-ANYPNT-ORG-ID': organizationID,
								},
							});
							if (ch1RetryResponse.status === 200) {
								ch1Apps = Array.isArray(ch1RetryResponse.data) ? ch1RetryResponse.data : [];
								console.log(`Real-time logs: Found ${ch1Apps.length} CloudHub 1.0 applications after token refresh`);
							}
						} catch (retryError: any) {
							console.error('CloudHub 1.0 retry after refresh failed:', retryError.message);
						}
					}
				}
			}

			// Fetch CloudHub 2.0 applications
			try {
				const ch2Response = await axios.get(BASE_URL + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + selectedEnvironmentId + '/deployments', {
					headers: { Authorization: `Bearer ${accessToken}` },
				});
				if (ch2Response.status === 200) {
					// Handle different data structures from CH2 API response
					let applicationsData = ch2Response.data;
					console.log('Real-time logs: Raw CH2 response structure:', JSON.stringify(applicationsData, null, 2));
					
					if (Array.isArray(applicationsData)) {
						ch2Apps = applicationsData;
					} else if (applicationsData && typeof applicationsData === 'object') {
						// Check if it's wrapped in a property like { data: [...] } or { applications: [...] }
						ch2Apps = applicationsData.data || applicationsData.applications || applicationsData.items || [];
						
						// If still not an array, check for other common API response structures
						if (!Array.isArray(ch2Apps)) {
							ch2Apps = applicationsData.response?.data || 
									applicationsData.response?.applications ||
									applicationsData.result?.data ||
									applicationsData.result?.applications ||
									[];
						}
					}
					
					// Ensure we have an array
					if (!Array.isArray(ch2Apps)) {
						ch2Apps = [];
						console.warn('CH2 applications data is not in expected format. Received:', typeof applicationsData, applicationsData);
					} else {
						console.log(`Real-time logs: Found ${ch2Apps.length} CloudHub 2.0 applications`);
					}
				}
			} catch (error: any) {
				console.error('CloudHub 2.0 apps fetch failed:', {
					status: error.response?.status,
					statusText: error.response?.statusText,
					data: error.response?.data,
					message: error.message
				});
				
				// Handle token refresh for 401 errors
				if (error.response?.status === 401) {
					console.log('Real-time logs: Attempting to refresh access token for CH2...');
					const didRefresh = await refreshAccessToken(context);
					if (didRefresh) {
						const newAccessToken = await context.secrets.get('anypoint.accessToken');
						try {
							const ch2RetryResponse = await axios.get(BASE_URL + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + selectedEnvironmentId + '/deployments', {
								headers: { Authorization: `Bearer ${newAccessToken}` },
							});
							if (ch2RetryResponse.status === 200) {
								// Handle different data structures from CH2 API response
								let applicationsData = ch2RetryResponse.data;
								console.log('Real-time logs: Raw CH2 response structure after refresh:', JSON.stringify(applicationsData, null, 2));
								
								if (Array.isArray(applicationsData)) {
									ch2Apps = applicationsData;
								} else if (applicationsData && typeof applicationsData === 'object') {
									// Check if it's wrapped in a property like { data: [...] } or { applications: [...] }
									ch2Apps = applicationsData.data || applicationsData.applications || applicationsData.items || [];
									
									// If still not an array, check for other common API response structures
									if (!Array.isArray(ch2Apps)) {
										ch2Apps = applicationsData.response?.data || 
												applicationsData.response?.applications ||
												applicationsData.result?.data ||
												applicationsData.result?.applications ||
												[];
									}
								}
								
								// Ensure we have an array
								if (!Array.isArray(ch2Apps)) {
									ch2Apps = [];
									console.warn('CH2 applications data is not in expected format after refresh. Received:', typeof applicationsData, applicationsData);
								} else {
									console.log(`Real-time logs: Found ${ch2Apps.length} CloudHub 2.0 applications after token refresh`);
								}
							}
						} catch (retryError: any) {
							console.error('CloudHub 2.0 retry after refresh failed:', retryError.message);
						}
					}
				}
			}

			// Create unified application list
			const allApplications = [
				...ch1Apps.map(app => ({
					label: `📦 CH1: ${app.domain} (${app.status})`,
					domain: app.domain,
					cloudhubVersion: 'CH1' as const,
					status: app.status
				})),
				...await Promise.all(ch2Apps.map(async app => {
					// For CH2 apps, we need to fetch the specs to get the correct specificationId
					let specificationId = app.id; // Default fallback to deployment ID
					
					try {
						const specsUrl = `${BASE_URL}/amc/application-manager/api/v2/organizations/${organizationID}/environments/${selectedEnvironmentId}/deployments/${app.id}/specs`;
						let currentAccessToken = accessToken;
						
						try {
							const specsResponse = await axios.get(specsUrl, {
								headers: { Authorization: `Bearer ${currentAccessToken}` },
							});
							
							if (specsResponse.status === 200 && specsResponse.data) {
								console.log(`Real-time logs: Raw specs response for deployment ${app.id}:`, JSON.stringify(specsResponse.data, null, 2));
								
								const specs = Array.isArray(specsResponse.data) ? specsResponse.data : specsResponse.data.data || [];
								console.log(`Real-time logs: Processed specs array length: ${specs.length}`);
								
								if (specs.length > 0) {
									// Get the latest spec (first one is usually the latest)
									const latestSpec = specs[0];
									console.log(`Real-time logs: Latest spec structure:`, JSON.stringify(latestSpec, null, 2));
									
									// Check for different ID fields like the working implementation does
									specificationId = latestSpec.id || latestSpec.version || app.id;
									console.log(`Real-time logs: Found spec ID ${specificationId} for deployment ${app.id} (id: ${latestSpec.id}, version: ${latestSpec.version})`);
								} else {
									console.log(`Real-time logs: No specs found for deployment ${app.id}, using deployment ID as fallback`);
								}
							}
						} catch (specsError: any) {
							// Handle token refresh for specs API
							if (specsError.response?.status === 401) {
								console.log(`Real-time logs: Attempting to refresh access token for specs API (deployment ${app.id})...`);
								const didRefresh = await refreshAccessToken(context);
								if (didRefresh) {
									currentAccessToken = await context.secrets.get('anypoint.accessToken') || accessToken;
									const specsRetryResponse = await axios.get(specsUrl, {
										headers: { Authorization: `Bearer ${currentAccessToken}` },
									});
									
									if (specsRetryResponse.status === 200 && specsRetryResponse.data) {
										console.log(`Real-time logs: Raw specs retry response for deployment ${app.id}:`, JSON.stringify(specsRetryResponse.data, null, 2));
										
										const specs = Array.isArray(specsRetryResponse.data) ? specsRetryResponse.data : specsRetryResponse.data.data || [];
										console.log(`Real-time logs: Processed specs retry array length: ${specs.length}`);
										
										if (specs.length > 0) {
											// Get the latest spec (first one is usually the latest)
											const latestSpec = specs[0];
											console.log(`Real-time logs: Latest retry spec structure:`, JSON.stringify(latestSpec, null, 2));
											
											// Check for different ID fields like the working implementation does
											specificationId = latestSpec.id || latestSpec.version || app.id;
											console.log(`Real-time logs: Found spec ID ${specificationId} for deployment ${app.id} after token refresh (id: ${latestSpec.id}, version: ${latestSpec.version})`);
										} else {
											console.log(`Real-time logs: No specs found for deployment ${app.id} after retry, using deployment ID as fallback`);
										}
									}
								}
							} else {
								throw specsError;
							}
						}
					} catch (specError: any) {
						console.warn(`Real-time logs: Could not fetch specs for deployment ${app.id}, using deployment ID as spec ID:`, specError.message);
					}
					
					return {
						label: `🚀 CH2: ${app.name} (${app.status})`,
						domain: app.name,
						cloudhubVersion: 'CH2' as const,
						status: app.status,
						deploymentId: app.id,
						specificationId: specificationId
					};
				}))
			];

			if (allApplications.length === 0) {
				vscode.window.showErrorMessage('No applications found in this environment.');
				return;
			}

			// Show unified application selection
			const selectedAppLabel = await vscode.window.showQuickPick(
				allApplications.map(app => app.label),
				{ 
					placeHolder: 'Select an application for real-time logs (CH1 = CloudHub 1.0, CH2 = CloudHub 2.0)',
					title: 'Real-Time Logs - Select Application'
				}
			);

			if (!selectedAppLabel) {
				vscode.window.showInformationMessage('No application selected.');
				return;
			}

			const selectedApp = allApplications.find(app => app.label === selectedAppLabel);
			if (!selectedApp) {
				vscode.window.showErrorMessage('Failed to determine selected application.');
				return;
			}

			// Show real-time logs with appropriate parameters
			if (selectedApp.cloudhubVersion === 'CH2') {
				await showRealTimeLogs(
					context, 
					selectedEnvironmentId, 
					selectedApp.domain, 
					'CH2',
					selectedApp.deploymentId,
					selectedApp.specificationId
				);
			} else {
				await showRealTimeLogs(
					context, 
					selectedEnvironmentId, 
					selectedApp.domain, 
					'CH1'
				);
			}
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error starting real-time logs: ${error.message}`);
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
	context.subscriptions.push(retrieveAPIManagerAPIsCmd);
	context.subscriptions.push(communityEventsCmd);
	context.subscriptions.push(provideFeedbackCmd);
	context.subscriptions.push(auditAPIsCmd);
	context.subscriptions.push(realTimeLogsCmd);
}

// This method is called when your extension is deactivated
export function deactivate() {}
