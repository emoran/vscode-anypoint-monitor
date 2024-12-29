// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "anypoint-monitor" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('anypoint-monitor.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from anypoint-monitor!!');
		var panel = vscode.window.createWebviewPanel(
			'toolbox',
			'Home',
			vscode.ViewColumn.One,
			{}
		);
		panel.webview.html =getWebviewContent();
	});

	context.subscriptions.push(disposable);
}

function getWebviewContent(): string {
	return /* html */ `
	<!DOCTYPE html>
	<html lang="en">
	  <head>
		<meta charset="UTF-8" />
		<style>
		  * {
			box-sizing: border-box;
		  }
		  body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
						 Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
			margin: 0;
			padding: 0;
			background-color: #f5f5f5;
		  }
		  
		  /* Top navigation / tab container */
		  .tab-bar {
			display: flex;
			border-bottom: 1px solid #ccc;
			background-color: #fff;
		  }
		  .tab-bar div {
			padding: 10px 15px;
			cursor: pointer;
			font-weight: 500;
		  }
		  .tab-bar div:hover {
			background-color: #eee;
		  }
		  .tab-bar .active {
			border-bottom: 3px solid #007acc; /* VS Code blue accent */
			font-weight: 600;
		  }
  
		  /* Container for page content */
		  .content {
			padding: 20px;
		  }
  
		  .button-container {
			margin-bottom: 1rem;
		  }
		  .invite-button {
			background-color: #007acc;
			color: #fff;
			border: none;
			padding: 8px 16px;
			cursor: pointer;
			font-size: 0.9rem;
			border-radius: 4px;
		  }
		  .invite-button:hover {
			background-color: #005fa3;
		  }
  
		  /* Table styling */
		  .table-container {
			overflow-x: auto; /* horizontal scroll if needed */
			background-color: #fff;
			padding: 1rem;
			border-radius: 5px;
			box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
		  }
		  table {
			border-collapse: collapse;
			width: 100%;
		  }
		  thead {
			background-color: #fafafa;
		  }
		  th, td {
			text-align: left;
			padding: 12px;
		  }
		  th {
			color: #333;
			font-weight: 600;
		  }
		  tr:not(:first-child) {
			border-top: 1px solid #e0e0e0;
		  }
		  tr:hover {
			background-color: #f9f9f9;
		  }
		  .subtext {
			color: #666;
			font-size: 0.9rem;
			font-style: italic;
		  }
		  .disabled {
			color: #888;
			font-size: 0.9rem;
		  }
		</style>
	  </head>
	  <body>
		<!-- Tabs / Navigation -->
		<div class="tab-bar">
		  <div class="active">Users</div>
		  <div>Pending invitations</div>
		  <div>Public portal access</div>
		</div>
  
		<!-- Main content area -->
		<div class="content">
		  <div class="button-container">
			<button class="invite-button">Invite users</button>
		  </div>
		  
		  <div class="table-container">
			<table>
			  <thead>
				<tr>
				  <th>Name</th>
				  <th>Username</th>
				  <th>Email</th>
				  <th>Identity provider</th>
				  <th>Multi-factor auth</th>
				</tr>
			  </thead>
			  <tbody>
				<tr>
				  <td>
					Edgar Moran
					<div class="subtext">This is you</div>
				  </td>
				  <td>edgarmoran</td>
				  <td>yucel.moran@gmail.com</td>
				  <td>Anypoint</td>
				  <td class="disabled">Not Enabled</td>
				</tr>
				<tr>
				  <td>
					Jane Doe
				  </td>
				  <td>jdoe</td>
				  <td>jane.doe@example.com</td>
				  <td>Azure AD</td>
				  <td class="disabled">Not Enabled</td>
				</tr>
				<tr>
				  <td>
					John Smith
				  </td>
				  <td>jsmith</td>
				  <td>john.smith@example.org</td>
				  <td>Anypoint</td>
				  <td>Enabled</td>
				</tr>
			  </tbody>
			</table>
		  </div>
		</div>
	  </body>
	</html>
	`;
  }

// This method is called when your extension is deactivated
export function deactivate() {}
