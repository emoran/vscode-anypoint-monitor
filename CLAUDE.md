# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VSCode extension called "Anypoint Monitor" that provides comprehensive Anypoint Platform management capabilities directly within VSCode. It allows developers to monitor CloudHub applications, manage APIs, view organization details, and interact with MuleSoft's Anypoint Platform without leaving their development environment.

## Development Commands

### Essential Commands
- `npm run compile` - Compile TypeScript source files to JavaScript (outputs to `/out`)
- `npm run watch` - Watch mode compilation with auto-recompilation on changes
- `npm run lint` - Run ESLint on the source files for code quality
- `npm run test` - Run the test suite (requires pretest compilation and lint)
- `npm run vscode:prepublish` - Prepare extension for publishing (runs compile)
- `npm run deploy` - Publish extension to VSCode Marketplace using vsce

### Testing
- Tests are located in `src/test/` directory
- Use `npm test` to run the full test suite
- Test configuration is in `.vscode-test.mjs`

## Architecture Overview

### Core Structure
- **Entry Point**: `src/extension.ts` - Main extension activation and command registration
- **Service Layer**: 
  - `src/controllers/anypointService.ts` - Core API communication with Anypoint Platform
  - `src/controllers/oauthService.ts` - OAuth authentication handling
- **UI Components**: `src/anypoint/` - Webview panels for different features (applications, APIs, user info, etc.)
- **Configuration**: `src/constants.ts` - API endpoints and OAuth configuration
- **Resources**: `src/resources/` - Static assets (logos, CSS, images)

### Key Components
- **Authentication**: OAuth 2.0 flow with refresh token support
- **Environment Management**: Multi-environment support with environment selection
- **Application Monitoring**: Support for both CloudHub 1.0 and 2.0 applications
- **Real-Time Logs**: Premium feature for live log streaming with filtering, search, and export capabilities
- **API Management**: Integration with API Manager for API viewing and management
- **User Interface**: Web-based panels using VSCode webview API

### Command Pattern
All extension commands follow the pattern `anypoint-monitor.*` and are registered in `extension.ts`:
- Authentication: login, logout, retrieve access token
- User/Org: user info, organization details, developer utilities
- CloudHub: CH1/CH2 application listing and details
- Real-Time Logs: premium log streaming with filtering and export (`anypoint-monitor.realTimeLogs`)
- API Management: API Manager integration, API auditing
- Community: events and feedback

### Data Storage
- Uses VSCode's SecretStorage API for sensitive data (tokens, user info)
- Environment and user data cached in extension context secrets
- No local file-based configuration storage

### Error Handling
- Automatic token refresh on 401 errors
- Comprehensive error messaging to users
- Graceful degradation when services are unavailable

## Configuration Files
- `tsconfig.json` - TypeScript compilation settings (ES2022, Node16 modules)
- `eslint.config.mjs` - ESLint rules and TypeScript integration
- `package.json` - Extension manifest, dependencies, and VSCode contribution points
- `.vscode-test.mjs` - Test runner configuration

## Dependencies
- **Runtime**: `axios` for HTTP requests, `open` for browser launching
- **Development**: TypeScript, ESLint with TypeScript rules, VSCode test framework
- **Target**: VSCode Engine ^1.96.0, Node.js ES2022 features

## Development Guidelines
- Follow existing TypeScript patterns and error handling approaches
- Use the established OAuth service for all API communications
- Maintain consistency with existing webview implementations in `src/anypoint/`
- Test authentication flows thoroughly due to OAuth complexity
- Ensure proper error handling and user feedback for network operations

## Recent Changes / Memory

### Multi-App Overview Dashboard (January 2026)

**New Feature**: Added a Multi-App Overview Dashboard that displays all applications (CH1, CH2, Hybrid) in a selected environment with health indicators and key metrics at a glance.

**Files Created:**
- `src/anypoint/multiAppDashboard.ts` (~900 lines) - Complete dashboard implementation

**Files Modified:**
- `src/extension.ts` - Added import and command registration for `anypoint-monitor.multiAppDashboard`
- `package.json` - Added activation event and command definition

**Key Implementation Details:**

1. **Parallel Application Fetching:**
   - CH1: `GET /cloudhub/api/applications`
   - CH2 (US): `GET /amc/application-manager/api/v2/organizations/{orgId}/environments/{envId}/deployments`
   - CH2 (EU/GOV): `GET /armui/api/v2/applications` (filters by `target.type === 'MC' && target.subtype === 'shared-space'`)
   - Hybrid: `GET /hybrid/api/v1/applications`

2. **Batched Metrics Loading:**
   - Batch size: 5 apps at a time
   - Delay between batches: 300ms
   - Timeout per app: 8000ms
   - API: `/monitoring/query/api/v1/organizations/{orgId}/environments/{envId}/applications/{appId}`

3. **Health Score Algorithm:**
   - Status check: 40 points (Running = 0, Stopped = -40)
   - CPU threshold: 20 points (>90% = -20, >75% = -10)
   - Memory threshold: 20 points (>90% = -20, >75% = -10)
   - Error rate: 20 points (>10% = -20, >5% = -10)
   - Result: Score >= 80 = Healthy, >= 60 = Warning, < 60 = Critical

4. **UI Features:**
   - Summary cards (Total, Healthy, Warning, Critical, Running counts)
   - Sortable table (Name, Type, Status, Health, CPU, Memory)
   - Filters: Search, Status, Health, Type (CH1/CH2/Hybrid)
   - Progress bar for metrics loading
   - Click-through to Command Center and Real-Time Logs
   - CSV export functionality

**Command:** `AM: Multi-App Overview Dashboard` (`anypoint-monitor.multiAppDashboard`)

**Pattern Reference:** Follows the same webview pattern as `applicationCommandCenter.ts` with inline HTML/CSS, SVG-based indicators, and message passing via `postMessage()`.

### War Room Mode (February 2026)

**New Feature**: Automated production incident triage system. Given seed applications and a time window, it auto-expands a blast radius, collects logs/metrics/deployments/status across all affected apps, correlates events on a timeline, determines probable root cause, and renders an interactive incident report.

**Branch**: `claude/add-war-room-mode-9QfJo` (9 commits, not yet merged to master)

**Commands:**
- `AM: Start War Room` (`anypoint-monitor.startWarRoom`, keybinding: `Ctrl+Shift+W` / `Cmd+Shift+W`)
- `AM: Build Dependency Map` (`anypoint-monitor.buildDependencyMap`)

---

#### File Structure

```
src/warroom/
├── index.ts              # Orchestrator: runWarRoom(), resolveBlastRadius(), collectAppData()
├── warRoomCommand.ts     # UI flow: env → apps → time window → severity → auto-expand
├── types.ts              # All TypeScript interfaces (WarRoomConfig, BlastRadius, etc.)
├── blastRadius.ts        # 2-hop BFS graph walker (upstream + downstream)
├── correlationEngine.ts  # Timeline builder + 4 correlation rules
├── dependencyMapper.ts   # Dependency discovery (properties, API Manager, manual)
├── reportGenerator.ts    # Webview HTML report + Markdown export
└── collectors/
    ├── logCollector.ts       # CH1/CH2 log fetching + error pattern grouping
    ├── deployCollector.ts    # Recent deployment tracking + suspicious detection
    ├── metricsCollector.ts   # InfluxDB metrics + anomaly detection
    └── statusCollector.ts    # App status snapshots (workers, runtime, region)

src/test/
├── mocks/warRoomMocks.ts           # Mock factories (40+ helpers)
└── suite/
    ├── blastRadius.test.ts         # BFS traversal, hop limits, circular deps
    ├── correlationEngine.test.ts   # Timeline, correlation rules, severity
    └── warRoomUtils.test.ts        # Prefix extraction edge cases
```

**Modified Files:**
- `src/extension.ts` (line ~33: import, line ~855: command registration)
- `package.json` (activation events, command definitions, keybinding)

---

#### User Flow

1. User runs `AM: Start War Room` (or `Ctrl+Shift+W`)
2. **Select Environment** — QuickPick from user's Anypoint environments
3. **Select Applications** — Multi-select from CH1 + CH2 apps (these are "seed" apps)
4. **Select Time Window** — 5min, 15min, 30min, 1h, 6h, 24h, or custom
5. **Select Severity** — SEV1 / SEV2 / SEV3
6. **Auto-Expand Blast Radius?** — Yes/No
7. Progress bar runs through: Blast Radius (10%) → Data Collection (75%) → Correlation (5%) → Report (10%)
8. Interactive webview report opens

---

#### Blast Radius Expansion

Two strategies, applied in order:
1. **Graph-based** (if dependency map exists): 2-hop BFS from seed apps through the dependency graph, walking both upstream (callers) and downstream (callees)
2. **Prefix-matching fallback**: Extracts common name prefixes from seed apps (e.g., `cisco-meraki-nx-am-papi` → prefix `cisco-meraki-nx-`) and matches other apps in the environment

Dependency map is stored at `.warroom/dependency-map.json`, auto-rebuilds if >24h stale. Manual overrides go in `.warroom/manual-dependencies.json`.

---

#### Data Collection (per app in blast radius)

| Collector | API Endpoint | Timeout | Key Output |
|-----------|-------------|---------|------------|
| **Logs** | CH2: `/deployments/{id}/specs/{specId}/logs` (Bearer auth) <br> CH1: `/cloudhub/api/v2/applications/{name}/logs` | 30s | Error/warning patterns grouped by normalized message, with counts and first/last timestamps |
| **Deployments** | CH2: `/deployments/{id}/specs` <br> CH1: `/cloudhub/api/applications/{name}` | 8s | Last 5 deployments; flags "suspicious" if within 15min before incident |
| **Metrics** | Visualizer bootdata → InfluxDB datasource → InfluxQL queries | 8s/query | CPU %, memory MB, anomalies (>2x baseline = medium, >3x = high) |
| **Status** | CH2: `/deployments/{id}` <br> CH1: `/cloudhub/api/applications/{name}` | 30s | Status, workers, runtime version, region, last modified |

Batched: 3 apps at a time, 200ms between batches. Failures are tracked in `collectionErrors` (graceful degradation).

---

#### Correlation Engine

Builds a unified **timeline** from all collected data (log spikes, deployments, anomalies, status changes), then applies 4 rules in priority order:

| Rule | Condition | Confidence |
|------|-----------|------------|
| `recent_deployment` | Deployment within 15min before first error | HIGH |
| `resource_exhaustion` | CPU >90% or memory >90% anomaly | MEDIUM-HIGH |
| `downstream_failure` | Downstream app has errors before upstream app | MEDIUM |
| `shared_dependency` | ≥3 apps with errors starting within same window | MEDIUM |
| `unknown` | None of the above matched | LOW |

Thresholds for event detection:
- Error spike: ≥2 errors from an app
- Warning spike: ≥10 warnings from an app
- Timeline capped at 100 events in the report

---

#### Report (Webview)

Sections rendered in `reportGenerator.ts`:
1. **Header** — Severity badge, incident ID, timestamp, environment
2. **Probable Cause** — Correlation type + confidence + explanation
3. **Summary Cards** — Error count, warning count, apps affected, deployments found
4. **Blast Radius Table** — App name, direction (seed/upstream/downstream), hop distance
5. **Timeline** — Chronological events with severity-colored rows
6. **Error Summary** — Grouped patterns with counts, expandable full messages
7. **Recent Deployments** — With suspicious flags
8. **Metric Anomalies** — CPU/memory deviations from baseline
9. **Application Status** — Runtime, region, workers, last modified
10. **Recommended Actions** — Context-specific based on correlation category and severity
11. **Collection Metadata** — Time window, collection errors, timing

Interactive features: Copy Report, Refresh, Open Markdown, click-through to Command Center / Real-Time Logs per app. Reports also saved to `.warroom/reports/` as Markdown.

---

#### Known Limitations & Next Steps

**Current Limitations:**
- Correlation engine does NOT parse error message content — it misses connectivity failures where app A's errors reference app B's URL/hostname
- Recommended actions are generic (not tailored to the specific errors found)
- Error patterns include noisy `event:<UUID>` prefixes
- Related retry messages (attempt 1/3, 3/3, exhausted) are shown as separate patterns instead of grouped
- 2-hop blast radius limit is hardcoded (no configuration)
- Metrics depend on Visualizer/InfluxDB availability — some environments may not have it
- CH2 API does not expose `triggeredBy` for deployments (always shows N/A)
- CH2 field mapping: some apps show `—` for Mule Runtime and Region depending on deployment type

**Proposed Next Steps (in priority order):**
1. **Error-message correlation** — Parse error messages for references to other apps in the blast radius (URL/hostname matching). When app A's errors reference app B, flag as `connectivity_failure` with high confidence. This is the highest-impact improvement — the engine currently says "unknown" even when errors clearly point to a downstream app.
2. **Contextual recommended actions** — Replace generic steps with specific ones derived from actual findings (e.g., "Investigate connectivity between app-A and app-B" instead of "Review application logs").
3. **Strip UUID noise** — Remove `event:<UUID>` prefixes from error pattern display for readability.
4. **Group related retry patterns** — Collapse retry attempt 1/N, 2/N, ..., N/N, and "exhausted" into a single "Retry failure chain" entry with the full sequence shown on expand.
5. **Configurable blast radius depth** — Allow >2 hops via configuration or QuickPick.

---

#### API Endpoints Reference (War Room specific)

```
# Environment list (from existing oauthService)
GET /accounts/api/me → user.memberOfOrganizations[].subOrganizationIds
GET /accounts/api/organizations/{orgId}/environments

# Application listing
GET /amc/application-manager/api/v2/organizations/{orgId}/environments/{envId}/deployments  (CH2)
GET /cloudhub/api/applications  (CH1, with X-ANYPNT-ENV-ID header)

# Specification IDs (CH2 only, needed for logs)
GET /amc/application-manager/api/v2/organizations/{orgId}/environments/{envId}/deployments/{deploymentId}/specs

# Log collection
GET /amc/application-manager/api/v2/organizations/{orgId}/environments/{envId}/deployments/{deploymentId}/specs/{specId}/logs  (CH2)
GET /cloudhub/api/v2/applications/{appName}/logs  (CH1)

# Metrics
GET /visualizer/api/v1/bootdata → datasource discovery
POST /monitoring/archive/api/v1/organizations/{orgId}/environments/{envId}/query  → InfluxQL

# Status
GET /amc/application-manager/api/v2/organizations/{orgId}/environments/{envId}/deployments/{deploymentId}  (CH2)
GET /cloudhub/api/applications/{appName}  (CH1)

# Dependency discovery
GET /apimanager/api/v1/organizations/{orgId}/environments/{envId}/apis  (API Manager autodiscovery)
```

---

#### Commit History (for context)

| # | Hash | Date | Summary |
|---|------|------|---------|
| 1 | `df24031` | Feb 25 | Initial War Room: all files, types, collectors, correlation, report |
| 2 | `5367e2c` | Feb 25 | Fix progress bar UX (hidden behind dependency map prompt) |
| 3 | `b112f73` | Feb 25 | Fix CH2 API endpoints (logs, metrics, deploys) |
| 4 | `e8e5b8f` | Feb 26 | Webview report (replace raw markdown with styled HTML panel) |
| 5 | `c75567f` | Feb 26 | Fix CH2 field mappings (runtime, region, triggeredBy) |
| 6 | `24990c1` | Feb 26 | Interactive buttons, expandable errors, lower thresholds |
| 7 | `80c6249` | Feb 27 | Auto-expand blast radius without manual prompt |
| 8 | `06e5756` | Feb 27 | Pass dep map directly to app lookup, fetch specIds for expanded apps |
| 9 | `ee8a570` | Feb 27 | Unit tests: blast radius, correlation engine, prefix extraction (40+ cases) |