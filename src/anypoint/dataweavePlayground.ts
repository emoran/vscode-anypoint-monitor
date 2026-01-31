import * as vscode from 'vscode';
import { telemetryService } from '../services/telemetryService';

/**
 * Show DataWeave Playground in a webview panel
 * Embeds MuleSoft's official DataWeave Playground
 */
export async function showDataWeavePlayground(context: vscode.ExtensionContext) {
    telemetryService.trackPageView('dataweavePlayground');
    // Check if there's already an active panel
    const existingPanel = DataWeavePlaygroundPanel.currentPanel;
    if (existingPanel) {
        existingPanel.reveal();
        return;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
        'dataweavePlayground',
        'DataWeave Playground',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri]
        }
    );

    DataWeavePlaygroundPanel.currentPanel = new DataWeavePlaygroundPanel(panel, context);
}

class DataWeavePlaygroundPanel {
    public static currentPanel: DataWeavePlaygroundPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._context = context;

        // Set HTML content
        this._panel.webview.html = this._getPlaygroundHtml(this._panel.webview);

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public reveal() {
        this._panel.reveal(vscode.ViewColumn.One);
    }

    private _getPlaygroundHtml(webview: vscode.Webview): string {
        const logoPath = vscode.Uri.joinPath(this._context.extensionUri, 'logo.png');
        const logoSrc = webview.asWebviewUri(logoPath);

        return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DataWeave Playground</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
        }

        .header img {
            width: 20px;
            height: 20px;
        }

        .header h1 {
            font-size: 13px;
            font-weight: 400;
            color: var(--vscode-foreground);
        }

        .iframe-container {
            flex: 1;
            width: 100%;
            height: 100%;
            position: relative;
            background-color: #ffffff;
        }

        iframe {
            width: 100%;
            height: 100%;
            border: none;
            display: block;
            filter: brightness(1.2) contrast(0.85) saturate(0.8);
            background-color: #ffffff;
        }



        .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: var(--vscode-foreground);
            z-index: 10;
        }

        .loading-spinner {
            border: 2px solid var(--vscode-input-border);
            border-top: 2px solid var(--vscode-button-background);
            border-radius: 50%;
            width: 32px;
            height: 32px;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .loading-text {
            font-size: 13px;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="header">
        <img src="${logoSrc}" alt="Anypoint Monitor">
        <h1>DataWeave Playground</h1>
    </div>
    <div class="iframe-container">
        <div class="loading" id="loading">
            <div class="loading-spinner"></div>
            <div class="loading-text">Loading DataWeave Playground...</div>
        </div>
        <iframe
            id="playground-frame"
            src="https://dataweave.mulesoft.com/learn/playground"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
            onload="hideLoading()"
        ></iframe>
    </div>

    <script>
        function hideLoading() {
            const loading = document.getElementById('loading');
            if (loading) {
                loading.style.display = 'none';
            }
        }


        // Handle iframe load error
        const iframe = document.getElementById('playground-frame');
        iframe.onerror = function() {
            const loading = document.getElementById('loading');
            loading.innerHTML = '<div style="color: var(--vscode-errorForeground);">⚠️ Unable to load DataWeave Playground</div><div style="margin-top: 10px; font-size: 12px; opacity: 0.8;">Please check your internet connection and try again.</div>';
        };
    </script>
</body>
</html>
        `;
    }

    public dispose() {
        DataWeavePlaygroundPanel.currentPanel = undefined;

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
