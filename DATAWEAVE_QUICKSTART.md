# DataWeave Playground - Quick Start Guide

## 🚀 Getting Started in 30 Seconds

1. **Open Command Palette**: `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. **Type**: `AM: DataWeave Playground`
3. **Press Enter**: Playground opens in Interactive Mode

## 🎯 Two Modes Available

### Interactive Mode (Default)
- Full MuleSoft DataWeave Playground embedded
- All official tutorials and examples
- Best for learning and exploring

### Custom Editor Mode
- Three-panel editor (Input | Script | Output)
- Offline editing with online execution
- Best for quick transformations

**Switch modes**: Click the toggle button in the header

## ⚡ Quick Example - Custom Mode

1. Click "🎨 Switch to Custom Editor"
2. Load example: Select "Hello World" from dropdown
3. Click "▶️ Run Transformation"
4. See result in output panel!

## 📝 Create Your First Transformation

**Input Panel** (Left):
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "age": 30
}
```

**Script Panel** (Center):
```dataweave
%dw 2.0
output application/json
---
{
  fullName: payload.firstName ++ " " ++ payload.lastName,
  isAdult: payload.age >= 18
}
```

**Click**: ▶️ Run Transformation

**Output Panel** (Right):
```json
{
  "fullName": "John Doe",
  "isAdult": true
}
```

## 🎨 Pre-loaded Examples

1. **Hello World** - Basic transformation
2. **JSON to JSON** - Field mapping
3. **JSON to XML** - Format conversion
4. **CSV to JSON** - Parse CSV data
5. **Array Map** - Transform arrays
6. **Array Filter** - Filter data

## 💡 Pro Tips

### Custom Mode Features
- ✅ Real-time execution via MuleSoft API
- ✅ Execution time displayed
- ✅ Full error messages with line numbers
- ✅ Export scripts to .dwl files
- ✅ Import existing scripts
- ✅ Input format selection (JSON, XML, CSV, YAML)

### Common DataWeave Patterns

**Concatenate Strings**:
```dataweave
payload.firstName ++ " " ++ payload.lastName
```

**Map Array**:
```dataweave
payload map {
  name: $.name,
  email: $.email
}
```

**Filter Array**:
```dataweave
payload filter ($.age > 18)
```

**Conditional Logic**:
```dataweave
{
  status: if (payload.age >= 18) "adult" else "minor"
}
```

**Date Formatting**:
```dataweave
now() as String {format: "yyyy-MM-dd"}
```

## 🔧 Supported Input Formats

- **JSON**: `application/json` (default)
- **XML**: `application/xml`
- **CSV**: `text/csv`
- **YAML**: `application/yaml`

Change format using the dropdown: "Input Format:" in toolbar

## 📤 Export & Import

**Export Script**:
1. Click "💾 Export"
2. Choose location
3. Saves as `.dwl` file

**Import Script**:
1. Click "📁 Import"
2. Select `.dwl` file
3. Script loads into editor

## ⚠️ Troubleshooting

### Script Validation Errors

**Error**: "Script must include DataWeave version declaration"
**Fix**: Add `%dw 2.0` at the top

**Error**: "Script must include output declaration"
**Fix**: Add `output application/json` (or other format)

**Error**: "Script must include separator"
**Fix**: Add `---` between header and body

### Execution Errors

**Network Error**: Check internet connection (required for execution)

**Parse Error**: Verify input data matches selected format

**Transformation Error**: Check script syntax and logic

## 📚 Learning Resources

**In Interactive Mode**:
- Click "Tutorial" button for step-by-step guide
- Browse example library
- Access full DataWeave documentation

**Online**:
- [DataWeave Docs](https://docs.mulesoft.com/dataweave/)
- [DataWeave Playground](https://dataweave.mulesoft.com/)
- [DataWeave Tutorial](https://developer.mulesoft.com/tutorials-and-howtos/dataweave/)

## 🎓 Next Steps

1. **Try all examples**: Load each one and run it
2. **Modify examples**: Change input data and see results
3. **Create your own**: Start with simple transformations
4. **Export favorites**: Save useful scripts for later
5. **Explore Interactive Mode**: Access full tutorials

## 🔑 Keyboard Shortcuts

- `Cmd/Ctrl+Shift+P` → Command Palette
- `▶️ Run Transformation` → Execute script
- `🗑️ Clear All` → Reset editor

## ✨ Features Summary

| Feature | Interactive Mode | Custom Mode |
|---------|-----------------|-------------|
| MuleSoft Playground | ✅ Full | ❌ No |
| Offline Editing | ❌ No | ✅ Yes |
| Script Execution | ✅ Yes | ✅ Yes |
| Tutorials | ✅ Yes | ❌ No |
| Examples | ✅ Many | ✅ 6 Basic |
| Export/Import | ⚠️ Limited | ✅ Full |
| Execution Time | ❌ No | ✅ Yes |
| Error Details | ✅ Yes | ✅ Yes |

## 🎉 You're Ready!

Open the playground and start transforming data with DataWeave!

**Command**: `AM: DataWeave Playground`

---

**Need Help?** Use `AM: Provide Feedback` or visit [GitHub Issues](https://github.com/emoran/vscode-anypoint-monitor/issues)
