import * as vscode from 'vscode';
import {
    wrapWebviewHtml,
    summaryCard,
    badge,
    button,
    escapeHtml as uiEscapeHtml
} from '../webview/ui-kit';

export function getUserInfoWebviewContent(
  userObject: any,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const user = userObject.user || {};
  const org = user.organization || {};

  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  const email = user.email ?? 'N/A';
  const phone = user.phoneNumber ?? 'N/A';
  const username = user.username ?? 'N/A';
  const createdAt = user.createdAt ?? '';
  const lastLogin = user.lastLogin ?? '';
  const userEnabled = user.enabled ?? '';

  const orgName = org.name ?? 'N/A';
  const orgType = org.orgType ?? 'N/A';
  const orgId = org.id ?? 'N/A';
  const orgDomain = org.domain ?? 'N/A';
  const subscriptionType = org.subscription?.type ?? 'N/A';
  const subscriptionExpiration = org.subscription?.expiration ?? 'N/A';

  const additionalInfo = JSON.stringify(org.entitlements, null, 2);

  const detailRow = (label: string, value: string, isBadge = false) => `
    <tr class="am-row">
      <td style="color:var(--am-text-muted);width:200px">${uiEscapeHtml(label)}</td>
      <td>${isBadge ? value : uiEscapeHtml(value)}</td>
    </tr>`;

  const statusBadge = badge(userEnabled ? 'Enabled' : 'Disabled', userEnabled ? 'success' : 'error', true);

  const body = `
    <div class="am-container">
      <div class="am-page-header">
        <div>
          <h1>Welcome, ${uiEscapeHtml(fullName)}!</h1>
          <div class="am-page-header-meta">
            ${badge('User Dashboard', 'default', true)}
            ${badge(userEnabled ? 'Active' : 'Inactive', userEnabled ? 'success' : 'error', true)}
          </div>
        </div>
      </div>

      <div class="am-summary-cards">
        ${summaryCard({ icon: '📧', value: uiEscapeHtml(email), label: 'Email', animationDelay: '0.1s' })}
        ${summaryCard({ icon: '👤', value: uiEscapeHtml(username), label: 'Username', animationDelay: '0.15s' })}
        ${summaryCard({ icon: '🏢', value: uiEscapeHtml(orgName), label: 'Organization', animationDelay: '0.2s' })}
        ${summaryCard({ icon: '📋', value: uiEscapeHtml(subscriptionType), label: 'Subscription', animationDelay: '0.25s' })}
      </div>

      <div class="ui-section">
        <h3 class="ui-section-title">User Details</h3>
        <div class="am-table-container">
          <table class="am-table">
            <tbody>
              ${detailRow('Full Name', fullName)}
              ${detailRow('Email', email)}
              ${detailRow('Phone', phone)}
              ${detailRow('Username', username)}
              ${detailRow('Created At', createdAt)}
              ${detailRow('Last Login', lastLogin)}
              ${detailRow('Status', statusBadge, true)}
            </tbody>
          </table>
        </div>
      </div>

      <div class="ui-section">
        <h3 class="ui-section-title">Organization Details</h3>
        <div class="am-table-container">
          <table class="am-table">
            <tbody>
              ${detailRow('Organization Name', orgName)}
              ${detailRow('Organization ID', orgId)}
              ${detailRow('Domain', orgDomain)}
              ${detailRow('Organization Type', orgType)}
              ${detailRow('Subscription Type', subscriptionType)}
              ${detailRow('Subscription Expiration', subscriptionExpiration)}
            </tbody>
          </table>
        </div>
      </div>

      <div class="ui-section">
        <h3 class="ui-section-title">Organization Entitlements</h3>
        ${button('Toggle Entitlements', { variant: 'secondary', onclick: 'toggleEntitlements()' })}
        <div id="entitlementsSection" class="ui-entitlements">
          <pre>${uiEscapeHtml(additionalInfo)}</pre>
        </div>
      </div>
    </div>`;

  const scripts = `
    function toggleEntitlements() {
      const section = document.getElementById('entitlementsSection');
      section.style.display = section.style.display === 'none' ? 'block' : 'none';
    }
  `;

  return wrapWebviewHtml({
    title: 'User Dashboard',
    body,
    scripts,
    extraStyles: `
      .ui-section { margin-bottom: 24px; }
      .ui-section-title {
        font-size: 15px; font-weight: 600; color: var(--am-text-primary);
        margin-bottom: 12px; padding-bottom: 8px;
        border-bottom: 1px solid var(--am-border);
      }
      .ui-entitlements {
        background: var(--am-bg-secondary); border: 1px solid var(--am-border);
        border-radius: var(--am-radius-md); padding: 16px;
        max-height: 400px; overflow-y: auto; margin-top: 12px;
      }
      .ui-entitlements pre {
        margin: 0; font-size: 12px; line-height: 1.4;
        color: var(--am-text-secondary); white-space: pre-wrap; word-wrap: break-word;
      }
    `
  });
}