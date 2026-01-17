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