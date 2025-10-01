# Anypoint Monitor - Anypoint Management in VSCode

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/EdgarMoran.anypoint-monitor?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![VS Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/EdgarMoran.anypoint-monitor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![VS Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/EdgarMoran.anypoint-monitor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![License](https://img.shields.io/github/license/emoran/vscode-anypoint-monitor?style=for-the-badge)](LICENSE)

**The ultimate VSCode extension for MuleSoft Anypoint Platform.** Monitor CloudHub applications, manage APIs, track subscriptions, and view organization details—all without leaving your code editor.

## 🚀 Why Anypoint Monitor?

- **⚡ Boost Productivity**: Access all Anypoint Platform info directly from VSCode
- **🔄 Real-time Monitoring**: Check CloudHub 1.0 and 2.0 application status instantly
- **📊 Comprehensive Overview**: Organization details, subscriptions, and API management in one place
- **🛡️ Secure Authentication**: Safe login with Anypoint Platform credentials
- **💼 Multi-Environment Support**: Manage multiple Anypoint environments seamlessly

## 📸 Screenshots

<img width="2009" alt="anypoint-monitor_4" src="https://github.com/user-attachments/assets/3a8eba0d-3773-4d94-b692-deb76cc35f67" />
<img width="2006" alt="anypoint-monitor_3" src="https://github.com/user-attachments/assets/3a037265-d9b2-454d-9faf-8575367fca3f" />
<img width="1902" alt="anypoint-monitor_2" src="https://github.com/user-attachments/assets/37eb9dd6-0f9e-4930-8a94-165a4c3e00fb" />
<img width="2009" alt="anypoint-monitor_1" src="https://github.com/user-attachments/assets/5492f8f5-0f5c-474f-a631-e35a4980b934" />

## ✨ Key Features

### 🏢 Organization Management

- **View Organization Details**: Get comprehensive information about your Anypoint organization
- **Monitor Usage Metrics**: Track your organization's resource consumption and limits
- **Subscription Tracking**: Keep an eye on subscription expiration dates and renewal status

### ☁️ CloudHub Application Monitoring

- **CloudHub 1.0 Applications**: Complete visibility into your CH1 deployments
- **CloudHub 2.0 Applications**: Modern CH2 application management and monitoring
- **Application Details**: Deep dive into individual application configurations and status
- **Real-time Status**: Instant application health and performance indicators

### 🔐 User & Security Management

- **User Information**: View current logged-in user details and permissions
- **Developer Information**: Access developer-specific data and entitlements
- **Secure Token Management**: Retrieve and manage access tokens safely

### 🗺️ Application Flow Diagrams

- **Visualize Mule Flows**: Fetch a CloudHub 2.0 deployment and render flow/sub-flow relationships with `AM: Application Diagram`.
- **Instant Graphs**: Inspect the generated Mermaid diagram directly inside VSCode and reuse it in architecture docs.
- **In-Artifact Parsing**: The command downloads the deployment JAR in-memory, scans Mule XML, and highlights cross-file dependencies for faster onboarding.

### 🔌 API Management

- **API Manager Integration**: View and manage your APIs directly from VSCode
- **API Catalog Access**: Browse available APIs in your organization
- **Endpoint Monitoring**: Track API performance and availability

## 🎯 Available Commands

Access all commands through the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) by typing "AM":

### Authentication Commands

| Command                            | Description                                          | Usage                                  |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `AM: Login into Anypoint Platform` | Authenticate with your Anypoint Platform credentials | Use this first to establish connection |
| `AM: Logout`                       | Securely logout from Anypoint Platform               | Clear stored credentials and tokens    |
| `AM: Retrieve Access Token`        | Get current authentication token for debugging       | View token details and expiration      |

### User & Organization Commands

| Command                     | Description                                  | Details                                                      |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `AM: My Information`        | Display current user profile and permissions | Shows username, email, roles, and organization membership    |
| `AM: Organization Details`  | View comprehensive organization information  | Organization name, ID, usage statistics, and resource limits |
| `AM: Developer Information` | Access developer-specific data               | Developer roles, entitlements, and access permissions        |

### CloudHub Management Commands

| Command                              | Description                                   | What You'll See                                                       |
| ------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------- |
| `AM: Show CloudHub 1.0 Applications` | List all CloudHub 1.0 applications            | Application names, status, environment, workers, and runtime versions |
| `AM: Show CloudHub 2.0 Applications` | Display CloudHub 2.0 applications             | Modern CH2 apps with scaling info, replicas, and deployment status    |
| `AM: Application Details`            | Get detailed view of specific CH1 application | Full configuration, logs access, properties, and monitoring data      |
| `AM: Application Diagram`            | Visualize CloudHub 2.0 flow topology          | Interactive Mermaid diagram outlining flow and sub-flow connections   |
| `AM: Real-Time Logs`                 | **Premium** Live log streaming for CH1 & CH2  | Real-time log tailing with filtering, search, and multi-format export |

### API & Subscription Commands

| Command                         | Description                                    | Information Displayed                                   |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `AM: Retrieve API Manager APIs` | View all APIs in API Manager                   | API names, versions, endpoints, policies, and SLA tiers |
| `AM: Subscription Expiration`   | Check subscription status and expiration dates | Renewal dates, subscription types, and usage limits     |

## 🛠️ Installation

### From VSCode Marketplace

1. Open VSCode
2. Go to Extensions view (`Ctrl+Shift+X`)
3. Search for "Anypoint Monitor"
4. Click "Install"

### From Command Line

```bash
code --install-extension EdgarMoran.anypoint-monitor
```

## 🚦 Getting Started

### Step 1: Install the Extension

Install Anypoint Monitor from the VSCode Marketplace.

### Step 2: Login to Anypoint Platform

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type `AM: Login into Anypoint Platform`
3. Enter your Anypoint Platform credentials
4. Select your business group (if applicable)

### Step 3: Explore Your Applications

-
