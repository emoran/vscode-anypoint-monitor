/**
 * Returns an HTML string that displays user and organization info
 * in a style similar to the provided image, with a top icon and donation button.
 */
export function getUserInfoWebviewContent(userObject: any): string {
  const user = userObject?.user;
  if (!user) {
    return `
      <html>
        <body>
          <h2>No user data found.</h2>
        </body>
      </html>
    `;
  }

  // Extract user details
  const userFields = [
    { label: "Username", value: user.username ?? "N/A" },
    { label: "Created", value: user.createdAt ?? "N/A" },
    { label: "Multi-factor auth", value: user.mfaVerificationExcluded ? "Not Enabled" : "Enabled" },
  ];

  // Extract organization details
  const org = user.organization || {};
  const orgFields = [
    { label: "Organization ID", value: org.id ?? "N/A" },
    { label: "Organization Name", value: org.name ?? "N/A" },
    { label: "Domain", value: org.domain ?? "N/A" },
  ];

  // Helper function to generate field rows
  function generateFieldRows(fields: { label: string; value: any }[]): string {
    return fields
      .map(
        (field) => `
          <div class="field-row">
            <div class="field-label">${field.label}</div>
            <div class="field-value">${field.value}</div>
          </div>
        `
      )
      .join("");
  }

  const displayName =
    (user.firstName ?? "") + (user.lastName ? ` ${user.lastName}` : "") || "Unknown User";

  return /* html */ `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Anypoint Monitoring Extension</title>
      <style>
        /* Basic styling */
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding: 0;
          font-family: "Roboto", "Helvetica Neue", Arial, sans-serif;
          background-color: #f5f6fa;
          color: #444;
        }
        .main-container {
          padding: 20px;
        }
        
        /* Top Bar */
        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 1.5rem;
          background-color: #fff;
          border-radius: 10px;
          margin-bottom: 1.5rem;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .topbar .greeting {
          font-size: 1.25rem;
          font-weight: 500;
          color: #333;
        }
        .topbar .icon {
          width: 50px;
          height: 50px;
          background-color: #007bff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 1.5rem;
          font-weight: bold;
        }
        .donate-button {
          padding: 0.6rem 1.2rem;
          background-color: #ff6f61;
          color: #fff;
          border: none;
          border-radius: 5px;
          font-size: 0.9rem;
          cursor: pointer;
          margin-left: 10px;
        }
        .donate-button:hover {
          background-color: #e2554f;
        }

        /* Info sections */
        .info-section {
          background-color: #fff;
          border-radius: 10px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          padding: 1.5rem;
          margin-bottom: 2rem;
        }
        .info-section h2 {
          margin-top: 0;
          font-size: 1rem;
          font-weight: 500;
          color: #333;
          margin-bottom: 1rem;
        }

        .field-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid #f1f1f1;
        }
        .field-row:last-of-type {
          border-bottom: none;
        }
        .field-label {
          color: #666;
          font-weight: 500;
        }
        .field-value {
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="main-container">
        <!-- Top Bar -->
        <div class="topbar">
          <div class="icon">A</div>
          <div class="greeting">Hi ${displayName}! Welcome to Anypoint Monitoring Extension</div>
          <button class="donate-button">Donate</button>
        </div>

        <!-- User Details -->
        <div class="info-section">
          <h2>User Details</h2>
          <div class="field-row">
            <div class="field-label">First Name</div>
            <div class="field-value">${user.firstName ?? "N/A"}</div>
          </div>
          <div class="field-row">
            <div class="field-label">Last Name</div>
            <div class="field-value">${user.lastName ?? "N/A"}</div>
          </div>
          ${generateFieldRows(userFields)}
        </div>

        <!-- Organization Info -->
        <div class="info-section">
          <h2>Organization Info</h2>
          ${generateFieldRows(orgFields)}
        </div>
      </div>
    </body>
  </html>
  `;
}