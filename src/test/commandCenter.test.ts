import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

suite('Command Center Rivian Redesign', () => {

    const rootDir = path.resolve(__dirname, '..', '..');
    const srcDir = path.join(rootDir, 'src');
    let fileContent: string;

    suiteSetup(() => {
        fileContent = fs.readFileSync(
            path.join(srcDir, 'anypoint', 'applicationCommandCenter.ts'),
            'utf-8'
        );
    });

    suite('Theme tokens', () => {
        test('CSS root block uses --am-* variables, not hardcoded hex', () => {
            const rootBlockMatch = fileContent.match(/:root\s*\{([^}]+)\}/);
            assert.ok(rootBlockMatch, 'should contain a :root block');
            const rootBlock = rootBlockMatch![1];
            assert.ok(
                rootBlock.includes('--am-bg-primary'),
                'root block should define --am-bg-primary'
            );
            assert.ok(
                !rootBlock.includes('#1e2328'),
                'should not contain old hardcoded background-primary hex'
            );
            assert.ok(
                !rootBlock.includes('#161b22'),
                'should not contain old hardcoded background-secondary hex'
            );
            assert.ok(
                !rootBlock.includes('#21262d'),
                'should not contain old hardcoded surface-primary hex'
            );
        });

        test('uses --am-* variables throughout CSS', () => {
            assert.ok(
                fileContent.includes('var(--am-bg-primary)'),
                'should reference --am-bg-primary'
            );
            assert.ok(
                fileContent.includes('var(--am-text-primary)'),
                'should reference --am-text-primary'
            );
            assert.ok(
                fileContent.includes('var(--am-border)'),
                'should reference --am-border'
            );
            assert.ok(
                fileContent.includes('var(--am-success)'),
                'should reference --am-success'
            );
            assert.ok(
                fileContent.includes('var(--am-info)'),
                'should reference --am-info'
            );
        });

        test('does not contain old hardcoded CSS variable names', () => {
            assert.ok(
                !fileContent.includes('--background-primary:'),
                'should not define --background-primary'
            );
            assert.ok(
                !fileContent.includes('--surface-primary:'),
                'should not define --surface-primary'
            );
            assert.ok(
                !fileContent.includes('--accent-blue:'),
                'should not define --accent-blue'
            );
        });
    });

    suite('No emoji in HTML output', () => {
        const htmlGeneratorMatch = /function getCommandCenterHtml[\s\S]+?^}/m;

        test('tab buttons contain no emoji', () => {
            const tabSection = fileContent.match(/<!-- Tabs -->[\s\S]*?<\/div>\s*\n/);
            assert.ok(tabSection, 'should contain a Tabs section');
            const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
            assert.ok(
                !emojiPattern.test(tabSection![0]),
                'tab section should not contain emoji characters'
            );
        });

        test('toolbar section contains no emoji', () => {
            const toolbarSection = fileContent.match(/<!-- Toolbar -->[\s\S]*?<\/div>\s*\n/);
            assert.ok(toolbarSection, 'should contain a Toolbar section');
            assert.ok(
                !toolbarSection![0].includes('\u{1F504}') && !toolbarSection![0].includes('\u26A1'),
                'toolbar should not contain emoji'
            );
        });

        test('getCommandCenterHtml output uses SVG icons in toolbar, not emoji', () => {
            assert.ok(
                fileContent.includes('cc-toolbar-btn'),
                'should use cc-toolbar-btn class'
            );
            assert.ok(
                fileContent.includes('<svg viewBox="0 0 24 24"'),
                'should use inline SVG icons'
            );
        });
    });

    suite('Header redesign', () => {
        test('uses cc-app-name class with light font weight', () => {
            assert.ok(fileContent.includes('cc-app-name'), 'should have cc-app-name class');
            assert.ok(
                fileContent.includes('font-weight: 300'),
                'should use weight-300 for app name'
            );
        });

        test('uses cc-meta for micro-labels', () => {
            assert.ok(fileContent.includes('cc-meta'), 'should have cc-meta class');
            assert.ok(
                fileContent.includes('text-transform: uppercase'),
                'meta labels should be uppercase'
            );
        });

        test('uses icon-only refresh button', () => {
            assert.ok(fileContent.includes('cc-refresh-btn'), 'should have cc-refresh-btn class');
        });
    });

    suite('Tab bar redesign', () => {
        test('uses segmented control style', () => {
            assert.ok(fileContent.includes('cc-tabs'), 'should have cc-tabs class');
            assert.ok(fileContent.includes('cc-tab'), 'should have cc-tab class');
        });

        test('tabs use uppercase tracked text', () => {
            const tabStyles = fileContent.match(/\.cc-tab\s*\{[^}]+\}/);
            assert.ok(tabStyles, 'should have .cc-tab styles');
            assert.ok(
                tabStyles![0].includes('text-transform: uppercase'),
                'tab text should be uppercase'
            );
            assert.ok(
                tabStyles![0].includes('letter-spacing'),
                'tab text should have letter-spacing'
            );
        });
    });

    suite('Overview tab redesign', () => {
        test('uses thin health ring (3px stroke)', () => {
            assert.ok(
                fileContent.includes('stroke-width: 3'),
                'health ring should use 3px stroke'
            );
        });

        test('uses cc-ring-score with 36px weight-300 number', () => {
            assert.ok(fileContent.includes('cc-ring-score'), 'should have cc-ring-score class');
            const scoreStyles = fileContent.match(/\.cc-ring-score\s*\{[^}]+\}/);
            assert.ok(scoreStyles, 'should have .cc-ring-score styles');
            assert.ok(
                scoreStyles![0].includes('font-size: 36px'),
                'score should be 36px'
            );
            assert.ok(
                scoreStyles![0].includes('font-weight: 300'),
                'score should be weight-300'
            );
        });

        test('uses horizontal stat strip', () => {
            assert.ok(fileContent.includes('cc-stats'), 'should have cc-stats class');
            assert.ok(fileContent.includes('cc-stat-label'), 'should have cc-stat-label class');
            assert.ok(fileContent.includes('cc-stat-value'), 'should have cc-stat-value class');
        });

        test('uses clean key-value grid for application details', () => {
            assert.ok(fileContent.includes('cc-kv-grid'), 'should have cc-kv-grid class');
            assert.ok(fileContent.includes('cc-kv-title'), 'should have cc-kv-title section headers');
        });

        test('health breakdown is collapsible', () => {
            assert.ok(fileContent.includes('cc-breakdown-toggle'), 'should have collapsible breakdown');
            assert.ok(fileContent.includes('cc-breakdown-list'), 'should have breakdown list');
        });
    });

    suite('Metrics tab redesign', () => {
        test('uses segmented time-range pills', () => {
            assert.ok(fileContent.includes('cc-seg-group'), 'should have cc-seg-group class');
            assert.ok(fileContent.includes('cc-seg-btn'), 'should have cc-seg-btn class');
            assert.ok(fileContent.includes('cc-seg-active'), 'should have active state class');
        });

        test('chart cards use accent-color fills', () => {
            assert.ok(fileContent.includes('cc-chart-card'), 'should have cc-chart-card class');
            assert.ok(fileContent.includes('cc-chart-svg'), 'should have cc-chart-svg class');
        });

        test('uses large number for current metric value', () => {
            assert.ok(fileContent.includes('cc-chart-value'), 'should have cc-chart-value class');
            const chartValueStyles = fileContent.match(/\.cc-chart-value\s*\{[^}]+\}/);
            assert.ok(chartValueStyles, 'should have .cc-chart-value styles');
            assert.ok(
                chartValueStyles![0].includes('font-size: 24px'),
                'chart value should be large (24px)'
            );
        });
    });

    suite('Schedulers tab redesign', () => {
        test('uses single-line rows', () => {
            assert.ok(fileContent.includes('cc-sched-row'), 'should have cc-sched-row class');
        });

        test('uses status dot instead of colored badge', () => {
            assert.ok(fileContent.includes('cc-dot-ok'), 'should use dot indicator for enabled');
            assert.ok(fileContent.includes('cc-dot-off'), 'should use dot indicator for disabled');
        });
    });

    suite('Configuration tab redesign', () => {
        test('uses kv-grid for spec-sheet layout', () => {
            assert.ok(
                fileContent.includes('cc-config-grid') || fileContent.includes('cc-kv-grid'),
                'configuration should use kv-grid layout'
            );
        });

        test('uses uppercase tracked text for section headers', () => {
            assert.ok(fileContent.includes('cc-kv-title'), 'should use cc-kv-title for section headers');
        });

        test('uses boolean dot indicators instead of emoji', () => {
            assert.ok(
                fileContent.includes('boolIcon'),
                'should use boolIcon helper for boolean values'
            );
        });
    });

    suite('Logs tab redesign', () => {
        test('uses minimal centered CTA', () => {
            assert.ok(fileContent.includes('cc-cta'), 'should have cc-cta class');
            assert.ok(fileContent.includes('cc-cta-btn'), 'should have cc-cta-btn class');
        });
    });

    suite('Network tab redesign', () => {
        test('uses collapsible sections with monochrome rows', () => {
            assert.ok(fileContent.includes('cc-net-section'), 'should have cc-net-section class');
            assert.ok(fileContent.includes('cc-net-row'), 'should have cc-net-row class');
        });
    });

    suite('Confirmation dialog redesign', () => {
        test('uses cc-dialog classes', () => {
            assert.ok(fileContent.includes('cc-overlay'), 'should have cc-overlay class');
            assert.ok(fileContent.includes('cc-dialog'), 'should have cc-dialog class');
            assert.ok(fileContent.includes('cc-dialog-btn-primary'), 'should have primary dialog button');
        });

        test('dialog uses backdrop-filter, not box-shadow', () => {
            const overlayStyles = fileContent.match(/\.cc-overlay\s*\{[^}]+\}/);
            assert.ok(overlayStyles, 'should have .cc-overlay styles');
            assert.ok(
                overlayStyles![0].includes('backdrop-filter'),
                'dialog overlay should use backdrop-filter for blur'
            );
        });
    });

    suite('postMessage commands preserved', () => {
        const requiredCommands = [
            'refresh',
            'updateMetricsRange',
            'refreshMetrics',
            'tabChanged',
            'restartApp',
            'stopApp',
            'startApp',
            'openLogs',
            'exportCSV',
            'compareEnvironments',
            'generateDiagram'
        ];

        requiredCommands.forEach(cmd => {
            test(`preserves '${cmd}' command`, () => {
                assert.ok(
                    fileContent.includes(`command: '${cmd}'`),
                    `should contain postMessage command '${cmd}'`
                );
            });
        });
    });
});
