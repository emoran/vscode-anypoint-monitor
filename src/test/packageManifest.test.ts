import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Package Manifest Test Suite', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const packageJsonPath = path.join(rootDir, 'package.json');
    const vscodeIgnorePath = path.join(rootDir, '.vscodeignore');
    const constantsPath = path.join(rootDir, 'src/constants.ts');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    test('includes activation event for the custom command palette view', () => {
        const activationEvents = packageJson.activationEvents as string[];
        assert.ok(
            activationEvents.includes('onView:anypointCommandPalette'),
            'package.json must activate on the anypointCommandPalette view'
        );
    });

    test('points main to the compiled extension bundle', () => {
        assert.strictEqual(
            packageJson.main,
            './out/extension.js',
            'package.json main must point to the compiled extension bundle'
        );
    });

    test('uses a single VSIX packaging strategy', () => {
        assert.ok(
            !Object.prototype.hasOwnProperty.call(packageJson, 'files'),
            'package.json should not define files when .vscodeignore controls VSIX contents'
        );
    });

    test('does not exclude runtime dependencies from VSIX packaging', () => {
        const vscodeIgnore = fs.readFileSync(vscodeIgnorePath, 'utf8');
        assert.ok(
            !vscodeIgnore.includes('node_modules/**'),
            '.vscodeignore must not blanket-exclude node_modules because runtime dependencies are packaged from there'
        );
    });

    test('does not exclude bundled OAuth credentials from the VSIX', () => {
        const vscodeIgnore = fs.readFileSync(vscodeIgnorePath, 'utf8');
        assert.ok(
            !vscodeIgnore.includes('config/**'),
            '.vscodeignore must not exclude config/** because the published extension relies on bundled OAuth credentials for authentication'
        );
    });

    test('loads local secrets optionally instead of hard-importing them', () => {
        const constantsSource = fs.readFileSync(constantsPath, 'utf8');
        assert.ok(
            !constantsSource.includes("import * as secrets from '../config/secrets.json';"),
            'constants.ts must not hard-import config/secrets.json because the published extension should run without local credential files'
        );
    });

    // ── Icon validation ────────────────────────────────────────────

    test('icon file referenced in package.json exists', () => {
        const iconPath = packageJson.icon;
        assert.ok(iconPath, 'package.json must declare an icon');
        const fullPath = path.join(rootDir, iconPath);
        assert.ok(
            fs.existsSync(fullPath),
            `Icon file "${iconPath}" declared in package.json does not exist at ${fullPath}`
        );
    });

    // ── Categories validation ──────────────────────────────────────

    test('categories are from the VS Code allowed list', () => {
        const allowed = new Set([
            'Azure', 'Data Science', 'Debuggers', 'Education',
            'Extension Packs', 'Formatters', 'Keymaps', 'Language Packs',
            'Linters', 'Machine Learning', 'Notebooks', 'Other',
            'Programming Languages', 'SCM Providers', 'Snippets',
            'Testing', 'Themes', 'Visualization'
        ]);
        const categories: string[] = packageJson.categories || [];
        const invalid = categories.filter(c => !allowed.has(c));
        assert.deepStrictEqual(
            invalid,
            [],
            `Invalid VS Code marketplace categories: ${invalid.join(', ')}`
        );
    });

    // ── Keywords validation ────────────────────────────────────────

    test('keywords do not exceed Marketplace limit of 20', () => {
        const keywords: string[] = packageJson.keywords || [];
        assert.ok(
            keywords.length <= 20,
            `package.json has ${keywords.length} keywords but Marketplace allows a maximum of 20`
        );
    });

    // ── Walkthrough validation ─────────────────────────────────────

    test('every walkthrough step markdown file exists on disk', () => {
        const walkthroughs = packageJson.contributes?.walkthroughs || [];
        const missing: string[] = [];

        for (const wt of walkthroughs) {
            for (const step of wt.steps || []) {
                const mdPath = step.media?.markdown;
                if (mdPath) {
                    const fullPath = path.join(rootDir, mdPath);
                    if (!fs.existsSync(fullPath)) {
                        missing.push(mdPath);
                    }
                }
            }
        }

        assert.deepStrictEqual(
            missing,
            [],
            `Walkthrough markdown files missing from disk:\n  ${missing.join('\n  ')}`
        );
    });

    test('every walkthrough completionEvent command exists in contributes.commands', () => {
        const walkthroughs = packageJson.contributes?.walkthroughs || [];
        const declaredCommands = new Set(
            (packageJson.contributes?.commands || []).map((c: { command: string }) => c.command)
        );
        const missing: string[] = [];

        for (const wt of walkthroughs) {
            for (const step of wt.steps || []) {
                for (const event of step.completionEvents || []) {
                    if (event.startsWith('onCommand:')) {
                        const cmd = event.replace('onCommand:', '');
                        if (!declaredCommands.has(cmd)) {
                            missing.push(`${step.id}: ${cmd}`);
                        }
                    }
                }
            }
        }

        assert.deepStrictEqual(
            missing,
            [],
            `Walkthrough completionEvent commands not in contributes.commands:\n  ${missing.join('\n  ')}`
        );
    });

    // ── Welcome view validation ────────────────────────────────────

    test('every command referenced in viewsWelcome exists in contributes.commands', () => {
        const viewsWelcome = packageJson.contributes?.viewsWelcome || [];
        const declaredCommands = new Set(
            (packageJson.contributes?.commands || []).map((c: { command: string }) => c.command)
        );
        const commandRe = /command:([\w.-]+)/g;
        const missing: string[] = [];

        for (const entry of viewsWelcome) {
            const contents: string = entry.contents || '';
            let match;
            while ((match = commandRe.exec(contents)) !== null) {
                if (!declaredCommands.has(match[1])) {
                    missing.push(match[1]);
                }
            }
        }

        assert.deepStrictEqual(
            missing,
            [],
            `viewsWelcome references commands not in contributes.commands:\n  ${missing.join('\n  ')}`
        );
    });

    // ── No stale root-level keys ───────────────────────────────────

    test('no unexpected root-level keys in package.json', () => {
        const allowed = new Set([
            'name', 'displayName', 'description', 'publisher', 'version',
            'engines', 'license', 'author', 'repository', 'bugs', 'homepage',
            'icon', 'galleryBanner', 'screenshots', 'keywords', 'categories',
            'activationEvents', 'main', 'contributes', 'scripts',
            'devDependencies', 'dependencies', 'overrides',
            'extensionDependencies', 'extensionPack', 'pricing',
            'enabledApiProposals', 'preview', 'badges', 'markdown',
            'qna', 'sponsor', 'capabilities', 'l10n'
        ]);
        const unexpected = Object.keys(packageJson).filter(k => !allowed.has(k));
        assert.deepStrictEqual(
            unexpected,
            [],
            `Unexpected root-level keys in package.json (possible typo or stale config): ${unexpected.join(', ')}`
        );
    });
});
