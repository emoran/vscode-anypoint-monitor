# Change Log

All notable changes to the "Anypoint Monitor" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/).

## [0.0.78] - 2026-04-03

### Added
- **Shared UI Kit & Theme System** — All webview panels now use a consistent, VSCode-theme-aware design system (`--am-*` CSS variables) that adapts automatically to Light, Dark, and High Contrast themes.
- **Premium Panel UI Overhaul** — Alerting Hub, Cost Optimizer, and Live Connection Tracer panels migrated to the shared UI component library.
- **Environment Comparison UI Refresh** — Comparison table redesigned with modern styling, theme-aware badges, and summary cards.
- **New Tests** — Added premium panel integration tests and environment comparison migration tests to prevent regressions.

### Changed
- Replaced hardcoded dark-theme hex colors across 4 webview panels with theme-adaptive CSS variables.
- Updated CHANGELOG to include full version history.

## [0.0.77] - 2026-03-28

### Added
- **Getting Started Walkthrough** — 5-step interactive onboarding guide accessible via Command Palette.
- **Welcome View** — "Connect Account" prompt when sidebar is loaded without authentication.
- **CI/CD Pipeline** — GitHub Actions workflow with test matrix (Ubuntu, macOS, Windows), build verification, and gated deployment.
- **Command Registration Tests** — Validates all `package.json` commands are registered in `extension.ts`.
- **Package Manifest Tests** — Validates categories, keywords, walkthrough files, icon existence, and welcome view commands.
- **UI Kit Unit Tests** — Tests for `escapeHtml`, `escapeAttr`, `badge`, `summaryCard`, `healthIndicator`, `button`, and other components.
- **Extension Activation Tests** — Smoke tests for extension presence, activation, command registration, and sidebar views.

### Changed
- **Multi-App Dashboard** — Fully rewritten using the new shared UI kit (`wrapWebviewHtml`, `summaryCard`, `badge`, `healthIndicator`).
- **README.md** — Restructured with a clear value proposition, comparison table, feature highlights, and reorganized command tables.
- **Star Prompt** — Thresholds adjusted (first prompt at 5 uses, subsequent at 25). Prompt now offers both "Rate on Marketplace" and "Star on GitHub".
- Categories optimized in `package.json` for better discoverability.
- Keywords updated for Marketplace SEO.

## [0.0.76] - 2026-02-27

### Added
- **War Room Mode** — Automated production incident triage with blast radius analysis, multi-source data collection, timeline correlation, and interactive report generation.
- **Dependency Mapper** — Build and maintain application dependency maps for blast radius expansion.
- War Room unit tests (blast radius, correlation engine, prefix extraction).

## [0.0.75] - 2026-01-15

### Added
- **Multi-App Overview Dashboard** — View all applications (CH1, CH2, Hybrid) in a selected environment with health indicators, metrics, and sorting/filtering.
- Batched metrics loading with configurable batch size and timeout.
- Health score algorithm (status, CPU, memory, error rate weighted scoring).
- CSV export for multi-app dashboard data.

## [0.0.74] - 2025-12-01

### Added
- **Alerting Hub** — Real-time application health monitoring with configurable rules, severity levels, and alert lifecycle management (acknowledge, snooze, resolve, mute).
- **Cost Optimizer** — Analyze CloudHub resource allocation and identify over/under-provisioned applications with savings recommendations.
- **Live Connection Tracer** — Interactive force-directed graph visualization of application dependencies with live health metrics.
- Premium feature module structure (`src/premium/`).

## [0.0.73] - 2025-11-15

### Added
- **Application Command Center** — Unified tabbed dashboard for managing individual applications (overview, metrics, logs, deployments, configuration).
- **Real-Time Logs** — Premium live log streaming with filtering, search, and CSV export for CloudHub 1.0 and 2.0 applications.

## [0.0.72] - 2025-10-20

### Added
- **Environment Comparison Table** — Side-by-side comparison of application deployments across environments with advanced filtering and name matching.
- **Application Diagram** — Mermaid-based visualization of MuleSoft application flows.
- **DataWeave Playground** — Interactive DataWeave expression editor and tester.

## [0.0.71] - 2025-09-15

### Added
- **Multi-Account Management** — Support for multiple Anypoint Platform accounts with account switching.
- **Business Group Selector** — Navigate and select business groups within an organization.
- **AnypointMQ Statistics** — Queue depth, message throughput, and consumer metrics for AnypointMQ.

## [0.0.70] - 2025-08-01

### Added
- **Hybrid Application Support** — View and manage on-premises/hybrid applications, servers, server groups, and clusters.
- **API Audit** — Audit API Manager configurations across environments.

## [0.0.1] - 2025-06-01

### Added
- Initial release with CloudHub 1.0 and 2.0 application monitoring.
- OAuth 2.0 authentication with Anypoint Platform.
- Organization and user information panels.
- API Manager integration for viewing APIs.
- Community events and feedback features.
