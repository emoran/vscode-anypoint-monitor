## Multi-App Overview Dashboard

Get a bird's-eye view of **all applications** in an environment with health indicators and key metrics.

### At a glance:

- **Summary Cards** — Total, Healthy, Warning, Critical, and Running counts
- **Sortable Table** — Filter by name, status, health, or type (CH1/CH2/Hybrid)
- **Health Scores** — Calculated from CPU, memory, error rate, and app status
- **Quick Actions** — Click through to Command Center or Real-Time Logs per app
- **CSV Export** — Download the full table for reporting

### How health scores work:

| Factor | Weight | Thresholds |
|--------|--------|-----------|
| App Status | 40pts | Running = 0, Stopped = -40 |
| CPU Usage | 20pts | >90% = -20, >75% = -10 |
| Memory Usage | 20pts | >90% = -20, >75% = -10 |
| Error Rate | 20pts | >10% = -20, >5% = -10 |

Score >= 80 = Healthy, >= 60 = Warning, < 60 = Critical
