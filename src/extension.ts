// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as http from 'http';


// Replace these with your actual MuleSoft OAuth client details
const CLIENT_ID = '05ce4abd0fc047b4bcd512f15b3445c9';
const CLIENT_SECRET = 'b5d7dBEe693c4C3fa50C183A3f6570D2';

// MuleSoft OAuth Endpoints
const AUTHORIZATION_ENDPOINT = 'https://anypoint.mulesoft.com/accounts/api/v2/oauth2/authorize';
const TOKEN_ENDPOINT = 'https://anypoint.mulesoft.com/accounts/api/v2/oauth2/token';

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
		} catch (error: any) {
		  vscode.window.showErrorMessage(`Login failed: ${error.message || error}`);
		}
	  });

	  const userInfo = vscode.commands.registerCommand('anypoint-monitor.userInfo', async () => {
		try {
		  await getUserInfo(context);
		} catch (error: any) {
		  vscode.window.showErrorMessage(`Error: ${error.message || error}`);
		}
	  });

	context.subscriptions.push(loginCommand);
}


async function getUserInfo(context: vscode.ExtensionContext) {
	// Retrieve tokens from SecretStorage
	const accessToken = await context.secrets.get('anypoint.accessToken');
	if (!accessToken) {
	  throw new Error('No access token found. Please log in first.');
	}
  
	// Example: calling a random MuleSoft API endpoint
	// Replace with your actual endpoint
	const apiUrl = 'https://anypoint.mulesoft.com/accounts/api/me';
  
	const response = await axios.get(apiUrl, {
	  headers: {
		Authorization: `Bearer ${accessToken}`
	  }
	});
  
	if (response.status !== 200) {
	  throw new Error(`API request failed with status ${response.status}`);
	}
  
	// Log or display data
	const data = response.data;

	const panel = vscode.window.createWebviewPanel(
		'userInfoWebview',
		'User Information',
		vscode.ViewColumn.One,
		{ enableScripts: true }
	  );
  
	  // Use the helper function to generate HTML
	  panel.webview.html = getUserInfoWebviewContent(data);

	 vscode.window.showInformationMessage(`API response: ${JSON.stringify(data)}`);
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
		vscode.window.showInformationMessage('Starting local server on port 8082 for OAuth callback...');
	
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
	if (result.refresh_token) {
	  await context.secrets.store('anypoint.refreshToken', result.refresh_token);
	}
  
	// Optionally store user info or full response if needed
	// e.g., await context.secrets.store('anypoint.userInfo', JSON.stringify(result));
  
	// After storing, you can perform additional steps, like calling user info:
	// await getUserInfo(result.access_token);
  }

/**
 * Returns an HTML string that displays selected user info from the JSON in a styled table.
 * @param userJson The JSON object containing user data (the entire object you provided).
 */
export function getUserInfoWebviewContent(userObject: any): string {
	// Extract the "user" object from the JSON
	const user = userObject.user;
	if (!user) {
	  return `<html>
		<body>
		  <h2>No user data found.</h2>
		</body>
	  </html>`;
	}
  
	// Safely access nested objects (like organization)
	const org = user.organization || {};
	
	// Example fields to display
	const firstName = user.firstName ?? 'N/A';
	const lastName = user.lastName ?? 'N/A';
	const email = user.email ?? 'N/A';
	const phoneNumber = user.phoneNumber ?? 'N/A';
	const username = user.username ?? 'N/A';
	const lastLogin = user.lastLogin ?? 'N/A';
  
	const orgName = org.name ?? 'N/A';
	const orgId = org.id ?? 'N/A';
	const orgType = org.orgType ?? 'N/A';
	const subscriptionType = org.subscription?.type ?? 'N/A';
	const subscriptionExp = org.subscription?.expiration ?? 'N/A';
  
	return /* html */ `
	<!DOCTYPE html>
	<html lang="en">
	  <head>
		<meta charset="UTF-8" />
		 <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                       Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue",
                       sans-serif;
          margin: 0;
          padding: 16px;
          background-color: #f3f3f3;
          color: #333; /* Ensure text is dark (black/near-black) */
        }
        h1, h2 {
          margin-top: 0;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          background: #fff;
          padding: 16px;
          border-radius: 8px;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        .section-title {
          margin: 24px 0 8px;
          font-size: 1.25rem;
          border-bottom: 2px solid #007acc;
          color: #007acc; /* Section title in VS Code's blue accent */
        }
        table {
          border-collapse: collapse;
          width: 100%;
          margin-bottom: 16px;
        }
        th, td {
          text-align: left;
          padding: 8px;
        }
        th {
          background-color: #007acc; /* Table header background */
          color: #ffffff;           /* Table header text color */
        }
        tr:nth-child(even) {
          background-color: #f9f9f9; 
        }
      </style>
	  </head>
	  <body>
		<div class="container">
		  <h1>Anypoint User Info</h1>
  
		  <div class="section-title">User Details</div>
		  <table>
			<tr>
			  <th>Field</th>
			  <th>Value</th>
			</tr>
			<tr>
			  <td>ID</td>
			  <td>${user.id}</td>
			</tr>
			<tr>
			  <td>First Name</td>
			  <td>${firstName}</td>
			</tr>
			<tr>
			  <td>Last Name</td>
			  <td>${lastName}</td>
			</tr>
			<tr>
			  <td>Email</td>
			  <td>${email}</td>
			</tr>
			<tr>
			  <td>Phone Number</td>
			  <td>${phoneNumber}</td>
			</tr>
			<tr>
			  <td>Username</td>
			  <td>${username}</td>
			</tr>
			<tr>
			  <td>Last Login</td>
			  <td>${lastLogin}</td>
			</tr>
		  </table>
  
		  <div class="section-title">Organization</div>
		  <table>
			<tr>
			  <th>Field</th>
			  <th>Value</th>
			</tr>
			<tr>
			  <td>Organization ID</td>
			  <td>${orgId}</td>
			</tr>
			<tr>
			  <td>Organization Name</td>
			  <td>${orgName}</td>
			</tr>
			<tr>
			  <td>Organization Type</td>
			  <td>${orgType}</td>
			</tr>
			<tr>
			  <td>Subscription Type</td>
			  <td>${subscriptionType}</td>
			</tr>
			<tr>
			  <td>Subscription Expires</td>
			  <td>${subscriptionExp}</td>
			</tr>
		  </table>
		</div>
	  </body>
	</html>
	`;
  }

// This method is called when your extension is deactivated
export function deactivate() {}
