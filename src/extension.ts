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
import { showCommunityEvents } from "./anypoint/communityEvents";
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

			// MODIFIED: Pass both context and environment ID
			await getCH2Applications(context, selectedEnvironmentId);
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
}

// This method is called when your extension is deactivated
export function deactivate() {}
