import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

suite('Organization Details Rivian Redesign', () => {

    const rootDir = path.resolve(__dirname, '..', '..');
    const srcDir = path.join(rootDir, 'src');
    let fileContent: string;

    suiteSetup(() => {
        fileContent = fs.readFileSync(
            path.join(srcDir, 'anypoint', 'organizationInfo.ts'),
            'utf-8'
        );
    });

    suite('Theme tokens', () => {
        test('uses --od-* semantic aliases mapped to --vscode-* tokens', () => {
            assert.ok(fileContent.includes('--od-bg:'), 'should define --od-bg');
            assert.ok(fileContent.includes('--od-text:'), 'should define --od-text');
            assert.ok(fileContent.includes('--od-accent:'), 'should define --od-accent');
            assert.ok(fileContent.includes('--od-border:'), 'should define --od-border');
            assert.ok(fileContent.includes('--od-success:'), 'should define --od-success');
            assert.ok(fileContent.includes('--od-warning:'), 'should define --od-warning');
            assert.ok(fileContent.includes('--od-error:'), 'should define --od-error');
        });

        test('does not contain old hardcoded hex color variables', () => {
            assert.ok(!fileContent.includes('--background-primary:'), 'no old --background-primary');
            assert.ok(!fileContent.includes('--surface-primary:'), 'no old --surface-primary');
            assert.ok(!fileContent.includes('--accent-blue:'), 'no old --accent-blue');
            assert.ok(!fileContent.includes('--border-primary:'), 'no old --border-primary');
        });

        test('references vscode theme tokens', () => {
            assert.ok(fileContent.includes('var(--vscode-editor-background)'), 'uses vscode-editor-background');
            assert.ok(fileContent.includes('var(--vscode-editor-foreground)'), 'uses vscode-editor-foreground');
            assert.ok(fileContent.includes('var(--vscode-textLink-foreground'), 'uses vscode-textLink-foreground');
        });
    });

    suite('Header redesign', () => {
        test('uses weight-300 large type for org name', () => {
            assert.ok(fileContent.includes('od-org-name'), 'should have od-org-name class');
            assert.ok(fileContent.includes('font-weight: 300'), 'should use weight-300');
        });

        test('uses uppercase micro-label for subtitle', () => {
            assert.ok(fileContent.includes('od-subtitle'), 'should have od-subtitle class');
            assert.ok(fileContent.includes('text-transform: uppercase'), 'subtitle should be uppercase');
        });

        test('does not use old header with background-secondary', () => {
            assert.ok(!fileContent.includes('class="header"'), 'no old .header class');
            assert.ok(!fileContent.includes('header-content'), 'no old header-content class');
        });
    });

    suite('Arc gauges', () => {
        test('renders 3 gauge rings for key resources', () => {
            assert.ok(fileContent.includes('od-gauges'), 'should have gauges container');
            assert.ok(fileContent.includes('od-gauge-ring'), 'should have gauge ring class');
            assert.ok(fileContent.includes('od-gauge-value'), 'should have gauge value class');
        });

        test('uses thin 3px stroke', () => {
            assert.ok(fileContent.includes('stroke-width="3"'), 'should use 3px stroke');
        });

        test('uses weight-300 large number inside gauge', () => {
            const gaugeValueStyle = fileContent.match(/\.od-gauge-value\s*\{[^}]+\}/);
            assert.ok(gaugeValueStyle, 'should have .od-gauge-value styles');
            assert.ok(gaugeValueStyle![0].includes('font-weight: 300'), 'gauge number should be weight-300');
            assert.ok(gaugeValueStyle![0].includes('font-size: 28px'), 'gauge number should be 28px');
        });

        test('gauge labels are uppercase tracked text', () => {
            const gaugeLabelStyle = fileContent.match(/\.od-gauge-label\s*\{[^}]+\}/);
            assert.ok(gaugeLabelStyle, 'should have .od-gauge-label styles');
            assert.ok(gaugeLabelStyle![0].includes('text-transform: uppercase'), 'label should be uppercase');
            assert.ok(gaugeLabelStyle![0].includes('letter-spacing'), 'label should have letter-spacing');
        });

        test('color-codes gauges by utilization', () => {
            assert.ok(fileContent.includes('gaugeColor'), 'should have gaugeColor function');
            assert.ok(fileContent.includes('od-error'), 'should reference error color for high usage');
            assert.ok(fileContent.includes('od-warning'), 'should reference warning color for medium usage');
            assert.ok(fileContent.includes('od-accent'), 'should reference accent for normal usage');
        });
    });

    suite('Stat strip', () => {
        test('renders Default Region, Org ID, CS ID in stat strip', () => {
            assert.ok(fileContent.includes('od-stats'), 'should have stats strip');
            assert.ok(fileContent.includes('od-stat-label'), 'should have stat labels');
            assert.ok(fileContent.includes('od-stat-value'), 'should have stat values');
            assert.ok(fileContent.includes('Default Region'), 'should include Default Region');
            assert.ok(fileContent.includes('Organization ID'), 'should include Organization ID');
            assert.ok(fileContent.includes('CS ID'), 'should include CS ID');
        });
    });

    suite('Resource usage bars', () => {
        test('uses thin 3px bar tracks', () => {
            const barTrackStyle = fileContent.match(/\.od-bar-track\s*\{[^}]+\}/);
            assert.ok(barTrackStyle, 'should have .od-bar-track styles');
            assert.ok(barTrackStyle![0].includes('height: 3px'), 'bar should be 3px');
        });

        test('uses section title for Resource Usage', () => {
            assert.ok(fileContent.includes('od-section-title'), 'should have section title class');
            assert.ok(fileContent.includes('Resource Usage'), 'should have Resource Usage title');
        });

        test('renders all 6 resource types', () => {
            assert.ok(fileContent.includes('Production Workers'), 'includes Production Workers');
            assert.ok(fileContent.includes('Sandbox Workers'), 'includes Sandbox Workers');
            assert.ok(fileContent.includes('Standard Connectors'), 'includes Standard Connectors');
            assert.ok(fileContent.includes('Premium Connectors'), 'includes Premium Connectors');
            assert.ok(fileContent.includes('Static IPs'), 'includes Static IPs');
            assert.ok(fileContent.includes('Deployment Groups'), 'includes Deployment Groups');
        });

        test('color-codes bars by utilization', () => {
            assert.ok(fileContent.includes('barColor'), 'should have barColor function');
        });

        test('shows percentage next to each bar', () => {
            assert.ok(fileContent.includes('od-bar-pct'), 'should have percentage display');
        });
    });

    suite('Organization features (kv-grid)', () => {
        test('uses kv-grid layout', () => {
            assert.ok(fileContent.includes('od-kv-grid'), 'should have kv-grid class');
            assert.ok(fileContent.includes('od-kv'), 'should have kv row class');
        });

        test('uses dot indicators for booleans', () => {
            assert.ok(fileContent.includes('od-dot-on'), 'should have on dot');
            assert.ok(fileContent.includes('od-dot-off'), 'should have off dot');
            assert.ok(fileContent.includes('boolDot'), 'should use boolDot helper');
        });

        test('includes all feature flags', () => {
            assert.ok(fileContent.includes('Application Downloads'), 'includes App Downloads');
            assert.ok(fileContent.includes('Queue Encryption'), 'includes Queue Encryption');
            assert.ok(fileContent.includes('Deployment Groups'), 'includes Deployment Groups');
            assert.ok(fileContent.includes('Custom Log4j'), 'includes Custom Log4j');
            assert.ok(fileContent.includes('Multitenancy'), 'includes Multitenancy');
        });

        test('does not use old status-badge classes', () => {
            assert.ok(!fileContent.includes('status-badge'), 'no old status-badge class');
            assert.ok(!fileContent.includes('status-enabled'), 'no old status-enabled class');
            assert.ok(!fileContent.includes('status-disabled'), 'no old status-disabled class');
        });
    });

    suite('No old UI patterns', () => {
        test('no old card classes', () => {
            assert.ok(!fileContent.includes('stat-card'), 'no old stat-card');
            assert.ok(!fileContent.includes('usage-card'), 'no old usage-card');
            assert.ok(!fileContent.includes('details-card'), 'no old details-card');
        });

        test('no old table markup', () => {
            assert.ok(!fileContent.includes('details-table'), 'no old details-table');
            assert.ok(!fileContent.includes('<table'), 'no table elements');
        });

        test('no old progress bar markup', () => {
            assert.ok(!fileContent.includes('progress-bar'), 'no old progress-bar');
            assert.ok(!fileContent.includes('progress-fill'), 'no old progress-fill');
        });

        test('no hover transforms', () => {
            assert.ok(!fileContent.includes('translateY(-1px)'), 'no hover lift effect');
        });
    });

    suite('Responsive design', () => {
        test('has responsive breakpoint', () => {
            assert.ok(fileContent.includes('@media'), 'should have media query');
            assert.ok(fileContent.includes('max-width: 600px'), 'should have 600px breakpoint');
        });
    });
});
