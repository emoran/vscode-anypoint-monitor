# Application Command Center - Issues Explained

## 🔍 Issue 1: Performance Metrics Show Random/Changing Data

### **Root Cause:**
The performance metrics are **simulated/random data** because the Anypoint Monitoring API call is failing.

### **Current Implementation** (`applicationCommandCenter.ts:464-532`):

```typescript
async function fetchPerformanceMetrics(...) {
    try {
        // Attempt to call Metrics API
        const metricsUrl = `https://anypoint.mulesoft.com/observability/api/v1/metrics:search`;

        const response = await apiHelper.post(metricsUrl, {
            query: {
                metrics: ['app.cpu', 'app.memory'],
                dimensions: {
                    environment: environmentId,
                    application: applicationName
                },
                timeRange: {
                    start: startTime,
                    end: endTime
                }
            }
        });

        // Parse real metrics...
    } catch (error) {
        // ⚠️ API call fails (requires Anypoint Monitoring subscription)
    }

    // ⚠️ FALLBACK: Generate random data every time
    for (let i = 0; i < points; i++) {
        cpu.push(Math.random() * 80 + 10);    // ❌ Different every call!
        memory.push(Math.random() * 70 + 20); // ❌ Different every call!
    }
}
```

### **Why It Fails:**
1. **Requires Anypoint Monitoring subscription** - Titanium plan
2. **API endpoint may need different authentication**
3. **Application must be instrumented** for monitoring

### **Real API Response Structure:**
Based on Anypoint Platform documentation, the response should look like:

```json
{
  "data": [
    {
      "metric": "app.cpu",
      "timestamp": 1699564800000,
      "value": 45.2,
      "dimensions": {
        "environment": "env-id",
        "application": "app-name"
      }
    },
    {
      "metric": "app.memory",
      "timestamp": 1699564800000,
      "value": 73.5,
      "dimensions": {
        "environment": "env-id",
        "application": "app-name"
      }
    }
  ]
}
```

### **Alternative API Endpoints to Try:**

```typescript
// Option 1: Anypoint Monitoring Metrics API
POST https://anypoint.mulesoft.com/monitoring/api/v1/applications/{appName}/metrics
Headers:
  - Authorization: Bearer {token}
  - X-ANYPNT-ENV-ID: {environmentId}
  - X-ANYPNT-ORG-ID: {orgId}
Body:
{
  "metrics": ["app.cpu.usage", "app.jvm.memory.used"],
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-01-02T00:00:00Z",
  "aggregation": "avg",
  "interval": "1h"
}

// Option 2: CloudHub Stats API (Legacy)
GET https://anypoint.mulesoft.com/cloudhub/api/applications/{domain}/stats
Headers:
  - Authorization: Bearer {token}
  - X-ANYPNT-ENV-ID: {environmentId}
  - X-ANYPNT-ORG-ID: {orgId}

// Option 3: CloudHub 2.0 Metrics
GET https://anypoint.mulesoft.com/amc/application-manager/api/v2/organizations/{orgId}/environments/{envId}/deployments/{deploymentId}/metrics
```

---

## 🔍 Issue 2: Status, Uptime, Runtime Version Show "UNKNOWN"

### **Root Cause:**
When clicking from the table, `preselectedAppData` is passed but **NOT being used correctly**.

### **Current Flow:**
```typescript
// 1. Table passes app data
showApplicationCommandCenter(
    context,
    environmentId,
    environmentName,
    appName,
    preselectedAppData  // ✅ Has all the data (status, muleVersion, region, etc.)
)

// 2. We create appInfo from preselected data
appInfo = {
    label: preselectedAppData.name,
    domain: preselectedAppData.name,
    cloudhubVersion: preselectedAppData.target ? 'CH2' : 'CH1',
    deploymentId: preselectedAppData.id,
    // ⚠️ BUT we don't pass the actual application object!
}

// 3. Then we call fetchApplicationData which makes NEW API calls
const data = await fetchApplicationData(
    context,
    environmentId,
    environmentName,
    appInfo.domain,  // ✅ Has domain
    appInfo.cloudhubVersion,  // ✅ Has version
    appInfo.deploymentId  // ✅ Has deployment ID
    // ❌ Missing: The actual application data from table!
);
```

### **The Problem:**
- `fetchApplicationData` makes fresh API calls to get app details
- But it only gets basic info, not all the fields the table has
- The table's data structure is different from what Command Center expects
- Fields map differently: `currentRuntimeVersion` vs `muleVersion`, `status` vs `application.status`

### **CloudHub 2.0 Data from Table:**
```json
{
  "id": "deployment-id",
  "name": "my-app",
  "status": "APPLIED",  // ⚠️ This is deployment status, not app status!
  "currentRuntimeVersion": "4.6.0",
  "target": {
    "provider": "MC",
    "deploymentSettings": {
      "replicas": 1,
      "region": "us-east-1"
    }
  },
  "creationDate": 1699564800000
}
```

### **CloudHub 1.0 Data from Table:**
```json
{
  "domain": "my-app",
  "status": "STARTED",  // ✅ Correct status
  "muleVersion": "4.6.0",
  "region": "us-east-1",
  "workers": 1,
  "workerType": "Micro",
  "lastUpdateTime": 1699564800000
}
```

### **What Command Center Expects:**
```typescript
// From fetchApplicationData
{
  application: {
    domain: "my-app",
    status: "RUNNING",  // ⚠️ Expects this field
    muleVersion: "4.6.0",  // ⚠️ Or currentRuntimeVersion
    region: "us-east-1",
    updateDate: 1699564800000  // For uptime calculation
  }
}
```

---

## 🔍 Issue 3: Health Score Changes Every Time

### **Root Cause:**
Health score depends on **random/simulated data** that changes on each call.

### **Health Score Calculation** (`applicationCommandCenter.ts:46-118`):

```typescript
function calculateHealthScore(data) {
    let score = 100;

    // 1. Application Status (40 points)
    if (status === 'RUNNING' || 'STARTED' || 'APPLIED') {
        // No deduction
    } else if (status === 'STOPPED') {
        score -= 40;
    }

    // 2. Error Rate from Logs (20 points) ⚠️ PROBLEM!
    const recentLogs = data.logs?.slice(0, 100);
    const errorLogs = recentLogs.filter(log => log.priority === 'ERROR');
    const errorRate = errorLogs.length / recentLogs.length;

    if (errorRate > 0.1) {
        score -= 20;  // ⚠️ Changes based on random logs!
    } else if (errorRate > 0.05) {
        score -= 10;
    }

    // 3. Replica Health (20 points)
    const healthyReplicas = replicas.filter(r => r.state === 'RUNNING').length;
    if (healthyReplicas < totalReplicas) {
        score -= penalty;
    }

    // 4. Active Alerts (10 points) ⚠️ PROBLEM!
    if (alerts.length > 0) {
        score -= Math.min(alerts.length * 3, 10);  // ⚠️ Random alerts!
    }

    // 5. Failed Schedulers (10 points)
    const failedSchedulers = schedulers.filter(s => s.status === 'FAILED');
    if (failedSchedulers.length > 0) {
        score -= penalty;
    }

    return score; // Total: 0-100
}
```

### **Why It Changes:**

1. **Logs are simulated** (lines 62-77):
   - If API fails to fetch logs, we use empty array `[]`
   - Error rate calculation becomes `0 / 0 = NaN` or `0 / 0 = 0`
   - Sometimes gets partial logs, sometimes none
   - **Changes the -20 or -10 point deduction randomly**

2. **Alerts are simulated** (line 417):
   ```typescript
   dataPromises.alerts = generateSimulatedAlerts(dataPromises);
   ```
   - Generates random alerts based on app state
   - **Changes the -3 to -10 point deduction randomly**

3. **Scheduler status may vary**:
   - API calls may succeed/fail intermittently
   - **Changes the -5 to -10 point deduction**

### **Example:**
```
Call 1: Status OK (0) + No errors (0) + Replicas OK (0) + 2 alerts (-6) + Schedulers OK (0) = 94
Call 2: Status OK (0) + Few errors (-10) + Replicas OK (0) + 1 alert (-3) + Schedulers OK (0) = 87
Call 3: Status OK (0) + No errors (0) + Replicas OK (0) + 3 alerts (-9) + Schedulers OK (0) = 91
```

---

## ✅ SOLUTIONS

### **Solution 1: Fix Performance Metrics**
Use real CloudHub APIs instead of Monitoring API:

```typescript
// For CloudHub 1.0 - Use Dashboard Worker Stats
GET /cloudhub/api/applications/{domain}/dashboardStats

// For CloudHub 2.0 - Use Deployment Metrics
GET /amc/application-manager/api/v2/organizations/{orgId}/environments/{envId}/deployments/{deploymentId}/instances/{instanceId}/stats
```

### **Solution 2: Fix Data Passing**
Pass `preselectedAppData` directly to `fetchApplicationData`:

```typescript
const data = await fetchApplicationData(
    context,
    environmentId,
    environmentName,
    appInfo.domain,
    appInfo.cloudhubVersion,
    appInfo.deploymentId,
    preselectedAppData  // ✅ Pass the app data from table!
);
```

Then in `fetchApplicationData`, use it as fallback:
```typescript
if (preselectedAppData) {
    dataPromises.application = preselectedAppData;
    // Skip API call if we already have the data
}
```

### **Solution 3: Stabilize Health Score**
Remove randomness:

```typescript
// 1. Cache logs for 5 minutes instead of fetching each time
// 2. Don't generate simulated alerts - only show real ones
// 3. Add timestamp to health score and cache result
```

---

## 📊 SUMMARY

| Issue | Root Cause | Impact | Fix Complexity |
|-------|------------|--------|----------------|
| Random Performance Data | API call fails → fallback to `Math.random()` | High - Confusing to users | Medium - Need correct API |
| UNKNOWN Values | preselectedAppData not passed to fetchApplicationData | High - Missing critical info | Easy - Pass parameter |
| Changing Health Score | Based on random logs/alerts | Medium - Inconsistent scoring | Medium - Cache or remove randomness |
