// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import {
    loginToAnypointWithOAuth,
    refreshAccessToken,
    revokeAnypointToken
} from "./controllers/oauthService";
import {
	getUserInfo,
	getOrganizationInfo,
	developerInfo,
	getEnvironments,
    getCH2Applications,
    getCH1Applications,
    retrieveAPIManagerAPIs,
    getEnvironmentComparison,
	getHybridApplications,
	getHybridServers,
	getHybridServerGroups,
	getHybridClusters
} from "./controllers/anypointService";
import { auditAPIs } from "./anypoint/apiAudit";
import { showCommunityEvents } from "./anypoint/communityEvents";
import { showRealTimeLogs } from "./anypoint/realTimeLogs";
import { BASE_URL } from "./constants";
import { showApplicationDiagram } from "./anypoint/applicationDiagram";
import { showDataWeavePlayground } from "./anypoint/dataweavePlayground";
import { showApplicationCommandCenter } from "./anypoint/applicationCommandCenter";

interface EnvironmentOption {
	label: string;
	id: string;
}

async function selectEnvironment(context: vscode.ExtensionContext): Promise<string | null> {
	const accountService = new AccountService(context);
	
	let storedEnvironments = await accountService.getActiveAccountEnvironments();
	if (!storedEnvironments) {
		storedEnvironments = await context.secrets.get('anypoint.environments');
		if (!storedEnvironments) {
			// Try to fetch environments if none are stored
			try {
				console.log('No environments found, fetching from API...');
				await getEnvironments(context, false);
				storedEnvironments = await accountService.getActiveAccountEnvironments();
				if (!storedEnvironments) {
					storedEnvironments = await context.secrets.get('anypoint.environments');
				}
			} catch (error: any) {
				console.error('Failed to fetch environments:', error);
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

	console.log(`Environment Selection: Found ${environments.data?.length || 0} environments`);
	console.log(`Environment Selection: Available environments:`, environments.data?.map(e => `${e.name} (${e.id})`));

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
import { showAccountManagerWebview } from "./anypoint/accountManager";
import { AccountService } from "./controllers/accountService";

// Helper function to refresh token with account context
async function refreshTokenWithAccount(context: vscode.ExtensionContext): Promise<boolean> {
	const accountService = new AccountService(context);
	const activeAccount = await accountService.getActiveAccount();
	return await refreshAccessToken(context, activeAccount?.id);
}

// Helper function to get fresh token after refresh
async function getRefreshedToken(context: vscode.ExtensionContext): Promise<string | undefined> {
	const accountService = new AccountService(context);
	
	let accessToken = await accountService.getActiveAccountAccessToken();
	if (!accessToken) {
		accessToken = await context.secrets.get('anypoint.accessToken');
	}
	return accessToken;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
// Global status bar item for active account
let accountStatusBarItem: vscode.StatusBarItem;

// Function to update the account status bar
export async function updateAccountStatusBar(context: vscode.ExtensionContext) {
	try {
		const accountService = new AccountService(context);
		const activeAccount = await accountService.getActiveAccount();
		
		if (activeAccount) {
			// Show active account with organization name
			const displayName = activeAccount.userName || 'Unknown User';
			const orgName = activeAccount.organizationName || 'Unknown Org';
			
			accountStatusBarItem.text = `$(organization) ${displayName} • ${orgName}`;
			accountStatusBarItem.backgroundColor = undefined; // Default color for active
			accountStatusBarItem.show();
		} else {
			// No active account
			accountStatusBarItem.text = `$(alert) No Anypoint Account`;
			accountStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			accountStatusBarItem.show();
		}
	} catch (error) {
		// Error getting account info
		accountStatusBarItem.text = `$(error) Anypoint Account Error`;
		accountStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		accountStatusBarItem.show();
		console.error('Failed to update account status bar:', error);
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Initialize account service and migrate existing account if needed
	const accountService = new AccountService(context);
	
	// Run automatic migration for existing users
	accountService.checkAndPromptMigration().then(migrated => {
		if (migrated) {
			// Update status bar to reflect the migrated account
			updateAccountStatusBar(context);
			console.log('✅ Legacy account migration completed on startup');
		}
	}).catch(err => {
		console.error('Failed to migrate existing account:', err);
	});

	// Create status bar item for active account
	accountStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	accountStatusBarItem.command = 'anypoint-monitor.accountManager';
	accountStatusBarItem.tooltip = 'Click to open Account Manager';
	context.subscriptions.push(accountStatusBarItem);

	// Initialize status bar
	updateAccountStatusBar(context);

	 // Register a command for the login
        const loginCommand = vscode.commands.registerCommand('anypoint-monitor.login', async () => {
                try {
                        await loginToAnypointWithOAuth(context);
                        await getUserInfo(context);
                        await getEnvironments(context);
                        // Update status bar after successful login
                        await updateAccountStatusBar(context);
                }
                catch (error: any) {
                        vscode.window.showErrorMessage(`Login failed: ${error.message || error}`);
                        // Update status bar to show error state
                        await updateAccountStatusBar(context);
                }
        });

	const revokeAccessCommand = vscode.commands.registerCommand('anypoint-monitor.logout', async () => {
		try {
			await revokeAnypointToken(context, 'access');
			// Update status bar after logout
			await updateAccountStatusBar(context);
		} 
		catch (err: any) {
			vscode.window.showErrorMessage(`Failed to revoke access token: ${err.message}`);
			// Update status bar to reflect error state
			await updateAccountStatusBar(context);
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

	const applicationDiagramCmd = vscode.commands.registerCommand('anypoint-monitor.applicationDiagram', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await showApplicationDiagram(context, selectedEnvironmentId);
		}
		catch (error: any) {
			vscode.window.showErrorMessage(`Failed to build application diagram: ${error.message || error}`);
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
			const accountService = new AccountService(context);
			const userInfoStr = await accountService.getActiveAccountUserInfo();
	
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
		const didRefresh = await refreshTokenWithAccount(context);
		if (!didRefresh) {
		  vscode.window.showErrorMessage('Failed to refresh access token. Please log in again.');
		  return;
		}
		
		// Retrieve the newly refreshed access token using multi-account system
		const accountService = new AccountService(context);
		const refreshedToken = await accountService.getActiveAccountAccessToken();
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
			
			// Use the new multi-account system
			const accountService = new AccountService(context);
			const activeAccount = await accountService.getActiveAccount();
			
			if (!activeAccount) {
				vscode.window.showErrorMessage('No active account found. Please log in first.');
				return;
			}

			const organizationID = activeAccount.organizationId;

			console.log('Real-time logs: Environment ID:', selectedEnvironmentId);
			console.log('Real-time logs: Organization ID:', organizationID);
			console.log('Real-time logs: Active account:', activeAccount.userName, '(' + activeAccount.organizationName + ')');

			// Fetch both CloudHub 1.0 and 2.0 applications using the new ApiHelper
			const { ApiHelper } = await import('./controllers/apiHelper.js');
			const apiHelper = new ApiHelper(context);
			let ch1Apps: any[] = [];
			let ch2Apps: any[] = [];

			// Fetch CloudHub 1.0 applications
			try {
				console.log('Real-time logs: Fetching CloudHub 1.0 applications...');
				const ch1Response = await apiHelper.get(BASE_URL + '/cloudhub/api/applications', {
					headers: {
						'X-ANYPNT-ENV-ID': selectedEnvironmentId,
						'X-ANYPNT-ORG-ID': organizationID,
					},
				});
				if (ch1Response.status === 200) {
					ch1Apps = Array.isArray(ch1Response.data) ? ch1Response.data : [];
					console.log(`Real-time logs: Found ${ch1Apps.length} CloudHub 1.0 applications`);
				}
			} catch (error: any) {
				console.error('Real-time logs: CloudHub 1.0 apps fetch failed:', error.message);
			}

			// Fetch CloudHub 2.0 applications
			try {
				console.log('Real-time logs: Fetching CloudHub 2.0 applications...');
				const ch2Response = await apiHelper.get(BASE_URL + '/amc/application-manager/api/v2/organizations/' + organizationID + '/environments/' + selectedEnvironmentId + '/deployments');
				
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
				console.error('Real-time logs: CloudHub 2.0 apps fetch failed:', error.message);
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
						
						const specsResponse = await apiHelper.get(specsUrl);
						
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

	const environmentComparisonCmd = vscode.commands.registerCommand('anypoint-monitor.environmentComparison', async () => {
		try {
			await getEnvironmentComparison(context);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error loading environment comparison: ${error.message}`);
		}
	});

	const dataweavePlaygroundCmd = vscode.commands.registerCommand('anypoint-monitor.dataweavePlayground', async () => {
		try {
			await showDataWeavePlayground(context);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error opening DataWeave Playground: ${error.message}`);
		}
	});

	const accountManagerCmd = vscode.commands.registerCommand('anypoint-monitor.accountManager', async () => {
		try {
			await showAccountManagerWebview(context);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error opening Account Manager: ${error.message}`);
		}
	});

	// Command to delete all accounts and data
	const deleteAllAccountsCmd = vscode.commands.registerCommand('anypoint-monitor.deleteAllAccounts', async () => {
		const confirmation = await vscode.window.showWarningMessage(
			'This will delete all stored accounts, tokens, and extension data. This action cannot be undone.',
			{ modal: true },
			'Delete All Data',
			'Cancel'
		);

		if (confirmation === 'Delete All Data') {
			try {
				const accountService = new AccountService(context);
				
				// Delete all accounts
				const accounts = await accountService.getAccounts();
				for (const account of accounts) {
					await accountService.removeAccount(account.id);
				}

				// Clear legacy storage
				const legacyKeys = [
					'anypoint.accessToken',
					'anypoint.refreshToken', 
					'anypoint.userInfo',
					'anypoint.environments',
					'anypoint.selectedEnvironment',
					'anypoint.tempAccessToken',
					'anypoint.tempRefreshToken',
					'anypoint.tempUserInfo',
					'anypoint.tempEnvironments'
				];

				for (const key of legacyKeys) {
					try {
						await context.secrets.delete(key);
					} catch (error) {
						// Ignore errors for keys that don't exist
					}
				}

				// Update status bar
				await updateAccountStatusBar(context);

				vscode.window.showInformationMessage('All accounts and extension data have been deleted successfully.');
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to delete accounts: ${error.message}`);
			}
		}
	});

	// Manual migration command for existing users
	const migrateLegacyAccountCmd = vscode.commands.registerCommand('anypoint-monitor.migrateLegacyAccount', async () => {
		try {
			const accountService = new AccountService(context);

			vscode.window.showInformationMessage('Checking for legacy account data to migrate...');

			const migrationResult = await accountService.migrateLegacyAccount();

			if (migrationResult.migrated && migrationResult.accountId) {
				const account = await accountService.getAccountById(migrationResult.accountId);
				await updateAccountStatusBar(context);

				vscode.window.showInformationMessage(
					`✅ Successfully migrated legacy account: ${account?.userEmail} (${account?.organizationName}). ` +
					`Your account is now using the new multi-account system!`
				);
			} else if (migrationResult.error) {
				vscode.window.showErrorMessage(`Migration failed: ${migrationResult.error}`);
			} else {
				// Check if already migrated
				const existingAccounts = await accountService.getAccounts();
				if (existingAccounts.length > 0) {
					vscode.window.showInformationMessage(
						'You already have accounts in the multi-account system. No migration needed.'
					);
				} else {
					vscode.window.showInformationMessage(
						'No legacy account data found to migrate. You may need to log in first.'
					);
				}
			}
		} catch (error: any) {
			vscode.window.showErrorMessage(`Migration failed: ${error.message}`);
		}
	});

	const applicationCommandCenterCmd = vscode.commands.registerCommand('anypoint-monitor.applicationCommandCenter', async () => {
		try {
			await showApplicationCommandCenter(context);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error opening Application Command Center: ${error.message}`);
		}
	});

	// Hybrid / On-Premises Commands
	const getHybridApps = vscode.commands.registerCommand('anypoint-monitor.hybridApps', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await getHybridApplications(context, selectedEnvironmentId);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message}`);
		}
	});

	const getHybridServersCmd = vscode.commands.registerCommand('anypoint-monitor.hybridServers', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await getHybridServers(context, selectedEnvironmentId);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message}`);
		}
	});

	const getHybridServerGroupsCmd = vscode.commands.registerCommand('anypoint-monitor.hybridServerGroups', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await getHybridServerGroups(context, selectedEnvironmentId);
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message}`);
		}
	});

	const getHybridClustersCmd = vscode.commands.registerCommand('anypoint-monitor.hybridClusters', async () => {
		try {
			const selectedEnvironmentId = await selectEnvironment(context);
			if (!selectedEnvironmentId) {
				return;
			}
			await getHybridClusters(context, selectedEnvironmentId);
		} catch (error: any) {
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
	context.subscriptions.push(applicationDiagramCmd);
	context.subscriptions.push(subcriptionExpiration);
	context.subscriptions.push(retrieveAccessToken);
	context.subscriptions.push(retrieveAPIManagerAPIsCmd);
	context.subscriptions.push(communityEventsCmd);
	context.subscriptions.push(provideFeedbackCmd);
	context.subscriptions.push(auditAPIsCmd);
	context.subscriptions.push(realTimeLogsCmd);
	context.subscriptions.push(environmentComparisonCmd);
	context.subscriptions.push(dataweavePlaygroundCmd);
	context.subscriptions.push(accountManagerCmd);
	context.subscriptions.push(deleteAllAccountsCmd);
	context.subscriptions.push(migrateLegacyAccountCmd);
	context.subscriptions.push(applicationCommandCenterCmd);
	context.subscriptions.push(getHybridApps);
	context.subscriptions.push(getHybridServersCmd);
	context.subscriptions.push(getHybridServerGroupsCmd);
	context.subscriptions.push(getHybridClustersCmd);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Optional: Add cleanup logic here if needed
	console.log('Anypoint Monitor extension is being deactivated');
}
