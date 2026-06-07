import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

suite('Premium Panel UI Kit Integration', () => {

    const rootDir = path.resolve(__dirname, '..', '..');
    const srcDir = path.join(rootDir, 'src');

    suite('alertPanel.ts', () => {
        let fileContent: string;

        suiteSetup(() => {
            fileContent = fs.readFileSync(path.join(srcDir, 'premium', 'alerting', 'alertPanel.ts'), 'utf-8');
        });

        test('imports from shared UI kit', () => {
            assert.ok(fileContent.includes("from '../../webview/ui-kit'"), 'should import from ui-kit');
        });

        test('uses wrapWebviewHtml for HTML generation', () => {
            assert.ok(fileContent.includes('wrapWebviewHtml'), 'should use wrapWebviewHtml');
        });

        test('uses theme variables instead of hardcoded colors', () => {
            assert.ok(!fileContent.includes('--bg: #1e1e1e'), 'should not contain hardcoded dark theme root variables');
            assert.ok(!fileContent.includes('--surface: #252526'), 'should not contain hardcoded surface color');
        });

        test('uses am-* CSS classes for layout', () => {
            assert.ok(fileContent.includes('am-container'), 'should use am-container');
            assert.ok(fileContent.includes('am-page-header'), 'should use am-page-header');
            assert.ok(fileContent.includes('am-summary-cards'), 'should use am-summary-cards');
            assert.ok(fileContent.includes('am-table'), 'should use am-table');
        });

        test('uses UI kit component functions', () => {
            assert.ok(fileContent.includes('summaryCard('), 'should use summaryCard component');
            assert.ok(fileContent.includes('badge('), 'should use badge component');
            assert.ok(fileContent.includes('button('), 'should use button component');
            assert.ok(fileContent.includes('tabs('), 'should use tabs component');
            assert.ok(fileContent.includes('emptyState('), 'should use emptyState component');
        });

        test('uses escapeHtml for user-supplied values', () => {
            assert.ok(fileContent.includes('uiEscapeHtml'), 'should use escapeHtml from ui-kit');
        });

        test('uses escapeAttr for HTML attributes', () => {
            assert.ok(fileContent.includes('escapeAttr'), 'should use escapeAttr from ui-kit');
        });

        test('preserves all message handler commands', () => {
            const commands = ['startPolling', 'stopPolling', 'acknowledge', 'snooze', 'resolve', 'clearResolved', 'muteApp', 'unmuteApp', 'updateRule', 'updateInterval', 'exportCsv'];
            for (const cmd of commands) {
                assert.ok(fileContent.includes(`'${cmd}'`), `should handle '${cmd}' command`);
            }
        });
    });

    suite('costOptimizerPanel.ts', () => {
        let fileContent: string;

        suiteSetup(() => {
            fileContent = fs.readFileSync(path.join(srcDir, 'premium', 'costOptimizer', 'costOptimizerPanel.ts'), 'utf-8');
        });

        test('imports from shared UI kit', () => {
            assert.ok(fileContent.includes("from '../../webview/ui-kit'"), 'should import from ui-kit');
        });

        test('uses wrapWebviewHtml for HTML generation', () => {
            assert.ok(fileContent.includes('wrapWebviewHtml'), 'should use wrapWebviewHtml');
        });

        test('uses theme variables instead of hardcoded colors', () => {
            assert.ok(!fileContent.includes('--bg: #1e1e1e'), 'should not contain hardcoded dark theme root variables');
        });

        test('uses am-* CSS classes for table and filters', () => {
            assert.ok(fileContent.includes('am-table'), 'should use am-table');
            assert.ok(fileContent.includes('am-filters'), 'should use am-filters');
            assert.ok(fileContent.includes('am-select'), 'should use am-select');
        });

        test('uses UI kit component functions', () => {
            assert.ok(fileContent.includes('summaryCard('), 'should use summaryCard component');
            assert.ok(fileContent.includes('badge('), 'should use badge component');
            assert.ok(fileContent.includes('button('), 'should use button component');
        });

        test('preserves CSV and Markdown export functionality', () => {
            assert.ok(fileContent.includes('exportCsv'), 'should support CSV export');
            assert.ok(fileContent.includes('exportMarkdown'), 'should support Markdown export');
        });

        test('preserves optimization score SVG ring', () => {
            assert.ok(fileContent.includes('co-score-ring'), 'should render score ring');
            assert.ok(fileContent.includes('stroke-dasharray'), 'should use SVG stroke-dasharray for ring');
        });
    });

    suite('dependencyVizPanel.ts', () => {
        let fileContent: string;

        suiteSetup(() => {
            fileContent = fs.readFileSync(path.join(srcDir, 'premium', 'dependencyViz', 'dependencyVizPanel.ts'), 'utf-8');
        });

        test('imports from shared UI kit', () => {
            assert.ok(fileContent.includes("from '../../webview/ui-kit'"), 'should import from ui-kit');
        });

        test('uses wrapWebviewHtml for HTML generation', () => {
            assert.ok(fileContent.includes('wrapWebviewHtml'), 'should use wrapWebviewHtml');
        });

        test('uses theme variables instead of hardcoded colors', () => {
            assert.ok(!fileContent.includes('--bg: #1e1e1e'), 'should not contain hardcoded dark theme root variables');
        });

        test('preserves canvas-based graph rendering', () => {
            assert.ok(fileContent.includes('graphCanvas'), 'should have canvas element');
            assert.ok(fileContent.includes('requestAnimationFrame'), 'should use requestAnimationFrame for rendering');
            assert.ok(fileContent.includes('simulate'), 'should have force simulation');
        });

        test('preserves interactive features', () => {
            assert.ok(fileContent.includes('mousedown'), 'should handle mouse interactions');
            assert.ok(fileContent.includes('wheel'), 'should handle zoom via wheel');
            assert.ok(fileContent.includes('dblclick'), 'should handle double-click for retrace');
        });

        test('uses am-* themed variables in CSS', () => {
            assert.ok(fileContent.includes('var(--am-'), 'should use --am-* CSS variables');
            assert.ok(fileContent.includes('var(--am-bg-surface)'), 'should reference am-bg-surface');
            assert.ok(fileContent.includes('var(--am-border)'), 'should reference am-border');
        });

        test('preserves detail sidebar with metrics', () => {
            assert.ok(fileContent.includes('ct-detail-sidebar'), 'should have detail sidebar');
            assert.ok(fileContent.includes('renderDetail'), 'should have renderDetail function');
            assert.ok(fileContent.includes('ct-metric-row'), 'should display metrics rows');
        });
    });

    suite('environmentComparison.ts', () => {
        let fileContent: string;

        suiteSetup(() => {
            fileContent = fs.readFileSync(path.join(srcDir, 'anypoint', 'environmentComparison.ts'), 'utf-8');
        });

        test('imports from shared UI kit', () => {
            assert.ok(fileContent.includes("from '../webview/ui-kit'"), 'should import from ui-kit');
        });

        test('uses wrapWebviewHtml for HTML generation', () => {
            assert.ok(fileContent.includes('wrapWebviewHtml'), 'should use wrapWebviewHtml');
        });

        test('uses theme variables instead of hardcoded colors', () => {
            assert.ok(!fileContent.includes("background-color: #28a745"), 'should not contain hardcoded green');
            assert.ok(!fileContent.includes("background-color: #dc3545"), 'should not contain hardcoded red');
        });

        test('uses am-* classes for shared components', () => {
            assert.ok(fileContent.includes('am-container'), 'should use am-container');
            assert.ok(fileContent.includes('am-page-header'), 'should use am-page-header');
            assert.ok(fileContent.includes('am-summary-cards'), 'should use am-summary-cards');
            assert.ok(fileContent.includes('am-filters'), 'should use am-filters');
        });

        test('uses summaryCard for statistics', () => {
            assert.ok(fileContent.includes('summaryCard('), 'should use summaryCard component');
        });

        test('preserves CSV export functionality', () => {
            assert.ok(fileContent.includes('generateEnvironmentComparisonCSV'), 'should have CSV generation');
            assert.ok(fileContent.includes('exportEnvironmentComparisonData'), 'should have export function');
        });

        test('preserves comparison badges logic', () => {
            assert.ok(fileContent.includes('generateComparisonBadges'), 'should have badge generation logic');
            assert.ok(fileContent.includes('version-diff'), 'should detect version differences');
            assert.ok(fileContent.includes('config-diff'), 'should detect config differences');
        });

        test('preserves filter and toggle functionality', () => {
            assert.ok(fileContent.includes('applyFilters'), 'should have filter function');
            assert.ok(fileContent.includes('toggleAdvanced'), 'should have advanced toggle');
            assert.ok(fileContent.includes('toggleHighlightDifferences'), 'should have highlight toggle');
        });
    });
});
