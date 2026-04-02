import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Package Manifest Test Suite', () => {
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    const vscodeIgnorePath = path.resolve(__dirname, '../../.vscodeignore');
    const constantsPath = path.resolve(__dirname, '../constants.ts');
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

    test('excludes local credential files from the VSIX', () => {
        const vscodeIgnore = fs.readFileSync(vscodeIgnorePath, 'utf8');

        assert.ok(
            vscodeIgnore.includes('config/**'),
            '.vscodeignore must exclude config/** so local credentials are not packaged'
        );
    });

    test('loads local secrets optionally instead of hard-importing them', () => {
        const constantsSource = fs.readFileSync(constantsPath, 'utf8');

        assert.ok(
            !constantsSource.includes("import * as secrets from '../config/secrets.json';"),
            'constants.ts must not hard-import config/secrets.json because the published extension should run without local credential files'
        );
    });
});
