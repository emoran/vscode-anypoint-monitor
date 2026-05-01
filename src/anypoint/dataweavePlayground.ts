import * as vscode from 'vscode';
import { telemetryService } from '../services/telemetryService';
import { wrapWebviewHtml } from '../webview/ui-kit';

export async function showDataWeavePlayground(context: vscode.ExtensionContext) {
    telemetryService.trackPageView('dataweavePlayground');
    const existingPanel = DataWeavePlaygroundPanel.currentPanel;
    if (existingPanel) {
        existingPanel.reveal();
        return;
    }

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
        this._panel.webview.html = this._getPlaygroundHtml(this._panel.webview);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public reveal() {
        this._panel.reveal(vscode.ViewColumn.One);
    }

    private _getPlaygroundHtml(webview: vscode.Webview): string {
        const logoPath = vscode.Uri.joinPath(this._context.extensionUri, 'logo.png');
        const logoSrc = webview.asWebviewUri(logoPath);

        const body = `
        <div class="dw-page">
            <div class="dw-header-bar">
                <img src="${logoSrc}" alt="Anypoint Monitor" class="dw-logo">
                <span class="dw-title">DataWeave Playground</span>
            </div>
            <div class="dw-iframe-container">
                <div class="dw-loading" id="loading">
                    <div class="dw-spinner"></div>
                    <div class="dw-loading-text">Loading DataWeave Playground...</div>
                </div>
                <iframe
                    id="playground-frame"
                    src="https://dataweave.mulesoft.com/learn/playground"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
                    onload="hideLoading()"
                ></iframe>
            </div>
        </div>`;

        const scripts = `
            function hideLoading() {
                const loading = document.getElementById('loading');
                if (loading) { loading.style.display = 'none'; }
            }
            const iframe = document.getElementById('playground-frame');
            iframe.onerror = function() {
                const loading = document.getElementById('loading');
                loading.innerHTML = '<div style="color:var(--am-error)">Unable to load DataWeave Playground</div><div style="margin-top:10px;font-size:12px;color:var(--am-text-muted)">Please check your internet connection and try again.</div>';
            };
        `;

        return wrapWebviewHtml({
            title: 'DataWeave Playground',
            body,
            scripts,
            extraStyles: `
                body { overflow: hidden; padding: 0; }
                .dw-page { display: flex; flex-direction: column; height: 100vh; }
                .dw-header-bar {
                    flex-shrink: 0; height: 40px; background: var(--am-bg-secondary);
                    border-bottom: 1px solid var(--am-border);
                    display: flex; align-items: center; padding: 0 16px; gap: 10px;
                }
                .dw-logo { width: 20px; height: 20px; }
                .dw-title { font-size: 13px; color: var(--am-text-primary); }
                .dw-iframe-container { flex: 1; position: relative; background: #ffffff; }
                .dw-iframe-container iframe {
                    width: 100%; height: 100%; border: none; display: block;
                    filter: brightness(1.2) contrast(0.85) saturate(0.8); background: #ffffff;
                }
                .dw-loading {
                    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    text-align: center; color: var(--am-text-primary); z-index: 10;
                }
                .dw-spinner {
                    border: 2px solid var(--am-border); border-top-color: var(--am-info);
                    border-radius: 50%; width: 32px; height: 32px;
                    animation: am-spin 0.8s linear infinite; margin: 0 auto 16px;
                }
                .dw-loading-text { font-size: 13px; color: var(--am-text-secondary); }
                @keyframes am-spin { to { transform: rotate(360deg); } }
            `
        });
    }

    public dispose() {
        DataWeavePlaygroundPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) { disposable.dispose(); }
        }
    }
}
