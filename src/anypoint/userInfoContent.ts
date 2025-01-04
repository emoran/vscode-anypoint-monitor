import * as vscode from 'vscode';

/**
 * Example: getUserInfoWebviewContent
 * @param userObject The user JSON object
 * @param extensionUri The Uri of your VSCode extension (needed to load local resources)
 */
export function getUserInfoWebviewContent(
  userObject: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  // Destructure for easy usage
  const user = userObject.user || {};
  const org = user.organization || {};

  // Basic user info
  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`;
  const email = user.email ?? 'N/A';
  const phone = user.phoneNumber ?? 'N/A';
  const username = user.username ?? 'N/A';

  // Organization info
  const orgName = org.name ?? 'N/A';
  const orgType = org.orgType ?? 'N/A';
  const orgId = org.id ?? 'N/A';
  const orgDomain = org.domain ?? 'N/A';

  // Subscription info
  const subscriptionCategory = org.subscription?.category ?? 'N/A';
  const subscriptionType = org.subscription?.type ?? 'N/A';
  const subscriptionExpiration = org.subscription?.expiration ?? 'N/A';

  // Additional info JSON (Entitlements)
  const additionalInfo = JSON.stringify(org.entitlements, null, 2);

  // Construct the webview-safe URI for logo
  const logoPath = vscode.Uri.joinPath(extensionUri, 'logo.png');
  const logoSrc = webview.asWebviewUri(logoPath);

  return /* html */ `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Landing Page</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
        background-color: #ffffff;
        color: #333;
      }

      /* Navigation Bar */
      .navbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 2rem;
        background-color: #1c164e; /* Dark purple/blue */
      }
      .navbar .nav-logo {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .navbar .nav-logo img {
        height: 32px; /* Adjust as needed */
        width: auto;
      }
      .navbar .nav-logo span {
        font-size: 1.25rem;
        font-weight: bold;
        color: #fff;
      }
      .navbar .nav-menu {
        display: flex;
        gap: 2rem;
        list-style: none;
      }
      .navbar .nav-menu li {
        color: #fff;
        cursor: pointer;
        font-weight: 500;
      }
      .navbar .nav-menu li:hover {
        text-decoration: underline;
      }
      .navbar .nav-toggle {
        color: #fff;
        cursor: pointer;
        font-size: 1.2rem;
      }

      /* Hero Section with wave/gradient background */
      .hero {
        position: relative;
        width: 100%;
        height: 360px; /* adjust as needed */
        background: linear-gradient(180deg, #2a2086 0%, #3f37a6 50%, #4d47bd 100%);
        overflow: hidden;
      }
      /* Simulated wave shapes (multiple layering) */
      .hero::before,
      .hero::after {
        content: "";
        position: absolute;
        width: 150%;
        height: 100%;
        top: 0;
        left: -25%;
        background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.2) 20%, transparent 40%);
        opacity: 0.4;
        animation: wave-animation 8s ease-in-out infinite alternate;
      }
      .hero::after {
        animation-delay: -4s;
      }
      @keyframes wave-animation {
        0% { transform: translateY(0%) }
        100% { transform: translateY(20%) }
      }

      .hero-content {
        position: absolute;
        top: 50%;
        right: 10%;
        transform: translateY(-50%);
        color: #fff;
        max-width: 400px;
      }
      .hero-content h1 {
        font-size: 2rem;
        margin-bottom: 1rem;
      }
      .hero-content p {
        line-height: 1.5;
        margin-bottom: 1.5rem;
      }
      .hero-buttons {
        display: flex;
        gap: 1rem;
      }
      .hero-buttons button {
        padding: 0.75rem 1.25rem;
        border: none;
        cursor: pointer;
        font-weight: 600;
        border-radius: 4px;
      }
      .btn-primary {
        background: linear-gradient(45deg, #546af5, #7a5ef9);
        color: #fff;
      }
      .btn-outline {
        background: transparent;
        color: #fff;
        border: 2px solid #fff;
      }
      .btn-primary:hover {
        opacity: 0.9;
      }
      .btn-outline:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      /* Main content area */
      .content-container {
        max-width: 1200px;
        margin: 2rem auto;
        padding: 0 2rem;
      }
      .section-title {
        margin-bottom: 1rem;
        font-size: 1.5rem;
        border-bottom: 2px solid #ddd;
        padding-bottom: 0.5rem;
      }
      .info-panel {
        background-color: #f9f9f9;
        padding: 1rem;
        border: 1px solid #ddd;
        border-radius: 4px;
        margin-bottom: 2rem;
      }
      .info-table {
        width: 100%;
        border-collapse: collapse;
      }
      .info-table th,
      .info-table td {
        text-align: left;
        padding: 8px;
        border-bottom: 1px solid #ddd;
      }

      .toggle-button {
        margin: 0.5rem 0;
        padding: 0.5rem 0.75rem;
        background-color: #1c164e;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      .toggle-button:hover {
        opacity: 0.9;
      }

      .additional-section {
        background: #fff;
        border: 1px solid #ddd;
        padding: 1rem;
        border-radius: 4px;
        margin-top: 1rem;
      }
      pre {
        background: #eee;
        padding: 1rem;
        overflow: auto;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <!-- Navigation Bar -->
    <nav class="navbar">
      <div class="nav-logo">
        <!-- Show your local logo -->
        <img src="${logoSrc}" alt="Anypoint Monitor" />
        <span>Anypoint Monitor Extension</span>

      </div>
      <ul class="nav-menu">
        <li><a href="https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor">About the Extension</li>
        <li><a href="https://www.buymeacoffee.com/yucelmoran" >Buy Me a Coffee</a></li>
      </ul>
    </nav>

    <!-- Hero Section -->
    <section class="hero">
      <div class="hero-content">
        <h1>Welcome, ${fullName}!</h1>
        <p>The extension allows to interact with multiple API's from the Platform.
        </p>
      </div>
    </section>

    <!-- Main Content -->
    <div class="content-container">
      <!-- User Details Panel -->
      <h2 class="section-title">User Details</h2>
      <div class="info-panel">
        <table class="info-table">
          <tr><th>Full Name</th><td>${fullName}</td></tr>
          <tr><th>Email</th><td>${email}</td></tr>
          <tr><th>Phone</th><td>${phone}</td></tr>
          <tr><th>Username</th><td>${username}</td></tr>
          <tr><th>Created At</th><td>${user.createdAt ?? ''}</td></tr>
          <tr><th>Last Login</th><td>${user.lastLogin ?? ''}</td></tr>
          <tr><th>Enabled</th><td>${user.enabled ?? ''}</td></tr>
        </table>
      </div>

      <!-- Organization Details Panel -->
      <h2 class="section-title">Organization Details</h2>
      <div class="info-panel">
        <table class="info-table">
          <tr><th>Organization Name</th><td>${orgName}</td></tr>
          <tr><th>Organization ID</th><td>${orgId}</td></tr>
          <tr><th>Domain</th><td>${orgDomain}</td></tr>
          <tr><th>Org Type</th><td>${orgType}</td></tr>
          <tr><th>Subscription Type</th><td>${subscriptionType}</td></tr>
          <tr><th>Subscription Expiration</th><td>${subscriptionExpiration}</td></tr>
        </table>
      </div>

      <!-- Additional Data (Example: Entitlements) -->
      <h2 class="section-title">Additional Organization Entitlements</h2>
      <!-- Toggle button -->
      <button id="toggleButton" class="toggle-button">Hide/Show Entitlements</button>
      <div id="entitlementsSection" class="additional-section">
        <pre>${additionalInfo}</pre>
      </div>
    </div>

    <!-- Inline script for toggle behavior -->
    <script>
      const toggleButton = document.getElementById('toggleButton');
      const entitlementsSection = document.getElementById('entitlementsSection');
      let isVisible = true;

      toggleButton.addEventListener('click', () => {
        isVisible = !isVisible;
        entitlementsSection.style.display = isVisible ? 'block' : 'none';
      });
    </script>
  </body>
  </html>
`;
}