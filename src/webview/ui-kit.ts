/**
 * Shared webview UI component library.
 *
 * Every component returns an HTML string and uses the --am-* CSS variables
 * from theme.ts so it adapts to any VS Code theme automatically.
 */

// ---------------------------------------------------------------------------
// Styles for all components (include once per webview via getComponentStyles)
// ---------------------------------------------------------------------------

export function getComponentStyles(): string {
    return `
        /* ── Container ─────────────────────────────────────────────── */
        .am-container {
            max-width: 1400px;
            margin: 0 auto;
            animation: am-fadeIn 0.5s ease-out;
        }

        /* ── Page Header ───────────────────────────────────────────── */
        .am-page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding: 24px;
            background: var(--am-bg-secondary);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-lg);
            animation: am-slideDown 0.5s ease-out;
            position: relative;
            overflow: hidden;
        }

        .am-page-header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--am-info), var(--am-success), var(--am-info));
        }

        .am-page-header h1 {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .am-page-header-meta {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .am-page-header-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .am-timestamp {
            color: var(--am-text-muted);
            font-size: 12px;
        }

        /* ── Cards ─────────────────────────────────────────────────── */
        .am-card {
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-md);
            padding: 20px;
            transition: border-color 0.2s, transform 0.2s;
        }

        .am-card:hover {
            border-color: var(--am-info);
            transform: translateY(-2px);
        }

        .am-card-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--am-text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* ── Summary Cards Grid ────────────────────────────────────── */
        .am-summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .am-summary-card {
            position: relative;
            background: var(--am-bg-surface);
            border-radius: var(--am-radius-md);
            padding: 20px;
            text-align: center;
            border: 1px solid var(--am-border);
            transition: all 0.2s ease;
            animation: am-slideUp 0.5s ease-out both;
        }

        .am-summary-card:hover {
            background: var(--am-bg-surface-hover);
            transform: translateY(-3px);
            border-color: var(--am-info);
        }

        .am-summary-card .am-card-icon {
            font-size: 12px;
            margin-bottom: 4px;
        }

        .am-summary-card .am-card-value {
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .am-summary-card .am-card-label {
            font-size: 14px;
            color: var(--am-text-secondary);
        }

        .am-summary-card .am-card-breakdown {
            font-size: 11px;
            color: var(--am-text-muted);
            margin-top: 8px;
        }

        .am-summary-card.am-healthy .am-card-icon,
        .am-summary-card.am-healthy .am-card-value { color: var(--am-success); }
        .am-summary-card.am-warning .am-card-icon,
        .am-summary-card.am-warning .am-card-value { color: var(--am-warning); }
        .am-summary-card.am-critical .am-card-icon,
        .am-summary-card.am-critical .am-card-value { color: var(--am-error); }

        /* ── Badges ────────────────────────────────────────────────── */
        .am-badge {
            display: inline-flex;
            align-items: center;
            padding: 3px 10px;
            border-radius: var(--am-radius-sm);
            font-size: 12px;
            font-weight: 500;
            border: 1px solid var(--am-border);
            background: var(--am-bg-surface);
            color: var(--am-text-secondary);
            gap: 4px;
        }

        .am-badge-success {
            background: color-mix(in srgb, var(--am-success) 15%, transparent);
            color: var(--am-success);
            border-color: color-mix(in srgb, var(--am-success) 30%, transparent);
        }

        .am-badge-warning {
            background: color-mix(in srgb, var(--am-warning) 15%, transparent);
            color: var(--am-warning);
            border-color: color-mix(in srgb, var(--am-warning) 30%, transparent);
        }

        .am-badge-error {
            background: color-mix(in srgb, var(--am-error) 15%, transparent);
            color: var(--am-error);
            border-color: color-mix(in srgb, var(--am-error) 30%, transparent);
        }

        .am-badge-info {
            background: color-mix(in srgb, var(--am-info) 15%, transparent);
            color: var(--am-info);
            border-color: color-mix(in srgb, var(--am-info) 30%, transparent);
        }

        .am-badge-pill {
            border-radius: var(--am-radius-pill);
            padding: 3px 12px;
        }

        /* ── Buttons ───────────────────────────────────────────────── */
        .am-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            border: 1px solid transparent;
            border-radius: var(--am-radius-md);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
        }

        .am-btn-primary {
            background: var(--am-btn-bg);
            color: var(--am-btn-fg);
        }

        .am-btn-primary:hover {
            background: var(--am-btn-hover);
        }

        .am-btn-secondary {
            background: var(--am-btn-secondary-bg);
            color: var(--am-btn-secondary-fg);
        }

        .am-btn-secondary:hover {
            background: var(--am-btn-secondary-hover);
        }

        .am-btn-ghost {
            background: transparent;
            color: var(--am-text-primary);
            border: 1px solid var(--am-border);
        }

        .am-btn-ghost:hover {
            background: var(--am-bg-surface-hover);
            border-color: var(--am-info);
        }

        .am-btn-icon {
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            border-radius: var(--am-radius-sm);
            padding: 6px 10px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
            color: var(--am-text-primary);
        }

        .am-btn-icon:hover {
            background: var(--am-bg-surface-hover);
            border-color: var(--am-info);
        }

        /* ── Data Table ────────────────────────────────────────────── */
        .am-table-container {
            background: var(--am-bg-surface);
            border-radius: var(--am-radius-lg);
            border: 1px solid var(--am-border);
            overflow: hidden;
        }

        .am-table {
            width: 100%;
            border-collapse: collapse;
        }

        .am-table th {
            background: var(--am-bg-secondary);
            padding: 12px 16px;
            text-align: left;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--am-text-secondary);
            border-bottom: 1px solid var(--am-border);
        }

        .am-table th.am-sortable {
            cursor: pointer;
            user-select: none;
        }

        .am-table th.am-sortable:hover {
            color: var(--am-info);
        }

        .am-table td {
            padding: 12px 16px;
            border-bottom: 1px solid var(--am-border);
            font-size: 13px;
        }

        .am-table tr.am-row:hover {
            background: var(--am-bg-surface-hover);
        }

        .am-table tr.am-row-warning {
            border-left: 3px solid var(--am-warning);
        }

        .am-table tr.am-row-critical {
            border-left: 3px solid var(--am-error);
        }

        .am-table .am-sort-icon {
            font-size: 10px;
            margin-left: 4px;
            opacity: 0.6;
        }

        /* ── Filters Bar ───────────────────────────────────────────── */
        .am-filters {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .am-input {
            flex: 1;
            min-width: 200px;
            padding: 8px 14px;
            background: var(--am-bg-input);
            border: 1px solid var(--am-border-input);
            border-radius: var(--am-radius-md);
            color: var(--am-text-primary);
            font-size: 13px;
            font-family: inherit;
        }

        .am-input:focus {
            outline: none;
            border-color: var(--am-border-focus);
        }

        .am-input::placeholder {
            color: var(--am-text-muted);
        }

        .am-select {
            padding: 8px 14px;
            background: var(--am-bg-input);
            border: 1px solid var(--am-border-input);
            border-radius: var(--am-radius-md);
            color: var(--am-text-primary);
            font-size: 13px;
            cursor: pointer;
            font-family: inherit;
        }

        .am-select:focus {
            outline: none;
            border-color: var(--am-border-focus);
        }

        /* ── Progress Bar ──────────────────────────────────────────── */
        .am-progress-container {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
            padding: 12px 16px;
            background: var(--am-bg-surface);
            border-radius: var(--am-radius-md);
            border: 1px solid var(--am-border);
        }

        .am-progress-bar {
            flex: 1;
            height: 6px;
            background: var(--am-bg-secondary);
            border-radius: 3px;
            overflow: hidden;
        }

        .am-progress-fill {
            height: 100%;
            background: var(--am-info);
            transition: width 0.3s ease;
            border-radius: 3px;
        }

        .am-progress-text {
            font-size: 12px;
            color: var(--am-text-secondary);
            min-width: 140px;
        }

        /* ── Loading Skeleton ──────────────────────────────────────── */
        .am-skeleton {
            background: linear-gradient(
                90deg,
                var(--am-bg-surface) 25%,
                var(--am-bg-surface-hover) 50%,
                var(--am-bg-surface) 75%
            );
            background-size: 200% 100%;
            animation: am-shimmer 1.5s infinite;
            border-radius: var(--am-radius-sm);
        }

        .am-skeleton-text {
            height: 14px;
            margin-bottom: 8px;
        }

        .am-skeleton-heading {
            height: 24px;
            width: 60%;
            margin-bottom: 12px;
        }

        .am-skeleton-card {
            height: 120px;
            border-radius: var(--am-radius-md);
        }

        /* ── Empty State ───────────────────────────────────────────── */
        .am-empty-state {
            padding: 48px 24px;
            text-align: center;
            color: var(--am-text-muted);
        }

        .am-empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.4;
        }

        .am-empty-state-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--am-text-secondary);
            margin-bottom: 8px;
        }

        .am-empty-state-description {
            font-size: 14px;
            margin-bottom: 20px;
            max-width: 400px;
            margin-left: auto;
            margin-right: auto;
        }

        /* ── Tabs ──────────────────────────────────────────────────── */
        .am-tabs {
            display: flex;
            border-bottom: 1px solid var(--am-border);
            margin-bottom: 24px;
            gap: 0;
        }

        .am-tab {
            padding: 10px 20px;
            border: none;
            background: transparent;
            color: var(--am-text-secondary);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s ease;
            font-family: inherit;
        }

        .am-tab:hover {
            color: var(--am-text-primary);
            background: var(--am-bg-surface-hover);
        }

        .am-tab.am-tab-active {
            color: var(--am-info);
            border-bottom-color: var(--am-info);
        }

        .am-tab-panel {
            display: none;
        }

        .am-tab-panel.am-tab-panel-active {
            display: block;
        }

        /* ── Health Indicator ──────────────────────────────────────── */
        .am-health {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: var(--am-radius-pill);
            background: var(--am-bg-surface);
            border: 1px solid var(--am-border);
            width: fit-content;
            cursor: help;
            position: relative;
        }

        .am-health.am-healthy .am-health-icon { color: var(--am-success); }
        .am-health.am-warning .am-health-icon { color: var(--am-warning); }
        .am-health.am-critical .am-health-icon { color: var(--am-error); }

        .am-health-score {
            font-weight: 500;
            font-size: 13px;
        }

        .am-health[data-tooltip]::after {
            content: attr(data-tooltip);
            position: absolute;
            left: 50%;
            bottom: calc(100% + 10px);
            transform: translateX(-50%) translateY(4px);
            background: var(--am-bg-secondary);
            border: 1px solid var(--am-border);
            color: var(--am-text-primary);
            font-size: 12px;
            line-height: 1.4;
            padding: 8px 10px;
            border-radius: var(--am-radius-md);
            white-space: pre-line;
            min-width: 200px;
            max-width: 260px;
            opacity: 0;
            pointer-events: none;
            box-shadow: var(--am-shadow-lg);
            z-index: 10;
            transition: opacity 0.15s ease, transform 0.15s ease;
        }

        .am-health[data-tooltip]:hover::after {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        /* ── Actions Cell ──────────────────────────────────────────── */
        .am-actions {
            display: flex;
            gap: 6px;
        }

        /* ── Responsive ────────────────────────────────────────────── */
        @media (max-width: 600px) {
            .am-page-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
            }

            .am-page-header-right {
                width: 100%;
                justify-content: flex-end;
            }

            .am-summary-cards {
                grid-template-columns: repeat(2, 1fr);
            }

            .am-filters {
                flex-direction: column;
            }

            .am-input {
                min-width: unset;
            }
        }
    `;
}

// ---------------------------------------------------------------------------
// Component generators
// ---------------------------------------------------------------------------

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';
export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface SummaryCardOptions {
    icon: string;
    value: string | number;
    label: string;
    variant?: HealthStatus | 'default';
    breakdown?: string;
    animationDelay?: string;
}

export function summaryCard(opts: SummaryCardOptions): string {
    const cls = opts.variant && opts.variant !== 'default' ? ` am-${opts.variant}` : '';
    const delay = opts.animationDelay ? ` style="animation-delay: ${opts.animationDelay}"` : '';
    const breakdownHtml = opts.breakdown ? `<div class="am-card-breakdown">${escapeHtml(opts.breakdown)}</div>` : '';
    return `
        <div class="am-summary-card${cls}"${delay}>
            <div class="am-card-icon">${opts.icon}</div>
            <div class="am-card-value">${escapeHtml(String(opts.value))}</div>
            <div class="am-card-label">${escapeHtml(opts.label)}</div>
            ${breakdownHtml}
        </div>
    `;
}

export function badge(text: string, variant: BadgeVariant = 'default', pill = false): string {
    const variantCls = variant !== 'default' ? ` am-badge-${variant}` : '';
    const pillCls = pill ? ' am-badge-pill' : '';
    return `<span class="am-badge${variantCls}${pillCls}">${escapeHtml(text)}</span>`;
}

export function healthIndicator(score: number, status: HealthStatus, tooltip?: string): string {
    const icons: Record<HealthStatus, string> = {
        healthy: '●',
        warning: '▲',
        critical: '✖'
    };
    const tooltipAttr = tooltip ? ` data-tooltip="${escapeAttr(tooltip)}"` : '';
    return `
        <div class="am-health am-${status}"${tooltipAttr}>
            <span class="am-health-icon">${icons[status]}</span>
            <span class="am-health-score">${score}</span>
        </div>
    `;
}

export function button(text: string, opts: { variant?: 'primary' | 'secondary' | 'ghost'; onclick?: string; icon?: string } = {}): string {
    const variant = opts.variant || 'ghost';
    const clickAttr = opts.onclick ? ` onclick="${escapeAttr(opts.onclick)}"` : '';
    const iconHtml = opts.icon ? `<span>${opts.icon}</span>` : '';
    return `<button class="am-btn am-btn-${variant}"${clickAttr}>${iconHtml}${escapeHtml(text)}</button>`;
}

export function iconButton(icon: string, opts: { onclick?: string; title?: string } = {}): string {
    const clickAttr = opts.onclick ? ` onclick="${escapeAttr(opts.onclick)}"` : '';
    const titleAttr = opts.title ? ` title="${escapeAttr(opts.title)}"` : '';
    return `<button class="am-btn-icon"${clickAttr}${titleAttr}>${icon}</button>`;
}

export function progressBar(value: number, text?: string): string {
    const pct = Math.min(100, Math.max(0, value));
    return `
        <div class="am-progress-container">
            <div class="am-progress-bar">
                <div class="am-progress-fill" style="width: ${pct}%"></div>
            </div>
            ${text ? `<span class="am-progress-text">${escapeHtml(text)}</span>` : ''}
        </div>
    `;
}

export function emptyState(opts: { icon?: string; title: string; description: string; actionHtml?: string }): string {
    const iconHtml = opts.icon ? `<div class="am-empty-state-icon">${opts.icon}</div>` : '';
    const actionHtml = opts.actionHtml || '';
    return `
        <div class="am-empty-state">
            ${iconHtml}
            <div class="am-empty-state-title">${escapeHtml(opts.title)}</div>
            <div class="am-empty-state-description">${escapeHtml(opts.description)}</div>
            ${actionHtml}
        </div>
    `;
}

export function skeleton(type: 'text' | 'heading' | 'card' = 'text', count = 1): string {
    const cls = `am-skeleton am-skeleton-${type}`;
    return Array.from({ length: count }, () => `<div class="${cls}"></div>`).join('');
}

export interface TabItem {
    id: string;
    label: string;
    active?: boolean;
}

export function tabs(items: TabItem[]): string {
    const tabsHtml = items.map(item => {
        const activeCls = item.active ? ' am-tab-active' : '';
        return `<button class="am-tab${activeCls}" data-tab="${escapeAttr(item.id)}" onclick="switchTab('${escapeAttr(item.id)}')">${escapeHtml(item.label)}</button>`;
    }).join('');
    return `<div class="am-tabs">${tabsHtml}</div>`;
}

export function tabSwitchScript(): string {
    return `
        function switchTab(tabId) {
            document.querySelectorAll('.am-tab').forEach(t => t.classList.remove('am-tab-active'));
            document.querySelectorAll('.am-tab-panel').forEach(p => p.classList.remove('am-tab-panel-active'));
            const activeTab = document.querySelector('.am-tab[data-tab="' + tabId + '"]');
            const activePanel = document.getElementById('tab-' + tabId);
            if (activeTab) activeTab.classList.add('am-tab-active');
            if (activePanel) activePanel.classList.add('am-tab-panel-active');
        }
    `;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function escapeAttr(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Wraps full page HTML with theme + component styles.
 */
export function wrapWebviewHtml(opts: {
    title: string;
    body: string;
    scripts?: string;
    extraStyles?: string;
    nonce?: string;
}): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(opts.title)}</title>
    <style>
        ${getAllBaseStylesInline()}
        ${getComponentStyles()}
        ${opts.extraStyles || ''}
    </style>
</head>
<body>
    ${opts.body}
    ${opts.scripts ? `<script>${opts.scripts}</script>` : ''}
</body>
</html>`;
}

function getAllBaseStylesInline(): string {
    // Inline the theme tokens so this file is self-contained
    return `
        :root {
            --am-bg-primary: var(--vscode-editor-background);
            --am-bg-secondary: var(--vscode-sideBar-background, var(--vscode-editor-background));
            --am-bg-surface: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            --am-bg-surface-hover: var(--vscode-list-hoverBackground);
            --am-bg-input: var(--vscode-input-background);
            --am-bg-badge: var(--vscode-badge-background);

            --am-text-primary: var(--vscode-editor-foreground);
            --am-text-secondary: var(--vscode-descriptionForeground);
            --am-text-muted: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
            --am-text-link: var(--vscode-textLink-foreground);
            --am-text-link-active: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
            --am-text-badge: var(--vscode-badge-foreground);

            --am-border: var(--vscode-panel-border, var(--vscode-editorWidget-border, rgba(128,128,128,0.35)));
            --am-border-input: var(--vscode-input-border, var(--am-border));
            --am-border-focus: var(--vscode-focusBorder);

            --am-success: var(--vscode-testing-iconPassed, #3fb950);
            --am-warning: var(--vscode-editorWarning-foreground, #d29922);
            --am-error: var(--vscode-testing-iconFailed, #f85149);
            --am-info: var(--vscode-textLink-foreground, #58a6ff);

            --am-btn-bg: var(--vscode-button-background);
            --am-btn-fg: var(--vscode-button-foreground);
            --am-btn-hover: var(--vscode-button-hoverBackground);
            --am-btn-secondary-bg: var(--vscode-button-secondaryBackground);
            --am-btn-secondary-fg: var(--vscode-button-secondaryForeground);
            --am-btn-secondary-hover: var(--vscode-button-secondaryHoverBackground);

            --am-radius-sm: 4px;
            --am-radius-md: 8px;
            --am-radius-lg: 12px;
            --am-radius-pill: 999px;

            --am-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
            --am-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
            --am-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            background: var(--am-bg-primary);
            color: var(--am-text-primary);
            line-height: 1.5;
            padding: 24px;
            overflow-x: hidden;
        }

        a { color: var(--am-text-link); text-decoration: none; }
        a:hover { color: var(--am-text-link-active); text-decoration: underline; }

        @keyframes am-fadeIn {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes am-slideDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes am-slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes am-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        @keyframes am-shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
        }
    `;
}
