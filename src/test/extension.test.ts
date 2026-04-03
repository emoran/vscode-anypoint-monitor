import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Activation', () => {

    test('extension is present in the extensions list', () => {
        const ext = vscode.extensions.getExtension('EdgarMoran.anypoint-monitor');
        assert.ok(ext, 'Extension EdgarMoran.anypoint-monitor should be installed');
    });

    test('extension activates successfully', async () => {
        const ext = vscode.extensions.getExtension('EdgarMoran.anypoint-monitor');
        assert.ok(ext, 'Extension must be present');

        if (!ext.isActive) {
            await ext.activate();
        }
        assert.ok(ext.isActive, 'Extension should be active after activation');
    });

    test('all contributed commands are registered after activation', async () => {
        const ext = vscode.extensions.getExtension('EdgarMoran.anypoint-monitor');
        assert.ok(ext);
        if (!ext.isActive) {
            await ext.activate();
        }

        const allCommands = await vscode.commands.getCommands(true);
        const pkgCommands: string[] = ext.packageJSON.contributes.commands.map(
            (c: { command: string }) => c.command
        );

        const missing = pkgCommands.filter(
            (cmd: string) => !allCommands.includes(cmd)
        );
        assert.deepStrictEqual(
            missing,
            [],
            `Commands declared in package.json but not registered at runtime:\n  ${missing.join('\n  ')}`
        );
    });

    test('sidebar view container is contributed', () => {
        const ext = vscode.extensions.getExtension('EdgarMoran.anypoint-monitor');
        assert.ok(ext);

        const viewContainers = ext.packageJSON.contributes.viewsContainers?.activitybar || [];
        const hasContainer = viewContainers.some(
            (vc: { id: string }) => vc.id === 'anypoint-monitor'
        );
        assert.ok(hasContainer, 'Extension must contribute an "anypoint-monitor" activity bar container');
    });

    test('command palette view is contributed', () => {
        const ext = vscode.extensions.getExtension('EdgarMoran.anypoint-monitor');
        assert.ok(ext);

        const views = ext.packageJSON.contributes.views?.['anypoint-monitor'] || [];
        const hasView = views.some(
            (v: { id: string }) => v.id === 'anypointCommandPalette'
        );
        assert.ok(hasView, 'Extension must contribute the "anypointCommandPalette" view');
    });
});
