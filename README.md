# Anypoint Monitor - Anypoint Management in VSCode

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/EdgarMoran.anypoint-monitor?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![VS Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/EdgarMoran.anypoint-monitor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![VS Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/EdgarMoran.anypoint-monitor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![License](https://img.shields.io/github/license/emoran/vscode-anypoint-monitor?style=for-the-badge)](LICENSE)

A comprehensive Visual Studio Code extension for MuleSoft Anypoint Platform management. Monitor CloudHub applications, manage APIs, track subscriptions, and seamlessly work with multiple Anypoint organizations directly within your development environment.

## Key Benefits

- **Enhanced Productivity**: Access comprehensive Anypoint Platform information directly from Visual Studio Code
- **Multi-Account Management**: Seamlessly switch between multiple Anypoint organizations and accounts
- **Real-time Monitoring**: Monitor CloudHub 1.0 and 2.0 application status with instant updates
- **Unified Dashboard**: Centralized view of organization details, subscriptions, and API management
- **Secure Authentication**: Enterprise-grade OAuth 2.0 authentication with automatic token refresh
- **Multi-Environment Support**: Complete environment management across Sandbox, Staging, and Production
- **Intelligent Error Handling**: Automatic permission detection and helpful error messages

## Screenshots

<img width="2009" alt="anypoint-monitor_4" src="https://github.com/user-attachments/assets/3a8eba0d-3773-4d94-b692-deb76cc35f67" />
<img width="2006" alt="anypoint-monitor_3" src="https://github.com/user-attachments/assets/3a037265-d9b2-454d-9faf-8575367fca3f" />
<img width="1902" alt="anypoint-monitor_2" src="https://github.com/user-attachments/assets/37eb9dd6-0f9e-4930-8a94-165a4c3e00fb" />
<img width="2009" alt="anypoint-monitor_1" src="https://github.com/user-attachments/assets/5492f8f5-0f5c-474f-a631-e35a4980b934" />

## Features

### 🏢 Multi-Account Management

- **Account Manager**: Centralized dashboard to manage multiple Anypoint Platform accounts
- **Seamless Account Switching**: Switch between different organizations without re-authentication
- **Account Status Monitoring**: Real-time account health with automatic token refresh
- **Individual Account Configuration**: Each account maintains its own environments, permissions, and settings
- **Account Refresh**: One-click refresh of account permissions and environments

### 🏢 Organization Management

- **View Organization Details**: Get comprehensive information about your Anypoint organization
- **Monitor Usage Metrics**: Track your organization's resource consumption and limits
- **Subscription Tracking**: Keep an eye on subscription expiration dates and renewal status
- **Multi-Environment Access**: Work across Design, Sandbox, Staging, and Production environments

### ☁️ CloudHub Application Monitoring

- **CloudHub 1.0 Applications**: Complete visibility into your CH1 deployments with start/stop/restart capabilities
- **CloudHub 2.0 Applications**: Modern CH2 application management and monitoring with scaling information
- **Application Details**: Deep dive into individual application configurations, properties, and status
- **Real-time Status**: Instant application health and performance indicators across environments
- **Cross-Account Access**: View applications from multiple organizations in a unified interface

### 👤 User & Security Management

- **User Information**: View current logged-in user details and permissions for each account
- **Developer Information**: Access developer-specific data and entitlements
- **Secure Token Management**: Retrieve and manage access tokens safely with automatic refresh
- **Account-Aware Permissions**: Intelligent permission handling per account and environment

### 📊 Real-Time Monitoring & Logs

- **Live Log Streaming**: Real-time log tailing for CloudHub 1.0 and 2.0 applications
- **Advanced Filtering**: Search and filter logs by message content, level, or thread
- **Multi-Format Export**: Export logs to JSON, CSV, or TXT formats with pagination support
- **Cross-Environment Monitoring**: Monitor applications across different environments seamlessly

### 🎨 Application Flow Diagrams

- **Visualize Mule Flows**: Fetch a CloudHub 2.0 deployment or select a local JAR file to render flow/sub-flow relationships
- **Local & Remote Support**: Choose from CloudHub deployments or browse for local Mule application JAR files
- **Instant Graphs**: Inspect generated Mermaid diagrams directly inside VSCode and reuse in architecture docs
- **In-Artifact Parsing**: Downloads deployment JARs in-memory, scans Mule XML, and highlights cross-file dependencies

### 🔌 API Management & Security

- **API Manager Integration**: View and manage your APIs directly from VSCode across multiple accounts
- **API Security Audit**: Comprehensive security analysis with policy compliance checks
- **API Catalog Access**: Browse available APIs in your organization with detailed metadata
- **Cross-Account API Management**: Manage APIs from multiple organizations in one interface

### 🛠️ Developer Tools

- **DataWeave Playground**: Interactive DataWeave testing environment
- **Environment Comparison**: Side-by-side comparison of environment configurations
- **Developer Utilities**: Comprehensive developer tools and utilities panel
- **Access Token Management**: Secure token viewing and debugging capabilities

## Available Commands

Access all commands through the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) by typing "AM":

### 🔐 Authentication & Account Management

| Command                            | Description                                          | Usage                                  |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `AM: Login into Anypoint Platform` | Authenticate with your Anypoint Platform credentials | Use this first to establish connection |
| `AM: Account Manager`              | **NEW** Manage multiple Anypoint accounts           | Switch accounts, refresh tokens, view status |
| `AM: Logout`                       | Securely logout from Anypoint Platform               | Clear stored credentials and tokens    |
| `AM: Retrieve Access Token`        | Get current authentication token for debugging       | View token details and expiration      |

### 👤 User & Organization Commands

| Command                     | Description                                  | Details                                                      |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `AM: My Information`        | Display current user profile and permissions | Shows username, email, roles, and organization membership    |
| `AM: Organization Details`  | View comprehensive organization information  | Organization name, ID, usage statistics, and resource limits |
| `AM: Developer Information` | Access developer-specific data               | Developer roles, entitlements, and access permissions        |
| `AM: Developer Utilities`   | Comprehensive developer tools panel         | Advanced developer utilities and debugging tools             |

### ☁️ CloudHub Management Commands

| Command                              | Description                                   | What You'll See                                                       |
| ------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------- |
| `AM: Show CloudHub 1.0 Applications` | List all CloudHub 1.0 applications            | Application names, status, environment, workers, and runtime versions |
| `AM: Show CloudHub 2.0 Applications` | Display CloudHub 2.0 applications             | Modern CH2 apps with scaling info, replicas, and deployment status    |
| `AM: Application Details`            | Get detailed view of specific CH1 application | Full configuration, logs access, properties, and monitoring data      |
| `AM: Application Diagram`            | Visualize CloudHub 2.0 or local JAR flows     | Interactive Mermaid diagram outlining flow and sub-flow connections   |
| `AM: Real-Time Logs`                 | **Premium** Live log streaming for CH1 & CH2  | Real-time log tailing with filtering, search, and multi-format export |
| `AM: Environment Comparison Table`   | Compare environments side-by-side             | Environment details, configurations, and application status comparison |

### 🔌 API Management & Developer Tools

| Command                         | Description                                    | Information Displayed                                   |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `AM: Retrieve API Manager APIs` | View all APIs in API Manager                   | API names, versions, endpoints, policies, and SLA tiers |
| `AM: Audit APIs`                | Perform comprehensive API security audit      | Security analysis, compliance checks, and recommendations |
| `AM: Subscription Expiration`   | Check subscription status and expiration dates | Renewal dates, subscription types, and usage limits     |
| `AM: DataWeave Playground`      | Interactive DataWeave testing environment     | DataWeave transformation testing and validation         |

### 🌐 Community & Support Commands

| Command                         | Description                                    | Information Displayed                                   |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `AM: MuleSoft Community Events` | Access MuleSoft community events and resources | Event listings, webinars, and community announcements  |
| `AM: Provide Feedback`          | Submit feedback and feature requests          | Direct feedback channel to extension developers        |

## Installation

### From VSCode Marketplace

1. Open VSCode
2. Go to Extensions view (`Ctrl+Shift+X`)
3. Search for "Anypoint Monitor"
4. Click "Install"

### From Command Line

```bash
code --install-extension EdgarMoran.anypoint-monitor
```

## Getting Started

### Step 1: Install the Extension

Install Anypoint Monitor from the VSCode Marketplace.

### Step 2: Login to Your First Anypoint Account

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type `AM: Login into Anypoint Platform`
3. Complete the OAuth authentication flow in your browser
4. The extension will automatically fetch your environments and permissions

### Step 3: (Optional) Add Additional Accounts

For multi-organization management:

1. Open Command Palette and type `AM: Account Manager`
2. Click "Add New Account" in the Account Manager webview
3. Complete OAuth authentication for the additional account
4. Switch between accounts seamlessly using the Account Manager

### Step 4: Explore Your Applications

Use the available commands to monitor and manage your Anypoint Platform resources:

- **Switch Accounts**: Use `AM: Account Manager` to switch between different organizations
- **View Applications**: Use `AM: Show CloudHub 1.0 Applications` or `AM: Show CloudHub 2.0 Applications`
- **Monitor Organization**: Check `AM: Organization Details` for comprehensive organization information
- **Manage APIs**: Access `AM: Retrieve API Manager APIs` to view your API portfolio
- **Real-time Monitoring**: Use `AM: Real-Time Logs` for live application log streaming
- **Visualize Applications**: Use `AM: Application Diagram` to create flow diagrams

## System Requirements

- Visual Studio Code version 1.96.0 or higher
- Active Anypoint Platform account with appropriate permissions
- Internet connection for Anypoint Platform API access

## Troubleshooting

### Authentication Issues
- Ensure your Anypoint Platform credentials are correct
- Verify your account has the necessary permissions for the resources you're trying to access
- Try refreshing the account using the Account Manager "Refresh" button
- If issues persist, remove and re-add the account in Account Manager

### Multi-Account Issues
- **Missing Environments**: If you don't see all environments after switching accounts, refresh the account in Account Manager
- **403 Permission Errors**: These indicate your account lacks specific permissions (not an authentication issue)
- **Cross-Account Data**: If you see data from the wrong account, switch to the correct account in Account Manager
- **Stale Tokens**: Use the Account Manager refresh feature to update tokens and permissions

### Connection Problems
- Check your internet connection
- Verify Anypoint Platform service status
- Ensure your firewall allows connections to Anypoint Platform endpoints
- For OAuth issues, ensure port 8082 is available for the redirect callback

### CloudHub 2.0 Access Issues
- Verify your account has CloudHub 2.0 licensing for the selected environment
- Check that you have the necessary role permissions for CloudHub 2.0
- Try different environments as CloudHub 2.0 may be available in some but not others
- Use Account Manager to refresh account permissions

## What's New in Latest Version

### 🆕 Multi-Account Management
- **Account Manager Dashboard**: Centralized management of multiple Anypoint Platform accounts
- **Seamless Account Switching**: Switch between organizations without re-authentication
- **Account-Aware Operations**: All extension features now work correctly across multiple accounts
- **Automatic Token Refresh**: Enhanced token management with automatic refresh per account
- **Intelligent Error Handling**: Better error messages with account-specific context

### 🛠️ Enhanced Reliability
- **Improved API Handling**: Centralized API request management with automatic retry logic
- **Better Permission Management**: Clear distinction between authentication (401) and permission (403) errors
- **Enhanced Environment Support**: More reliable environment detection and switching
- **Debugging Improvements**: Comprehensive logging for troubleshooting

## Support

For issues, feature requests, or general questions:

- **GitHub Issues**: Report bugs and request features at the project repository
- **Feedback**: Use `AM: Provide Feedback` command within VS Code
- **Community**: Join MuleSoft community events via `AM: MuleSoft Community Events`

## License

MIT License - see LICENSE file for details

---

## About

Developed for the MuleSoft developer community to enhance productivity and streamline Anypoint Platform management directly within Visual Studio Code. Whether you're working with a single organization or managing multiple Anypoint accounts, this extension provides the tools you need to efficiently monitor, manage, and develop with the Anypoint Platform.

**Perfect for:**
- MuleSoft Developers working across multiple organizations
- Solution Architects managing different client environments  
- DevOps teams monitoring CloudHub applications
- API Managers overseeing multiple API portfolios
- Anyone seeking unified Anypoint Platform management in VSCode
