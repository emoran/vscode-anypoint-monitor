// userInfoContent.ts

/**
 * Returns an HTML string that displays selected user info from the JSON in a styled table.
 * @param userObject The JSON object containing user data
 */
export function getUserInfoWebviewContent(userObject: any): string {
    // Extract the "user" object from the JSON
    const user = userObject.user;
    if (!user) {
      return `
        <html>
          <body>
            <h2>No user data found.</h2>
          </body>
        </html>
      `;
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
          /* Overall Page Styling */
          body {
            margin: 0;
            padding: 24px;
            background-color: #fff;
            color: #333;
            font-family: "Segoe UI", Arial, sans-serif;
            line-height: 1.5;
          }
  
          /* Heading / Title Styles */
          h1, h2 {
            margin: 0 0 16px 0;
            font-weight: 400;
          }
          h1 {
            font-size: 1.5rem;
            margin-bottom: 24px;
          }
          h2 {
            font-size: 1.2rem;
            margin-top: 32px;
            margin-bottom: 16px;
          }
  
          /* Container for spacing (optional) */
          .container {
            max-width: 900px;
            margin: 0 auto;
          }
  
          /* Basic table styling */
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
          }
          th, td {
            text-align: left;
            padding: 12px;
            vertical-align: middle;
          }
          th {
            font-weight: 500;
            background-color: #f9f9f9;
            border-bottom: 1px solid #e0e0e0;
          }
          tr:not(:first-child) {
            border-top: 1px solid #e0e0e0;
          }
  
          /* Subtle styling for labels or less prominent text */
          .subtle {
            color: #666;
            font-size: 0.9rem;
          }
  
          /* Example layout: two columns (like screenshot) - optional */
          .two-columns {
            display: flex;
            flex-wrap: wrap;
            gap: 24px;
          }
          .column {
            flex: 1 1 400px;
            min-width: 300px;
          }
  
          /* Minor heading style inside columns */
          .column h3 {
            margin: 16px 0 8px 0;
            font-size: 1rem;
            font-weight: 500;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Anypoint User Info</h1>
  
          <!-- Basic user details -->
          <h2>User Details</h2>
          <table>
            <tr>
              <th>Field</th>
              <th>Value</th>
            </tr>
            <tr>
              <td>ID</td>
              <td>${user.id ?? 'N/A'}</td>
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
              <td class="subtle">${lastLogin}</td>
            </tr>
          </table>
  
          <!-- Organization info -->
          <h2>Organization</h2>
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
              <td class="subtle">${subscriptionExp}</td>
            </tr>
          </table>
        </div>
      </body>
    </html>
    `;
  }