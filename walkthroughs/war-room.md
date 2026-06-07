## War Room — Incident Triage

Automated production incident analysis that goes from **seed applications** to **probable root cause** in minutes.

### How it works:

1. **Select seed applications** — Pick the apps you know are affected
2. **Choose time window** — 5min to 24h, or custom range
3. **Set severity** — SEV1, SEV2, or SEV3
4. **Auto-expand blast radius** — Discovers upstream/downstream apps via dependency graph and prefix matching
5. **Collect data** — Logs, metrics, deployments, and status across all affected apps
6. **Correlate events** — Builds a unified timeline and applies correlation rules
7. **Generate report** — Interactive webview with probable cause, confidence level, and recommended actions

### Correlation Rules:

| Rule | Confidence |
|------|-----------|
| Recent deployment before errors | HIGH |
| Resource exhaustion (CPU/MEM >90%) | MEDIUM-HIGH |
| Downstream failure before upstream | MEDIUM |
| Shared dependency pattern | MEDIUM |

> **Keyboard shortcut:** `Ctrl+Shift+W` / `Cmd+Shift+W`
