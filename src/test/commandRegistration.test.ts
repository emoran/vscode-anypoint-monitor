import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Command Registration Integrity', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const extensionSource = fs.readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
    const sidebarSource = fs.readFileSync(path.join(rootDir, 'src/anypoint/commandPalettePanel.ts'), 'utf8');

    const declaredCommands: string[] = packageJson.contributes.commands.map(
        (c: { command: string }) => c.command
    );

    const activationEvents: string[] = packageJson.activationEvents || [];

    const INTERNAL_COMMANDS = [
        'anypoint-monitor.statusBarQuickActions',
    ];

    test('no duplicate command IDs in package.json', () => {
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const cmd of declaredCommands) {
            if (seen.has(cmd)) {
                duplicates.push(cmd);
            }
            seen.add(cmd);
        }
        assert.deepStrictEqual(
            duplicates,
            [],
            `Duplicate command IDs in contributes.commands: ${duplicates.join(', ')}`
        );
    });

    test('every declared command has a registerCommand call in extension.ts', () => {
        const missing: string[] = [];
        for (const cmd of declaredCommands) {
            const pattern = `'${cmd}'`;
            if (!extensionSource.includes(pattern) && !sidebarSource.includes(pattern)) {
                missing.push(cmd);
            }
        }
        assert.deepStrictEqual(
            missing,
            [],
            `Commands declared in package.json but not registered in extension.ts or commandPalettePanel.ts:\n  ${missing.join('\n  ')}`
        );
    });

    test('every internal-only command is registered in extension.ts', () => {
        const missing: string[] = [];
        for (const cmd of INTERNAL_COMMANDS) {
            if (!extensionSource.includes(`'${cmd}'`)) {
                missing.push(cmd);
            }
        }
        assert.deepStrictEqual(
            missing,
            [],
            `Internal commands not registered in extension.ts:\n  ${missing.join('\n  ')}`
        );
    });

    test('every onCommand activation event has a matching contributes.commands entry', () => {
        const allKnownCommands = new Set([...declaredCommands, ...INTERNAL_COMMANDS]);
        const orphanEvents: string[] = [];

        for (const event of activationEvents) {
            if (event.startsWith('onCommand:')) {
                const commandId = event.replace('onCommand:', '');
                if (!allKnownCommands.has(commandId)) {
                    orphanEvents.push(event);
                }
            }
        }
        assert.deepStrictEqual(
            orphanEvents,
            [],
            `Activation events referencing non-existent commands:\n  ${orphanEvents.join('\n  ')}`
        );
    });

    test('every command in sidebar tree exists in contributes.commands', () => {
        const allKnownCommands = new Set([...declaredCommands, ...INTERNAL_COMMANDS]);
        const sidebarRe = /command:\s*'(anypoint-monitor\.[^']+)'/g;
        const sidebarCommands: string[] = [];
        let match;
        while ((match = sidebarRe.exec(sidebarSource)) !== null) {
            sidebarCommands.push(match[1]);
        }

        const missing = sidebarCommands.filter(cmd => !allKnownCommands.has(cmd));
        assert.deepStrictEqual(
            missing,
            [],
            `Sidebar tree references commands not declared in package.json:\n  ${missing.join('\n  ')}`
        );
    });

    test('every keybinding references a declared command', () => {
        const keybindings: { command: string }[] = packageJson.contributes.keybindings || [];
        const allKnownCommands = new Set([...declaredCommands, ...INTERNAL_COMMANDS]);
        const missing = keybindings
            .map(kb => kb.command)
            .filter(cmd => !allKnownCommands.has(cmd));
        assert.deepStrictEqual(
            missing,
            [],
            `Keybindings reference non-existent commands:\n  ${missing.join('\n  ')}`
        );
    });

    test('every menu command references a declared command', () => {
        const menus = packageJson.contributes.menus || {};
        const allKnownCommands = new Set([...declaredCommands, ...INTERNAL_COMMANDS]);
        const missing: string[] = [];

        for (const [, items] of Object.entries(menus)) {
            for (const item of items as { command: string }[]) {
                if (item.command && !allKnownCommands.has(item.command)) {
                    missing.push(item.command);
                }
            }
        }
        assert.deepStrictEqual(
            missing,
            [],
            `Menu entries reference non-existent commands:\n  ${missing.join('\n  ')}`
        );
    });
});
