import * as vscode from 'vscode';
import axios from 'axios';

interface IEnvironment {
  id: string;
  name: string;
}

export async function showEnvironmentAndOrgPanel(
  context: vscode.ExtensionContext,
  userInfo: { orgName: string; orgId: string },
  environments: IEnvironment[]
) {
  try {
    // 1) Retrieve stored access token
    const accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
      vscode.window.showErrorMessage('No access token found. Please log in first.');
      return;
    }

    // 2) Make the API call to fetch clients
    const url = `https://anypoint.mulesoft.com/accounts/api/organizations/${userInfo.orgId}/clients`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const allClients = response.data;
    // Filter for records where name contains "Org: Cisco Meraki - Env:"
    const merakiClients: Array<{
      client_id: string;
      client_secret: string;
      name: string;
    }> = [];

    for (const key of Object.keys(allClients)) {
      const c = allClients[key];
      if (c.name && c.name.includes('Org: Cisco Meraki - Env:')) {
        merakiClients.push({
          client_id: c.client_id,
          client_secret: c.client_secret,
          name: c.name
        });
      }
    }

    // 3) Create Webview Panel
    const panel = vscode.window.createWebviewPanel(
      'environmentOrgView',
      'Environment & Organization Info',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    // 4) Set HTML content
    panel.webview.html = getEnvironmentOrgHtml(panel.webview, context.extensionUri, userInfo, environments, merakiClients);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Error fetching clients: ${err.message}`);
  }
}

/**
 * Generates HTML showing:
 *  - A table of Environments
 *  - A table of Meraki Clients (Name, Client ID, Client Secret)
 *  - Client secret is hidden by default (*****). The user can Show/Hide it
 *  - Both client_id and client_secret are clickable to copy their values
 */
function getEnvironmentOrgHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  userInfo: { orgName: string; orgId: string },
  environments: IEnvironment[],
  merakiClients: Array<{
    client_id: string;
    client_secret: string;
    name: string;
  }>
): string {

  // Environment table
  const environmentRows = environments.map(env => {
    return /* html */ `
      <tr>
        <td>${env.name || '(No Name)'}</td>
        <td>${env.id || '(No ID)'}</td>
      </tr>
    `;
  }).join('');

  // Clients table
  // We remove the "Key" column. Make "Client Name" first. Then "Client ID". Then "Client Secret."
  const merakiClientRows = merakiClients.map(client => {
    // By default, secret is hidden with asterisks
    const secretAsterisks = '*****';

    return /* html */ `
      <tr>
        <!-- Client Name first column -->
        <td>${client.name}</td>

        <!-- Client ID with click-to-copy -->
        <td>
          <span class="copyable" data-copy="${client.client_id}" title="Click to copy">
            ${client.client_id}
          </span>
        </td>

        <!-- Client Secret with show/hide toggle and click-to-copy -->
        <td>
          <!-- Real secret is stored in data-secret; the displayed text is ***** initially -->
          <span
            class="client-secret copyable"
            data-secret="${client.client_secret}"
            title="Click to copy secret"
          >
            ${secretAsterisks}
          </span>
          &nbsp;
          <button class="toggle-secret">Show</button>
        </td>
      </tr>
    `;
  }).join('');

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Environment & Org Info</title>
      <style>
        body {
          margin: 0; padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
          background-color: #f7f7f7; color: #333;
        }

        .container {
          max-width: 1200px; margin: 1rem auto; padding: 1rem;
          background-color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        h2, h3 { margin-top: 0; }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1.5rem;
        }
        th, td {
          border: 1px solid #ddd;
          padding: 8px 12px;
          text-align: left;
        }
        th {
          background-color: #f4f4f4;
        }

        /* Feedback message for copy */
        .copy-feedback {
          color: green; font-size: 0.8rem; margin-left: 0.5rem;
          display: none;
        }
        .copyable {
          cursor: pointer;
          text-decoration: underline;
        }
        .toggle-secret {
          margin-left: 0.5rem;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Organization: ${userInfo.orgName} (ID: ${userInfo.orgId})</h2>

        <!-- ENVIRONMENT TABLE -->
        <h3>All Environments</h3>
        <table>
          <thead>
            <tr>
              <th>Environment Name</th>
              <th>Environment ID</th>
            </tr>
          </thead>
          <tbody>
            ${environmentRows}
          </tbody>
        </table>

        <!-- MERAKI CLIENTS TABLE -->
        <h3>Meraki Clients (Name contains "Org: Cisco Meraki - Env:")</h3>
        <table>
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Client ID</th>
              <th>Client Secret</th>
            </tr>
          </thead>
          <tbody>
            ${merakiClientRows}
          </tbody>
        </table>
      </div>

      <script>
        // For showing "copied" feedback briefly
        function showCopiedFeedback(element) {
          const feedbackSpan = document.createElement('span');
          feedbackSpan.className = 'copy-feedback';
          feedbackSpan.textContent = 'Copied!';
          element.insertAdjacentElement('afterend', feedbackSpan);
          feedbackSpan.style.display = 'inline';

          setTimeout(() => {
            feedbackSpan.remove();
          }, 1200);
        }

        document.addEventListener('click', (e) => {
          const target = e.target;

          // 1) Toggle-secret button
          if (target.classList.contains('toggle-secret')) {
            const secretCell = target.parentElement;
            if (!secretCell) return;

            const secretSpan = secretCell.querySelector('.client-secret');
            if (!secretSpan) return;

            const currentText = secretSpan.textContent || '';
            const realSecret = secretSpan.getAttribute('data-secret') || '';
            if (currentText === '*****') {
              // Show it
              secretSpan.textContent = realSecret;
              target.textContent = 'Hide';
            } else {
              // Hide it
              secretSpan.textContent = '*****';
              target.textContent = 'Show';
            }
          }

          // 2) Click-to-copy for client_id or client_secret
          if (target.classList.contains('copyable')) {
            // If it's the secret, we might have to see if it's hidden or not
            // But easiest approach: always copy from the data-secret or data-copy
            // if it exists, else copy the displayed text
            const dataCopy = target.getAttribute('data-copy'); 
            const dataSecret = target.getAttribute('data-secret');
            let textToCopy = '';

            // If there's a "data-copy" attribute, use that (for client_id).
            if (dataCopy) {
              textToCopy = dataCopy;
            }
            // If there's a "data-secret" attribute, use what's currently displayed
            // or just use data-secret directly if you prefer copying the real secret even if hidden
            else if (dataSecret) {
              // if user hasn't pressed "Show" yet, the displayed text is "*****"
              // so let's always copy the real secret (the user presumably intended to copy the secret).
              textToCopy = dataSecret;
            } else {
              // fallback: copy whatever is in the text
              textToCopy = target.textContent || '';
            }

            // Perform the copy
            navigator.clipboard.writeText(textToCopy).then(() => {
              showCopiedFeedback(target);
            }).catch(err => {
              console.error('Failed to copy:', err);
            });
          }
        });
      </script>
    </body>
    </html>
  `;
}
