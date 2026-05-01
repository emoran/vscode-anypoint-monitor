import * as vscode from 'vscode';
import {
    wrapWebviewHtml,
    badge,
    escapeHtml as uiEscapeHtml
} from '../webview/ui-kit';

export function getOrgInfoWebviewContent(
  orgObject: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const orgName = orgObject.name ?? 'N/A';
  const orgId = orgObject.id ?? 'N/A';
  const orgCsId = orgObject.csId ?? 'N/A';
  const orgEnabled = orgObject.enabled ?? false;

  const globalDeployment = orgObject.globalDeployment ?? {};
  const defaultRegion = globalDeployment.defaultRegion ?? 'N/A';

  const downloadAppsEnabled = orgObject.downloadApplicationsEnabled ?? false;
  const persistentQueuesEncryptionEnabled = orgObject.persistentQueuesEncryptionEnabled ?? false;
  const osV1Disabled = orgObject.osV1Disabled ?? false;
  const deploymentGroupEnabled = orgObject.deploymentGroupEnabled ?? false;
  const loggingCustomLog4jEnabled = orgObject.loggingCustomLog4jEnabled ?? false;
  const multitenancy = orgObject.multitenancy?.enabled ?? false;

  const plan = orgObject.plan || {};
  const usage = orgObject.usage || {};

  const usageItems = [
    { label: 'Production Workers', usageVal: usage.productionWorkers ?? 0, planVal: plan.maxProductionWorkers ?? 0 },
    { label: 'Sandbox Workers', usageVal: usage.sandboxWorkers ?? 0, planVal: plan.maxSandboxWorkers ?? 0 },
    { label: 'Standard Connectors', usageVal: usage.standardConnectors ?? 0, planVal: plan.maxStandardConnectors ?? 0 },
    { label: 'Premium Connectors', usageVal: usage.premiumConnectors ?? 0, planVal: plan.maxPremiumConnectors ?? 0 },
    { label: 'Static IPs', usageVal: usage.staticIps ?? 0, planVal: plan.maxStaticIps ?? 0 },
    { label: 'Deployment Groups', usageVal: usage.deploymentGroups ?? 0, planVal: plan.maxDeploymentGroups ?? 0 }
  ];

  const gaugeRadius = 52;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;

  interface GaugeItem { label: string; used: number; total: number; }
  const gaugeItems: GaugeItem[] = [
    { label: 'Production Workers', used: usage.productionWorkers ?? 0, total: plan.maxProductionWorkers ?? 0 },
    { label: 'Sandbox Workers',    used: usage.sandboxWorkers ?? 0,    total: plan.maxSandboxWorkers ?? 0 },
    { label: 'Static IPs',         used: usage.staticIps ?? 0,         total: plan.maxStaticIps ?? 0 },
  ];

  function gaugeColor(pct: number): string {
    if (pct >= 90) { return 'var(--am-error)'; }
    if (pct >= 75) { return 'var(--am-warning)'; }
    return 'var(--am-info)';
  }

  function renderGauge(g: GaugeItem): string {
    const pct = g.total > 0 ? Math.min((g.used / g.total) * 100, 100) : 0;
    const offset = gaugeCircumference - (gaugeCircumference * pct / 100);
    return `
      <div class="od-gauge">
        <div class="od-gauge-ring">
          <svg viewBox="0 0 120 120" width="110" height="110">
            <circle cx="60" cy="60" r="${gaugeRadius}" fill="none" stroke="var(--am-border)" stroke-width="3" opacity="0.4"/>
            <circle cx="60" cy="60" r="${gaugeRadius}" fill="none" stroke="${gaugeColor(pct)}" stroke-width="3"
              stroke-linecap="round" stroke-dasharray="${gaugeCircumference}" stroke-dashoffset="${offset}"
              style="transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset 1s ease"/>
          </svg>
          <div class="od-gauge-value">${g.used}</div>
        </div>
        <div class="od-gauge-label">${uiEscapeHtml(g.label)}</div>
        <div class="od-gauge-sub">${g.total > 0 ? `of ${g.total}` : 'unlimited'}</div>
      </div>`;
  }

  function barColor(pct: number): string {
    if (pct >= 90) { return 'var(--am-error)'; }
    if (pct >= 75) { return 'var(--am-warning)'; }
    return 'var(--am-info)';
  }

  function renderUsageRow(item: { label: string; usageVal: number; planVal: number }): string {
    const used = item.usageVal || 0;
    const total = item.planVal || 0;
    const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
    return `
      <div class="od-usage-row">
        <div class="od-usage-left">
          <div class="od-usage-name">${uiEscapeHtml(item.label)}</div>
          <div class="od-usage-count">${used} of ${total > 0 ? total : 'unlimited'}</div>
        </div>
        <div class="od-usage-right">
          <div class="od-bar-track">
            <div class="od-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div>
          </div>
          <div class="od-bar-pct">${pct.toFixed(0)}%</div>
        </div>
      </div>`;
  }

  const boolDot = (val: boolean) => val
    ? `<span class="od-dot od-dot-on"></span> On`
    : `<span class="od-dot od-dot-off"></span> Off`;

  const kvRow = (label: string, value: string) =>
    `<div class="od-kv"><span class="od-kv-label">${uiEscapeHtml(label)}</span><span class="od-kv-value">${value}</span></div>`;

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div>
          <h1>${uiEscapeHtml(orgName)}</h1>
          <div class="am-page-header-meta">
            ${badge('Organization Dashboard', 'default', true)}
            ${badge(orgEnabled ? 'Enabled' : 'Disabled', orgEnabled ? 'success' : 'error', true)}
          </div>
        </div>
      </div>

      <div class="od-gauges">
        ${gaugeItems.map(g => renderGauge(g)).join('')}
      </div>

      <div class="od-stats">
        <div>
          <div class="od-stat-label">Default Region</div>
          <div class="od-stat-value">${uiEscapeHtml(defaultRegion)}</div>
        </div>
        <div>
          <div class="od-stat-label">Organization ID</div>
          <div class="od-stat-value" style="font-size:12px;font-family:monospace">${uiEscapeHtml(orgId)}</div>
        </div>
        <div>
          <div class="od-stat-label">CS ID</div>
          <div class="od-stat-value" style="font-size:12px;font-family:monospace">${uiEscapeHtml(orgCsId)}</div>
        </div>
      </div>

      <div class="od-section">
        <div class="od-section-title">Resource Usage</div>
        ${usageItems.map(item => renderUsageRow(item)).join('')}
      </div>

      <div class="od-section">
        <div class="od-section-title">Features</div>
        <div class="od-kv-grid">
          ${kvRow('Status', boolDot(orgEnabled))}
          ${kvRow('Application Downloads', boolDot(downloadAppsEnabled))}
          ${kvRow('Queue Encryption', boolDot(persistentQueuesEncryptionEnabled))}
          ${kvRow('Object Store V1', boolDot(!osV1Disabled))}
          ${kvRow('Deployment Groups', boolDot(deploymentGroupEnabled))}
          ${kvRow('Custom Log4j', boolDot(loggingCustomLog4jEnabled))}
          ${kvRow('Multitenancy', boolDot(multitenancy))}
        </div>
      </div>
    </div>`;

  return wrapWebviewHtml({
    title: 'Organization Details',
    body,
    extraStyles: getOrgDashboardStyles()
  });
}

function getOrgDashboardStyles(): string {
  return `
    .od-gauges {
      display: flex; gap: 48px; justify-content: flex-start;
      margin-bottom: 32px; padding-bottom: 28px;
      border-bottom: 1px solid var(--am-border);
    }
    .od-gauge { text-align: center; }
    .od-gauge-ring { position: relative; width: 110px; height: 110px; margin: 0 auto 10px; }
    .od-gauge-value {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      font-size: 28px; font-weight: 300; color: var(--am-text-primary);
    }
    .od-gauge-label {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.6px; color: var(--am-text-secondary);
    }
    .od-gauge-sub { font-size: 11px; color: var(--am-text-muted); margin-top: 2px; }

    .od-stats { display: flex; flex-wrap: wrap; gap: 40px; margin-bottom: 32px; }
    .od-stat-label {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.8px; color: var(--am-text-muted); margin-bottom: 4px;
    }
    .od-stat-value { font-size: 17px; font-weight: 500; color: var(--am-text-primary); }

    .od-section { margin-bottom: 32px; }
    .od-section-title {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.8px; color: var(--am-text-muted);
      margin-bottom: 16px; padding-bottom: 10px;
      border-bottom: 1px solid var(--am-border);
    }

    .od-usage-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--am-border) 40%, transparent);
    }
    .od-usage-row:last-child { border-bottom: none; }
    .od-usage-left { flex: 1; min-width: 0; }
    .od-usage-name { font-size: 13px; font-weight: 500; color: var(--am-text-primary); }
    .od-usage-count { font-size: 11px; color: var(--am-text-muted); margin-top: 2px; }
    .od-usage-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; width: 200px; }
    .od-bar-track {
      flex: 1; height: 3px; border-radius: 2px;
      background: color-mix(in srgb, var(--am-border) 60%, transparent);
      overflow: hidden;
    }
    .od-bar-fill { height: 100%; border-radius: 2px; transition: width 0.6s ease; }
    .od-bar-pct { font-size: 11px; font-weight: 500; color: var(--am-text-muted); min-width: 32px; text-align: right; }

    .od-kv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 40px; }
    .od-kv {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--am-border) 40%, transparent);
    }
    .od-kv-label { font-size: 12px; color: var(--am-text-muted); }
    .od-kv-value {
      font-size: 12px; font-weight: 500; color: var(--am-text-primary);
      text-align: right; word-break: break-all; max-width: 60%;
      display: flex; align-items: center; gap: 6px;
    }

    .od-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .od-dot-on  { background: var(--am-success); }
    .od-dot-off { background: var(--am-text-muted); opacity: 0.4; }

    @media (max-width: 600px) {
      .od-gauges { flex-direction: column; align-items: center; gap: 24px; }
      .od-kv-grid { grid-template-columns: 1fr; }
      .od-usage-right { width: 140px; }
    }
  `;
}