import * as assert from 'assert';
import {
    escapeHtml,
    escapeAttr,
    badge,
    summaryCard,
    healthIndicator,
    button,
    iconButton,
    progressBar,
    emptyState,
    skeleton,
    wrapWebviewHtml,
    getComponentStyles,
} from '../webview/ui-kit';

suite('Webview UI Kit', () => {

    // ── escapeHtml ─────────────────────────────────────────────────

    suite('escapeHtml', () => {
        test('escapes angle brackets', () => {
            assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
        });

        test('escapes ampersand', () => {
            assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
        });

        test('escapes double quotes', () => {
            assert.strictEqual(escapeHtml('"hello"'), '&quot;hello&quot;');
        });

        test('escapes single quotes', () => {
            assert.strictEqual(escapeHtml("it's"), "it&#039;s");
        });

        test('handles strings with all special characters', () => {
            const result = escapeHtml('<a href="x">&\'test\'</a>');
            assert.ok(!result.includes('<'));
            assert.ok(!result.includes('>'));
            assert.ok(result.includes('&amp;'));
            assert.ok(result.includes('&quot;'));
            assert.ok(result.includes('&#039;'));
        });

        test('passes through safe strings unchanged', () => {
            assert.strictEqual(escapeHtml('hello world 123'), 'hello world 123');
        });
    });

    // ── escapeAttr ─────────────────────────────────────────────────

    suite('escapeAttr', () => {
        test('escapes double quotes for attribute context', () => {
            assert.strictEqual(escapeAttr('say "hi"'), 'say &quot;hi&quot;');
        });

        test('escapes angle brackets', () => {
            assert.strictEqual(escapeAttr('<img>'), '&lt;img&gt;');
        });
    });

    // ── badge ──────────────────────────────────────────────────────

    suite('badge', () => {
        test('renders default badge with correct class', () => {
            const html = badge('Test');
            assert.ok(html.includes('class="am-badge"'));
            assert.ok(html.includes('Test'));
            assert.ok(!html.includes('am-badge-success'));
        });

        test('renders success variant', () => {
            const html = badge('Running', 'success');
            assert.ok(html.includes('am-badge-success'));
        });

        test('renders warning variant', () => {
            const html = badge('Degraded', 'warning');
            assert.ok(html.includes('am-badge-warning'));
        });

        test('renders error variant', () => {
            const html = badge('Stopped', 'error');
            assert.ok(html.includes('am-badge-error'));
        });

        test('renders info variant', () => {
            const html = badge('Info', 'info');
            assert.ok(html.includes('am-badge-info'));
        });

        test('adds pill class when pill=true', () => {
            const html = badge('Pill', 'default', true);
            assert.ok(html.includes('am-badge-pill'));
        });

        test('escapes text content', () => {
            const html = badge('<script>alert(1)</script>');
            assert.ok(!html.includes('<script>'));
            assert.ok(html.includes('&lt;script&gt;'));
        });
    });

    // ── summaryCard ────────────────────────────────────────────────

    suite('summaryCard', () => {
        test('includes all required child elements', () => {
            const html = summaryCard({ icon: '📊', value: 42, label: 'Total Apps' });
            assert.ok(html.includes('am-summary-card'));
            assert.ok(html.includes('am-card-icon'));
            assert.ok(html.includes('am-card-value'));
            assert.ok(html.includes('am-card-label'));
            assert.ok(html.includes('42'));
            assert.ok(html.includes('Total Apps'));
        });

        test('applies variant class for healthy', () => {
            const html = summaryCard({ icon: '✓', value: 10, label: 'Healthy', variant: 'healthy' });
            assert.ok(html.includes('am-healthy'));
        });

        test('applies variant class for critical', () => {
            const html = summaryCard({ icon: '✖', value: 3, label: 'Critical', variant: 'critical' });
            assert.ok(html.includes('am-critical'));
        });

        test('renders breakdown text when provided', () => {
            const html = summaryCard({ icon: '📊', value: 42, label: 'Total', breakdown: 'CH1: 10, CH2: 32' });
            assert.ok(html.includes('am-card-breakdown'));
            assert.ok(html.includes('CH1: 10, CH2: 32'));
        });

        test('omits breakdown element when not provided', () => {
            const html = summaryCard({ icon: '📊', value: 42, label: 'Total' });
            assert.ok(!html.includes('am-card-breakdown'));
        });

        test('applies animation delay when provided', () => {
            const html = summaryCard({ icon: '📊', value: 1, label: 'X', animationDelay: '0.2s' });
            assert.ok(html.includes('animation-delay: 0.2s'));
        });
    });

    // ── healthIndicator ────────────────────────────────────────────

    suite('healthIndicator', () => {
        test('renders healthy status with correct icon', () => {
            const html = healthIndicator(95, 'healthy');
            assert.ok(html.includes('am-healthy'));
            assert.ok(html.includes('●'));
            assert.ok(html.includes('95'));
        });

        test('renders warning status with correct icon', () => {
            const html = healthIndicator(65, 'warning');
            assert.ok(html.includes('am-warning'));
            assert.ok(html.includes('▲'));
        });

        test('renders critical status with correct icon', () => {
            const html = healthIndicator(30, 'critical');
            assert.ok(html.includes('am-critical'));
            assert.ok(html.includes('✖'));
        });

        test('includes tooltip when provided', () => {
            const html = healthIndicator(80, 'healthy', 'CPU: 45%\nMemory: 60%');
            assert.ok(html.includes('data-tooltip='));
        });

        test('omits tooltip attribute when not provided', () => {
            const html = healthIndicator(80, 'healthy');
            assert.ok(!html.includes('data-tooltip'));
        });
    });

    // ── button ─────────────────────────────────────────────────────

    suite('button', () => {
        test('renders ghost variant by default', () => {
            const html = button('Click me');
            assert.ok(html.includes('am-btn-ghost'));
            assert.ok(html.includes('Click me'));
        });

        test('renders primary variant', () => {
            const html = button('Submit', { variant: 'primary' });
            assert.ok(html.includes('am-btn-primary'));
        });

        test('includes onclick attribute', () => {
            const html = button('Go', { onclick: "doSomething()" });
            assert.ok(html.includes('onclick='));
        });

        test('includes icon when provided', () => {
            const html = button('Export', { icon: '📥' });
            assert.ok(html.includes('📥'));
        });
    });

    // ── iconButton ─────────────────────────────────────────────────

    suite('iconButton', () => {
        test('renders icon button with icon content', () => {
            const html = iconButton('🔄');
            assert.ok(html.includes('am-btn-icon'));
            assert.ok(html.includes('🔄'));
        });

        test('includes title attribute when provided', () => {
            const html = iconButton('🔄', { title: 'Refresh' });
            assert.ok(html.includes('title="Refresh"'));
        });
    });

    // ── progressBar ────────────────────────────────────────────────

    suite('progressBar', () => {
        test('renders progress fill at correct percentage', () => {
            const html = progressBar(75);
            assert.ok(html.includes('width: 75%'));
        });

        test('clamps value to 0-100 range', () => {
            const over = progressBar(150);
            assert.ok(over.includes('width: 100%'));
            const under = progressBar(-10);
            assert.ok(under.includes('width: 0%'));
        });

        test('includes text when provided', () => {
            const html = progressBar(50, 'Loading metrics...');
            assert.ok(html.includes('am-progress-text'));
            assert.ok(html.includes('Loading metrics...'));
        });
    });

    // ── emptyState ─────────────────────────────────────────────────

    suite('emptyState', () => {
        test('renders title and description', () => {
            const html = emptyState({ title: 'No data', description: 'Try again later.' });
            assert.ok(html.includes('am-empty-state'));
            assert.ok(html.includes('No data'));
            assert.ok(html.includes('Try again later.'));
        });

        test('includes icon when provided', () => {
            const html = emptyState({ icon: '📭', title: 'Empty', description: 'Nothing here.' });
            assert.ok(html.includes('am-empty-state-icon'));
            assert.ok(html.includes('📭'));
        });

        test('includes action HTML when provided', () => {
            const html = emptyState({
                title: 'No apps',
                description: 'Connect first.',
                actionHtml: '<button>Connect</button>'
            });
            assert.ok(html.includes('<button>Connect</button>'));
        });
    });

    // ── skeleton ───────────────────────────────────────────────────

    suite('skeleton', () => {
        test('renders text skeleton by default', () => {
            const html = skeleton();
            assert.ok(html.includes('am-skeleton-text'));
        });

        test('renders heading skeleton', () => {
            const html = skeleton('heading');
            assert.ok(html.includes('am-skeleton-heading'));
        });

        test('renders card skeleton', () => {
            const html = skeleton('card');
            assert.ok(html.includes('am-skeleton-card'));
        });

        test('renders multiple items', () => {
            const html = skeleton('text', 3);
            const matches = html.match(/am-skeleton-text/g);
            assert.strictEqual(matches?.length, 3);
        });
    });

    // ── wrapWebviewHtml ────────────────────────────────────────────

    suite('wrapWebviewHtml', () => {
        test('produces a complete HTML document', () => {
            const html = wrapWebviewHtml({ title: 'Test', body: '<p>Hello</p>' });
            assert.ok(html.startsWith('<!DOCTYPE html>'));
            assert.ok(html.includes('<html lang="en">'));
            assert.ok(html.includes('</html>'));
        });

        test('includes title in head', () => {
            const html = wrapWebviewHtml({ title: 'Dashboard', body: '' });
            assert.ok(html.includes('<title>Dashboard</title>'));
        });

        test('includes --am-* CSS variables', () => {
            const html = wrapWebviewHtml({ title: 'Test', body: '' });
            assert.ok(html.includes('--am-bg-primary'));
            assert.ok(html.includes('--am-text-primary'));
            assert.ok(html.includes('--am-success'));
        });

        test('includes component styles', () => {
            const html = wrapWebviewHtml({ title: 'Test', body: '' });
            assert.ok(html.includes('.am-badge'));
            assert.ok(html.includes('.am-btn'));
            assert.ok(html.includes('.am-table'));
        });

        test('includes body content', () => {
            const html = wrapWebviewHtml({ title: 'Test', body: '<div id="root">Content</div>' });
            assert.ok(html.includes('<div id="root">Content</div>'));
        });

        test('includes scripts when provided', () => {
            const html = wrapWebviewHtml({ title: 'Test', body: '', scripts: 'console.log("hi")' });
            assert.ok(html.includes('<script>'));
            assert.ok(html.includes('console.log("hi")'));
        });

        test('omits script tag when no scripts provided', () => {
            const html = wrapWebviewHtml({ title: 'Test', body: '' });
            assert.ok(!html.includes('<script>'));
        });

        test('includes extra styles when provided', () => {
            const html = wrapWebviewHtml({ title: 'Test', body: '', extraStyles: '.custom { color: red; }' });
            assert.ok(html.includes('.custom { color: red; }'));
        });

        test('escapes title to prevent XSS', () => {
            const html = wrapWebviewHtml({ title: '<script>alert(1)</script>', body: '' });
            assert.ok(!html.includes('<script>alert(1)</script>'));
            assert.ok(html.includes('&lt;script&gt;'));
        });
    });

    // ── getComponentStyles ─────────────────────────────────────────

    suite('getComponentStyles', () => {
        test('returns non-empty CSS string', () => {
            const css = getComponentStyles();
            assert.ok(css.length > 0);
        });

        test('includes key component selectors', () => {
            const css = getComponentStyles();
            assert.ok(css.includes('.am-summary-card'));
            assert.ok(css.includes('.am-badge'));
            assert.ok(css.includes('.am-btn'));
            assert.ok(css.includes('.am-table'));
            assert.ok(css.includes('.am-health'));
            assert.ok(css.includes('.am-progress-bar'));
            assert.ok(css.includes('.am-empty-state'));
            assert.ok(css.includes('.am-skeleton'));
        });
    });
});
