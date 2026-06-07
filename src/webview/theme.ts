/**
 * VSCode theme-aware CSS variable mapping.
 *
 * All webview panels should use these tokens instead of hardcoded hex colors.
 * This ensures the UI adapts to any VSCode theme (Light, Dark, High Contrast, etc.).
 */

export function getThemeStyles(): string {
    return `
        :root {
            /* Backgrounds */
            --am-bg-primary: var(--vscode-editor-background);
            --am-bg-secondary: var(--vscode-sideBar-background, var(--vscode-editor-background));
            --am-bg-surface: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            --am-bg-surface-hover: var(--vscode-list-hoverBackground);
            --am-bg-input: var(--vscode-input-background);
            --am-bg-badge: var(--vscode-badge-background);

            /* Text */
            --am-text-primary: var(--vscode-editor-foreground);
            --am-text-secondary: var(--vscode-descriptionForeground);
            --am-text-muted: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
            --am-text-link: var(--vscode-textLink-foreground);
            --am-text-link-active: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
            --am-text-badge: var(--vscode-badge-foreground);

            /* Borders */
            --am-border: var(--vscode-panel-border, var(--vscode-editorWidget-border, rgba(128,128,128,0.35)));
            --am-border-input: var(--vscode-input-border, var(--am-border));
            --am-border-focus: var(--vscode-focusBorder);

            /* Semantic */
            --am-success: var(--vscode-testing-iconPassed, #3fb950);
            --am-warning: var(--vscode-editorWarning-foreground, #d29922);
            --am-error: var(--vscode-testing-iconFailed, #f85149);
            --am-info: var(--vscode-textLink-foreground, #58a6ff);

            /* Buttons */
            --am-btn-bg: var(--vscode-button-background);
            --am-btn-fg: var(--vscode-button-foreground);
            --am-btn-hover: var(--vscode-button-hoverBackground);
            --am-btn-secondary-bg: var(--vscode-button-secondaryBackground);
            --am-btn-secondary-fg: var(--vscode-button-secondaryForeground);
            --am-btn-secondary-hover: var(--vscode-button-secondaryHoverBackground);

            /* Spacing */
            --am-radius-sm: 4px;
            --am-radius-md: 8px;
            --am-radius-lg: 12px;
            --am-radius-pill: 999px;

            /* Shadows */
            --am-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
            --am-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
            --am-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);
        }
    `;
}

export function getResetStyles(): string {
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            background: var(--am-bg-primary);
            color: var(--am-text-primary);
            line-height: 1.5;
            padding: 24px;
            overflow-x: hidden;
        }

        a {
            color: var(--am-text-link);
            text-decoration: none;
        }

        a:hover {
            color: var(--am-text-link-active);
            text-decoration: underline;
        }
    `;
}

export function getAnimationStyles(): string {
    return `
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

export function getAllBaseStyles(): string {
    return getThemeStyles() + getResetStyles() + getAnimationStyles();
}
