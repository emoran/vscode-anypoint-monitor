# Repository Guidelines

## Project Structure & Module Organization
Core extension entry lives in `src/extension.ts` linking VS Code commands to feature controllers. Feature-specific logic stays in `src/anypoint`, while platform integration helpers live in `src/controllers`. Shared utilities belong in `src/utils`. UI strings, quick-pick payloads, and sample assets sit under `src/resources`. Tests reside in `src/test`, and TypeScript transpilation outputs to `out/` (generated, never hand-edit). Local OAuth credentials and webhooks should be configured in `config/secrets.json` and kept out of commits.

## Build, Test, and Development Commands
Run `npm install` once per environment. Use `npm run compile` to build the TypeScript sources and `npm run watch` for incremental builds during development. `npm run lint` runs ESLint with the repository rules; fix warnings before submitting. Execute `npm test` to launch the VS Code integration harness (the `pretest` hook compiles and lints automatically). `npm run vscode:prepublish` produces the bundle the VS Code Marketplace expects.

## Coding Style & Naming Conventions
Target TypeScript ES2022 modules with 4-space indentation and single quotes. Keep imports camelCase or PascalCase to satisfy the `@typescript-eslint/naming-convention` rule. Prefer descriptive async function names (e.g., `getCH2Applications`) and align new command IDs with the `anypoint-monitor.*` namespace. Always terminate statements with semicolons and use strict equality. Run `npm run lint` until the tree is clean before raising a PR.

## Testing Guidelines
Place new suites under `src/test` using the `*.test.ts` suffix. Reuse the `@vscode/test-electron` harness to exercise new commands; structure tests around activation events and command invocation. When adding features with network calls, stub external requests so tests can run offline. Ensure `npm test` passes locally and document any intentional skips in the PR description.

## Commit & Pull Request Guidelines
Adopt short, imperative commit subjects similar to recent history (e.g., "add comparison table"). Squash small fixups before pushing. Every PR should include: 1) a concise summary of behavior change, 2) steps for validation (`npm test`, screenshots for UI changes), and 3) linked issues or context for release notes. Highlight any required updates to `config/secrets.json` or deployment credentials.
