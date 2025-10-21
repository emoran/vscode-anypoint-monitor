import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface PlaygroundState {
    script: string;
    input: string;
    output: string;
}

export async function showDataWeavePlayground(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'dataweavePlayground',
        'DataWeave Playground',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'monaco-editor')
            ]
        }
    );

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'executeTransform':
                    await handleExecuteTransform(panel, message.script, message.input);
                    break;
                case 'exportPlayground':
                    await exportPlayground(message.state);
                    break;
                case 'importPlayground':
                    await importPlayground(panel);
                    break;
                case 'loadExample':
                    loadExample(panel, message.exampleId);
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    panel.webview.html = getPlaygroundHtml(panel.webview, context.extensionUri);
}

/**
 * Handle DataWeave transformation execution
 * Note: This is a mock implementation. For real execution, you would need:
 * 1. DataWeave CLI integration
 * 2. API call to a DataWeave execution service
 * 3. Or embedded DataWeave runtime
 */
async function handleExecuteTransform(
    panel: vscode.WebviewPanel,
    script: string,
    input: string
): Promise<void> {
    try {
        // Mock execution - in a real implementation, you would:
        // 1. Use DataWeave CLI: exec(`dw run --script "${script}" --input "${input}"`)
        // 2. Call Anypoint Platform API if available
        // 3. Use a DataWeave runtime library

        // For now, show a helpful message
        const mockOutput = {
            status: 'info',
            message: `DataWeave execution requires runtime integration.

To execute DataWeave transformations, you can:

1. Install DataWeave CLI from MuleSoft
2. Use the official DataWeave VSCode extension
3. Copy your script to https://dataweave.mulesoft.com/learn/playground

Your script:
${script}

Your input:
${input}`,
            suggestion: 'Open in official playground?'
        };

        panel.webview.postMessage({
            command: 'executionResult',
            output: JSON.stringify(mockOutput, null, 2),
            error: false
        });

        // Show option to open in official playground
        const openOnline = await vscode.window.showInformationMessage(
            'This is a preview playground. For full DataWeave execution, use the online playground.',
            'Open Online Playground',
            'Cancel'
        );

        if (openOnline === 'Open Online Playground') {
            vscode.env.openExternal(vscode.Uri.parse('https://dataweave.mulesoft.com/learn/playground'));
        }
    } catch (error: any) {
        panel.webview.postMessage({
            command: 'executionResult',
            output: `Error: ${error.message}`,
            error: true
        });
    }
}

/**
 * Export playground state to a .zip file (similar to official playground)
 */
async function exportPlayground(state: PlaygroundState): Promise<void> {
    const JSZip = require('jszip');
    const zip = new JSZip();

    // Add files to zip
    zip.file('transform.dwl', state.script);
    zip.file('input.json', state.input);
    zip.file('output.json', state.output);
    zip.file('README.md', `# DataWeave Playground Export

This export contains:
- transform.dwl: Your DataWeave transformation script
- input.json: Sample input data
- output.json: Transformation output

You can import this back into the playground or use it in your Mule projects.
`);

    // Generate zip file
    const content = await zip.generateAsync({ type: 'nodebuffer' });

    // Save to file
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('dataweave-playground-export.zip'),
        filters: {
            'Zip Files': ['zip']
        }
    });

    if (uri) {
        fs.writeFileSync(uri.fsPath, content);
        vscode.window.showInformationMessage('Playground exported successfully!');
    }
}

/**
 * Import playground state from a .zip file
 */
async function importPlayground(panel: vscode.WebviewPanel): Promise<void> {
    const uri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'Zip Files': ['zip']
        }
    });

    if (uri && uri[0]) {
        try {
            const JSZip = require('jszip');
            const zipData = fs.readFileSync(uri[0].fsPath);
            const zip = await JSZip.loadAsync(zipData);

            const script = await zip.file('transform.dwl')?.async('string') || '';
            const input = await zip.file('input.json')?.async('string') || '';

            panel.webview.postMessage({
                command: 'loadState',
                state: {
                    script,
                    input,
                    output: ''
                }
            });

            vscode.window.showInformationMessage('Playground imported successfully!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to import: ${error.message}`);
        }
    }
}

/**
 * Load example DataWeave transformations
 */
function loadExample(panel: vscode.WebviewPanel, exampleId: string): void {
    const examples: { [key: string]: PlaygroundState } = {
        'hello-world': {
            script: `%dw 2.0
output application/json
---
{
    message: "Hello, DataWeave!",
    timestamp: now(),
    input: payload
}`,
            input: `{
    "name": "World"
}`,
            output: ''
        },
        'array-map': {
            script: `%dw 2.0
output application/json
---
payload.users map (user) -> {
    fullName: user.firstName ++ " " ++ user.lastName,
    email: user.email
}`,
            input: `{
    "users": [
        {
            "firstName": "John",
            "lastName": "Doe",
            "email": "john.doe@example.com"
        },
        {
            "firstName": "Jane",
            "lastName": "Smith",
            "email": "jane.smith@example.com"
        }
    ]
}`,
            output: ''
        },
        'xml-to-json': {
            script: `%dw 2.0
output application/json
---
{
    customers: payload.root.*customer map {
        id: $.@id,
        name: $.name,
        email: $.email
    }
}`,
            input: `<?xml version="1.0" encoding="UTF-8"?>
<root>
    <customer id="1">
        <name>John Doe</name>
        <email>john@example.com</email>
    </customer>
    <customer id="2">
        <name>Jane Smith</name>
        <email>jane@example.com</email>
    </customer>
</root>`,
            output: ''
        },
        'filter-sort': {
            script: `%dw 2.0
output application/json
---
{
    activeUsers: payload.users
        filter ($.status == "active")
        orderBy ($.lastName)
        map {
            name: $.firstName ++ " " ++ $.lastName,
            status: $.status
        }
}`,
            input: `{
    "users": [
        { "firstName": "Charlie", "lastName": "Brown", "status": "active" },
        { "firstName": "Alice", "lastName": "Smith", "status": "inactive" },
        { "firstName": "Bob", "lastName": "Anderson", "status": "active" }
    ]
}`,
            output: ''
        }
    };

    const example = examples[exampleId];
    if (example) {
        panel.webview.postMessage({
            command: 'loadState',
            state: example
        });
    }
}

/**
 * Generate the HTML for the playground webview
 */
function getPlaygroundHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    // Get URIs for Monaco Editor resources
    const monacoBase = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'monaco-editor', 'min')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; font-src ${webview.cspSource};">
    <title>DataWeave Playground</title>
    <link rel="stylesheet" href="${monacoBase}/vs/editor/editor.main.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 15px;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .toolbar h1 {
            font-size: 16px;
            font-weight: 600;
            margin-right: auto;
        }

        .toolbar button, .toolbar select {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }

        .toolbar button:hover, .toolbar select:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .toolbar select {
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
        }

        .playground-container {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 1px;
            background: var(--vscode-panel-border);
            flex: 1;
            overflow: hidden;
        }

        .editor-panel {
            display: flex;
            flex-direction: column;
            background: var(--vscode-editor-background);
            overflow: hidden;
        }

        .panel-header {
            padding: 8px 12px;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .panel-header-title {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .editor-container {
            flex: 1;
            overflow: hidden;
        }

        .status-bar {
            padding: 4px 12px;
            background: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .status-indicator {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--vscode-testing-iconPassed);
        }

        .status-dot.error {
            background: var(--vscode-testing-iconFailed);
        }

        .btn-run {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-weight: 600;
        }

        .btn-run:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .icon {
            width: 16px;
            height: 16px;
            display: inline-block;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <h1>🎯 DataWeave Playground</h1>

        <select id="exampleSelector">
            <option value="">Load Example...</option>
            <option value="hello-world">Hello World</option>
            <option value="array-map">Array Mapping</option>
            <option value="xml-to-json">XML to JSON</option>
            <option value="filter-sort">Filter & Sort</option>
        </select>

        <button id="runBtn" class="btn-run">▶ Run Transform</button>
        <button id="clearBtn">Clear All</button>
        <button id="exportBtn">Export</button>
        <button id="importBtn">Import</button>
    </div>

    <div class="playground-container">
        <div class="editor-panel">
            <div class="panel-header">
                <div class="panel-header-title">
                    <span>📝 DataWeave Script</span>
                </div>
            </div>
            <div class="editor-container" id="script-editor"></div>
        </div>

        <div class="editor-panel">
            <div class="panel-header">
                <div class="panel-header-title">
                    <span>📥 Input Data</span>
                </div>
            </div>
            <div class="editor-container" id="input-editor"></div>
        </div>

        <div class="editor-panel">
            <div class="panel-header">
                <div class="panel-header-title">
                    <span>📤 Output</span>
                </div>
            </div>
            <div class="editor-container" id="output-editor"></div>
        </div>
    </div>

    <div class="status-bar">
        <div class="status-indicator">
            <span class="status-dot" id="statusDot"></span>
            <span id="statusText">Ready</span>
        </div>
        <div id="infoText">DataWeave 2.0 | VSCode Anypoint Monitor</div>
    </div>

    <script src="${monacoBase}/vs/loader.js"></script>
    <script>
        const vscode = acquireVsCodeApi();

        require.config({ paths: { vs: '${monacoBase}/vs' } });

        require(['vs/editor/editor.main'], function () {
            // Configure Monaco for dark theme
            const theme = document.body.className.includes('vscode-light') ? 'vs' : 'vs-dark';

            // Create Script Editor (DataWeave)
            const scriptEditor = monaco.editor.create(document.getElementById('script-editor'), {
                value: \`%dw 2.0
output application/json
---
{
    message: "Hello, DataWeave!",
    timestamp: now(),
    data: payload
}\`,
                language: 'javascript', // Fallback - ideally we'd register DataWeave language
                theme: theme,
                minimap: { enabled: false },
                automaticLayout: true,
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                tabSize: 2
            });

            // Create Input Editor (JSON)
            const inputEditor = monaco.editor.create(document.getElementById('input-editor'), {
                value: \`{
    "name": "World",
    "version": "2.0"
}\`,
                language: 'json',
                theme: theme,
                minimap: { enabled: false },
                automaticLayout: true,
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                tabSize: 2
            });

            // Create Output Editor (JSON, read-only)
            const outputEditor = monaco.editor.create(document.getElementById('output-editor'), {
                value: '// Click "Run Transform" to see output here',
                language: 'json',
                theme: theme,
                minimap: { enabled: false },
                automaticLayout: true,
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                readOnly: true,
                wordWrap: 'on',
                tabSize: 2
            });

            // Status update function
            function updateStatus(text, isError = false) {
                document.getElementById('statusText').textContent = text;
                const dot = document.getElementById('statusDot');
                if (isError) {
                    dot.classList.add('error');
                } else {
                    dot.classList.remove('error');
                }
            }

            // Run Transform button
            document.getElementById('runBtn').addEventListener('click', () => {
                updateStatus('Executing transformation...');
                vscode.postMessage({
                    command: 'executeTransform',
                    script: scriptEditor.getValue(),
                    input: inputEditor.getValue()
                });
            });

            // Clear All button
            document.getElementById('clearBtn').addEventListener('click', () => {
                scriptEditor.setValue('%dw 2.0\\noutput application/json\\n---\\n');
                inputEditor.setValue('{}');
                outputEditor.setValue('');
                updateStatus('Cleared');
            });

            // Export button
            document.getElementById('exportBtn').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'exportPlayground',
                    state: {
                        script: scriptEditor.getValue(),
                        input: inputEditor.getValue(),
                        output: outputEditor.getValue()
                    }
                });
            });

            // Import button
            document.getElementById('importBtn').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'importPlayground'
                });
            });

            // Example selector
            document.getElementById('exampleSelector').addEventListener('change', (e) => {
                const exampleId = e.target.value;
                if (exampleId) {
                    vscode.postMessage({
                        command: 'loadExample',
                        exampleId: exampleId
                    });
                    e.target.value = ''; // Reset selector
                }
            });

            // Handle messages from extension
            window.addEventListener('message', event => {
                const message = event.data;

                switch (message.command) {
                    case 'executionResult':
                        outputEditor.setValue(message.output);
                        if (message.error) {
                            updateStatus('Execution failed', true);
                        } else {
                            updateStatus('Execution completed');
                        }
                        break;

                    case 'loadState':
                        scriptEditor.setValue(message.state.script);
                        inputEditor.setValue(message.state.input);
                        outputEditor.setValue(message.state.output || '');
                        updateStatus('Loaded');
                        break;
                }
            });

            updateStatus('Ready');
        });
    </script>
</body>
</html>`;
}
