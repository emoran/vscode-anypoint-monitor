# DataWeave Playground Feature

## Overview

The DataWeave Playground integration provides an interactive environment for learning and testing DataWeave transformations directly within VSCode. This feature offers two modes of operation to suit different use cases and connectivity scenarios.

## Features

### Phase 1: Interactive Mode (iframe-based) ✅ COMPLETED

The Interactive Mode embeds MuleSoft's official DataWeave Playground directly into VSCode, providing:

- **Full DataWeave Learning Environment**: Access to all features of https://dataweave.mulesoft.com/learn/playground
- **Real-time Transformation**: Execute DataWeave scripts instantly
- **Official Examples**: Browse and load MuleSoft's curated DataWeave examples
- **Interactive Tutorials**: Step-by-step learning guides
- **Always Up-to-date**: Automatically reflects latest DataWeave features from MuleSoft

**Requirements**: Internet connection

**How to Use**:
1. Open Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
2. Type "AM: DataWeave Playground"
3. Select the command to open the playground
4. The embedded playground will load with full functionality

### Phase 2: Custom Editor Mode ✅ COMPLETED

The Custom Editor Mode provides a standalone three-panel editor interface:

**Layout**:
- **Left Panel - Input**: Enter your input data (JSON, XML, CSV, YAML)
- **Center Panel - DataWeave Script**: Write your transformation logic
- **Right Panel - Output**: View the transformation results

**Features**:
- 🎨 Clean, dark-themed interface matching VSCode aesthetics
- 📚 Pre-loaded example scripts (6+ examples included):
  - Hello World
  - JSON to JSON Transform
  - JSON to XML
  - CSV to JSON
  - Array Mapping
  - Filter Array
- 💾 Export scripts to .dwl files
- 📁 Import existing DataWeave scripts
- 🔄 Toggle between Interactive and Custom modes
- 🎯 Format selection for input data (JSON, XML, CSV, YAML)

**Included Examples**:

1. **Hello World**: Basic transformation
   ```dataweave
   %dw 2.0
   output application/json
   ---
   {
     greeting: payload.message
   }
   ```

2. **JSON to JSON Transform**: Field mapping and concatenation
   ```dataweave
   %dw 2.0
   output application/json
   ---
   {
     fullName: payload.firstName ++ " " ++ payload.lastName,
     isAdult: payload.age >= 18
   }
   ```

3. **JSON to XML**: Format conversion
4. **CSV to JSON**: Parse CSV and map to JSON array
5. **Array Mapping**: Transform array elements
6. **Filter Array**: Filter based on conditions

**Status**: ✅ **FULLY FUNCTIONAL**
- Complete DataWeave execution powered by MuleSoft API
- Real-time transformation with error handling
- Execution time metrics displayed
- Full validation and error messages

## Usage Instructions

### Opening the Playground

**Via Command Palette**:
```
Cmd+Shift+P (Mac) / Ctrl+Shift+P (Windows/Linux)
→ Type "DataWeave Playground"
→ Select "AM: DataWeave Playground"
```

**Direct Command**:
```
anypoint-monitor.dataweavePlayground
```

### Switching Between Modes

Both modes include a toggle button in the header:
- **In Interactive Mode**: Click "🎨 Switch to Custom Editor"
- **In Custom Editor Mode**: Click "🌐 Switch to Interactive Mode"

### Working with Scripts in Custom Mode

1. **Load an Example**:
   - Use the "📚 Load Example..." dropdown in the toolbar
   - Select from pre-configured examples
   - Input, script, and format will auto-populate

2. **Create Your Own**:
   - Enter input data in the left panel
   - Write DataWeave script in the center panel
   - Select input format from toolbar dropdown
   - Click "▶️ Run Transformation" to execute
   - View results in the output panel with execution time

3. **Export Script**:
   - Click "💾 Export" button
   - Choose save location
   - Script saves as .dwl file

4. **Import Script**:
   - Click "📁 Import" button
   - Select .dwl file
   - Script loads into editor

5. **Clear All**:
   - Click "🗑️ Clear All" to reset all panels

## Architecture

### File Structure
```
src/anypoint/dataweavePlayground.ts        - Main implementation
├── DataWeavePlaygroundPanel class         - Panel management
├── showDataWeavePlayground()              - Entry point
├── _getIframeHtml()                       - Interactive mode HTML
├── _getCustomEditorHtml()                 - Custom editor HTML
└── _executeDataWeave()                    - Transformation execution

src/controllers/dataweaveService.ts        - DataWeave execution engine
├── executeDataWeaveTransformation()       - API-based execution
├── validateDataWeaveScript()              - Script validation
├── extractOutputMimeType()                - Parse output format
├── parseInput()                           - Input data parsing
└── formatOutput()                         - Output formatting
```

### Key Components

**DataWeavePlaygroundPanel**:
- Singleton pattern to prevent multiple instances
- Manages webview lifecycle
- Handles mode switching
- Processes user interactions (export, import, load examples)

**Message Handling**:
- `toggleMode`: Switch between iframe and custom editor
- `executeDataWeave`: Execute transformation (Phase 2)
- `loadExample`: Load pre-configured examples
- `exportScript`: Save script to .dwl file
- `importScript`: Load script from .dwl file

## Future Enhancements (Phase 2+)

### Planned Features:

1. **DataWeave Execution Engine** (Phase 2 Priority):
   - [ ] Integrate DataWeave execution API
   - [ ] Offline execution capability
   - [ ] Error highlighting and debugging
   - [ ] Performance metrics

2. **Enhanced Editor Features**:
   - [ ] Monaco editor integration with DataWeave syntax highlighting
   - [ ] Auto-completion for DataWeave functions
   - [ ] Inline error highlighting
   - [ ] Code formatting

3. **Workspace Integration**:
   - [ ] Save scripts to workspace
   - [ ] Load scripts from project files
   - [ ] Script templates library
   - [ ] Recent scripts history

4. **Anypoint Platform Integration**:
   - [ ] Load examples from Anypoint Exchange
   - [ ] Share scripts to Exchange
   - [ ] Deploy DataWeave modules to CloudHub
   - [ ] Test against live API data

5. **Collaboration Features**:
   - [ ] Share script snippets
   - [ ] Community examples repository
   - [ ] Script versioning

## Technical Notes

### DataWeave Execution Options

For Phase 2 implementation, we have several execution strategies:

1. **Anypoint Platform API** (Recommended):
   - Use authenticated API calls to execute DataWeave
   - Pros: Official, reliable, always up-to-date
   - Cons: Requires authentication and internet

2. **DataWeave CLI**:
   - Shell out to local DataWeave CLI if installed
   - Pros: Offline capability
   - Cons: Requires user to install CLI

3. **JavaScript Library**:
   - Bundle DataWeave JS runtime (if available)
   - Pros: Fully offline, fast
   - Cons: Library availability, bundle size

4. **Hybrid Approach**:
   - Try local execution first, fallback to API
   - Best user experience

### Security Considerations

- iframe sandbox attributes restrict potentially harmful operations
- No direct file system access from webview
- All file operations go through VSCode API
- User confirmation required for file save/load operations

## Testing

To test the feature:

1. **Compile the extension**:
   ```bash
   npm run compile
   ```

2. **Launch Extension Development Host**:
   - Press F5 in VSCode
   - Or: Run > Start Debugging

3. **Test Interactive Mode**:
   - Run command "AM: DataWeave Playground"
   - Verify iframe loads successfully
   - Test toggle to custom mode

4. **Test Custom Editor**:
   - Load each example script
   - Test export functionality
   - Test import functionality
   - Test clear all functionality
   - Verify all UI elements render correctly

## Troubleshooting

### Interactive Mode Issues

**Problem**: Playground doesn't load
- **Solution**: Check internet connection
- **Alternative**: Switch to Custom Editor mode

**Problem**: iframe shows blank page
- **Solution**: Check browser security settings, CSP headers
- **Workaround**: Use Custom Editor mode

### Custom Editor Issues

**Problem**: Export doesn't work
- **Solution**: Check file permissions in save location
- **Try**: Save to different directory

**Problem**: Import doesn't load script
- **Solution**: Ensure file is valid .dwl format
- **Check**: File encoding (should be UTF-8)

## Support

For issues, feature requests, or questions:
- GitHub Issues: https://github.com/emoran/vscode-anypoint-monitor/issues
- Use command "AM: Provide Feedback"

## Version History

- **v0.0.31** (Current):
  - ✅ Phase 1: Interactive Mode (iframe-based playground)
  - ✅ Phase 2: Custom Editor UI with examples
  - ✅ Phase 2: DataWeave execution (COMPLETED)
    - Full API-based transformation execution
    - Script validation and error handling
    - Real-time execution with progress indicators
    - Execution time metrics

## Contributing

To contribute to DataWeave Playground enhancements:

1. Fork the repository
2. Create feature branch
3. Implement changes in `src/anypoint/dataweavePlayground.ts`
4. Test thoroughly
5. Submit pull request

Focus areas for contribution:
- DataWeave execution engine integration
- Additional example scripts
- Monaco editor DataWeave language support
- UI/UX improvements

---

**Built with ❤️ for the MuleSoft Community**
