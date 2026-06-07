# Anypoint Monitor

### The Anypoint Platform control plane — inside your IDE.

Monitor CloudHub 1.0/2.0 applications, stream real-time logs, manage APIs, run incident war rooms, and optimize costs — all without leaving VS Code.

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/EdgarMoran.anypoint-monitor?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![VS Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/EdgarMoran.anypoint-monitor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![VS Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/EdgarMoran.anypoint-monitor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=EdgarMoran.anypoint-monitor)
[![License](https://img.shields.io/github/license/emoran/vscode-anypoint-monitor?style=for-the-badge)](LICENSE)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/yucelmoran)
[![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/yucelmoran)

---

## Why Anypoint Monitor?

| Capability | Anypoint Monitor | Anypoint Studio | Web Console |
|------------|:---:|:---:|:---:|
| Multi-account management | **Yes** | No | No |
| Real-time log streaming | **Yes** | No | Limited |
| War Room incident triage | **Yes** | No | No |
| Application flow diagrams | **Yes** | Yes | No |
| DataWeave playground | **Yes** | Yes | No |
| Cost optimization analysis | **Yes** | No | No |
| Dependency visualization | **Yes** | No | Limited |
| API security audit | **Yes** | No | No |
| Works in VS Code / Cursor | **Yes** | No | N/A |
| Lightweight (no JDK) | **Yes** | No | N/A |

**Perfect for:** MuleSoft Developers, Solution Architects, DevOps teams, and API Managers who want a unified, lightweight Anypoint Platform experience where they code.

---

## Feature Highlights

### Multi-Account Management
Manage multiple Anypoint Platform organizations from a single interface. Switch accounts, refresh tokens, and view status — all with seamless OAuth 2.0 authentication and automatic token refresh.

### CloudHub 1.0 & 2.0 Monitoring
View all applications in one interface with deep-dive into configuration, workers, replicas, and runtime versions. Start, stop, restart apps directly from VS Code with real-time status indicators.

### Application Command Center
A unified control room per application: health scoring based on logs and metrics, AI-powered insights and recommendations, one-click access to logs/restart/diagrams, and real-time CPU/memory/network visualization with interactive charts.

### Multi-App Overview Dashboard
Environment-wide health at a glance with summary cards (Total, Healthy, Warning, Critical), a sortable/filterable application table, progress-driven metrics loading, and CSV export.

### Real-Time Log Streaming
Live log tailing for CH1 and CH2 applications with advanced filtering (message, level, thread), color-coded priority highlighting, and multi-format export (JSON, CSV, TXT).

### War Room — Incident Triage
Automated production incident analysis: select seed applications and a time window, auto-expand the blast radius, collect logs/metrics/deployments across all affected apps, correlate events on a timeline, and render an interactive incident report with probable root cause.

### Application Flow Diagrams
Generate interactive Mermaid flow diagrams from CloudHub 2.0 deployments or local JAR files. Visualize flow/sub-flow relationships, cross-file dependencies, and export for architecture documentation.

### API Management & Security Audit
View and manage APIs across accounts and environments. Run comprehensive security audits with policy compliance checks, SLA tier analysis, and actionable recommendations.

### Alerting Hub
Configure and manage platform alerts with customizable thresholds. Get notified about app health changes, deployment events, and resource anomalies.

### Cost Optimizer
Analyze platform resource usage and identify optimization opportunities across environments. Reduce vCore costs with data-driven recommendations.

### Live Connection Tracer
Trace and visualize runtime dependencies between applications. Map upstream/downstream connections across your integration landscape.

### Hybrid / On-Premises Support
Monitor hybrid applications, servers, server groups, and clusters running in on-premises environments.

### DataWeave Playground
Interactive DataWeave 2.0 testing environment with input/output preview panels, sample data templates, and error validation.

### Developer Tools
Environment comparison tables, developer utilities panel, access token management with expiration tracking, and AnypointMQ queue statistics.

---

## Available Commands

Access all commands through the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) by typing **"AM"**:

### Authentication & Accounts

| Command | Description |
|---------|-------------|
| `AM: Login into Anypoint Platform` | Authenticate with OAuth 2.0 |
| `AM: Account Manager` | Manage multiple Anypoint accounts |
| `AM: Logout` | Securely logout from current account |
| `AM: Retrieve Access Token` | Get current token for debugging |
| `AM: Select Business Group` | Switch between business groups |

### CloudHub & Applications

| Command | Description |
|---------|-------------|
| `AM: Show CloudHub 1.0 Applications` | List and manage CH1 applications |
| `AM: Show CloudHub 2.0 Applications` | List and manage CH2 applications |
| `AM: Application Command Center` | Unified app control room with KPIs and AI insights |
| `AM: Multi-App Overview Dashboard` | Environment-wide health dashboard |
| `AM: Real-Time Logs` | Live log streaming with filtering and export |
| `AM: Application Diagram` | Visualize Mule flow architecture |
| `AM: Environment Comparison Table` | Side-by-side environment comparison |

### Hybrid / On-Premises

| Command | Description |
|---------|-------------|
| `AM: Show Hybrid Applications` | View on-premises/hybrid applications |
| `AM: Show Hybrid Servers` | View on-premises Mule servers |
| `AM: Show Hybrid Server Groups` | View server groups |
| `AM: Show Hybrid Clusters` | View server clusters |

### API & Security

| Command | Description |
|---------|-------------|
| `AM: Retrieve API Manager APIs` | View all APIs in API Manager |
| `AM: Audit APIs` | Comprehensive API security audit |
| `AM: AnypointMQ Statistics` | Queue statistics and message metrics |

### Operations

| Command | Description |
|---------|-------------|
| `AM: Start War Room` | Automated incident triage (`Ctrl+Shift+W`) |
| `AM: Alerting Hub` | Configure and manage alerts (`Ctrl+Shift+A`) |
| `AM: Cost Optimizer` | Analyze and optimize resource costs |
| `AM: Live Connection Tracer` | Trace application dependencies |

### Developer Tools

| Command | Description |
|---------|-------------|
| `AM: DataWeave Playground` | Interactive DataWeave 2.0 testing |
| `AM: Developer Utilities` | Developer tools and system info |
| `AM: My Information` | View your user profile and permissions |
| `AM: Organization Details` | View organization information |
| `AM: Subscription Expiration` | Check subscription status |

### Community

| Command | Description |
|---------|-------------|
| `AM: MuleSoft Community Events` | Upcoming meetups, webinars, and events |
| `AM: Provide Feedback` | Share feedback and feature requests |

---

## Getting Started

### 1. Install

**Marketplace:** Search for "Anypoint Monitor" in VS Code Extensions (`Ctrl+Shift+X`)

**CLI:**
```bash
code --install-extension EdgarMoran.anypoint-monitor
```

### 2. Connect Your Account

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type `AM: Login into Anypoint Platform`
3. Complete the OAuth flow in your browser
4. Your environments and permissions are fetched automatically

### 3. (Optional) Add More Accounts

1. `AM: Account Manager` > "Add New Account"
2. Complete OAuth for the additional organization
3. Switch between accounts seamlessly

### 4. Explore

- **View apps:** `AM: Multi-App Overview Dashboard` for environment-wide health
- **Deep dive:** `AM: Application Command Center` for per-app KPIs and logs
- **Stream logs:** `AM: Real-Time Logs` for live tailing with filters
- **Incident response:** `AM: Start War Room` for automated triage
- **Manage APIs:** `AM: Retrieve API Manager APIs` for your API portfolio

---

## System Requirements

- Visual Studio Code **1.96.0** or higher (also works in Cursor)
- Active Anypoint Platform account with appropriate permissions
- Internet connection for Anypoint Platform API access

## Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+W` / `Cmd+Shift+W` | Start War Room |
| `Ctrl+Shift+A` / `Cmd+Shift+A` | Alerting Hub |

## Troubleshooting

### Authentication Issues
- Ensure your Anypoint Platform credentials are correct
- Verify your account has the necessary permissions
- Try refreshing the account using the Account Manager "Refresh" button
- If issues persist, remove and re-add the account in Account Manager

### Multi-Account Issues
- **Missing Environments**: Refresh the account in Account Manager after switching
- **403 Permission Errors**: Your account lacks specific permissions (not an authentication issue)
- **Cross-Account Data**: Switch to the correct account in Account Manager
- **Stale Tokens**: Use the Account Manager refresh feature

### Connection Problems
- Check your internet connection
- Verify Anypoint Platform service status
- Ensure your firewall allows connections to Anypoint Platform endpoints
- For OAuth issues, ensure port 8082 is available for the redirect callback

### CloudHub 2.0 Access Issues
- Verify your account has CloudHub 2.0 licensing for the selected environment
- Check that you have the necessary role permissions
- Try different environments as CH2 may not be available in all

---

## Support

- **GitHub Issues**: [Report bugs and request features](https://github.com/emoran/vscode-anypoint-monitor/issues)
- **Feedback**: Use `AM: Provide Feedback` within VS Code
- **Community**: Join MuleSoft community events via `AM: MuleSoft Community Events`

## License

MIT License — see [LICENSE](LICENSE) for details.

---

Developed for the MuleSoft developer community to enhance productivity and streamline Anypoint Platform management directly within Visual Studio Code.
