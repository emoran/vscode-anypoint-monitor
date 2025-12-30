# Anypoint Monitor Extension - Test Suite

This directory contains the automated test suite for the Anypoint Monitor VSCode extension, with comprehensive coverage of the Business Group functionality and all core features.

## Test Structure

```
src/test/
├── suite/                              # Test suites
│   ├── extension.test.ts               # Basic extension tests
│   ├── applicationDiagram.test.ts      # Mule diagram utilities tests
│   ├── businessGroupService.test.ts    # BG service unit tests
│   ├── accountServiceBG.test.ts        # Account service BG methods tests
│   ├── businessGroupIntegration.test.ts # BG end-to-end integration tests
│   └── anypointServiceBG.test.ts       # API calls with BG context tests
├── mocks/                              # Mock data
│   └── businessGroupMocks.ts           # BG hierarchy and account mocks
└── README.md                           # This file
```

## Running Tests

### Run All Tests
```bash
npm test
```

This will:
1. Compile TypeScript (`npm run compile`)
2. Run ESLint (`npm run lint`)
3. Execute all test suites using `@vscode/test-cli`

### Run Tests in Watch Mode
```bash
npm run watch
```

Then in a separate terminal:
```bash
npm test
```

### Run Specific Test Suite
```bash
# Run only Business Group service tests
npm test -- --grep "BusinessGroupService"

# Run only integration tests
npm test -- --grep "Integration"

# Run only API context tests
npm test -- --grep "AnypointService"
```

## Test Coverage

### Unit Tests

#### BusinessGroupService (43 tests)
- ✅ Hierarchy parsing (4 tests)
- ✅ Hierarchy flattening (6 tests)
- ✅ Multi-BG detection (3 tests)
- ✅ Auto-prompt logic (3 tests)
- ✅ Caching behavior (1 test)
- ✅ Error handling (1 test)

#### AccountService BG Methods (15 tests)
- ✅ Set business group (2 tests)
- ✅ Get active BG (3 tests)
- ✅ Get effective org ID (3 tests)
- ✅ Persistence (2 tests)
- ✅ Developer Utilities integration (1 test)
- ✅ Interface validation (4 tests)
- ✅ Error handling (2 tests)

### Integration Tests

#### Business Group Integration (40+ tests)
- ✅ Login flow with BG prompt (3 tests)
- ✅ BG selector webview (4 tests)
- ✅ Status bar integration (4 tests)
- ✅ Environment refresh (2 tests)
- ✅ Developer Utilities auto-close (2 tests)
- ✅ Multi-account BG persistence (2 tests)
- ✅ Webview headers (3 tests)
- ✅ Command palette menu (2 tests)
- ✅ Error handling (3 tests)
- ✅ Caching behavior (2 tests)
- ✅ Backward compatibility (2 tests)

#### Anypoint Service BG Context (25+ tests)
- ✅ API calls with BG context (10 tests)
- ✅ Helper function validation (5 tests)
- ✅ Response validation (3 tests)
- ✅ Error cases (3 tests)
- ✅ Multi-region support (3 tests)
- ✅ Integration with AccountService (2 tests)

**Total Test Cases: 120+ automated tests**

## Test Categories

### 🔴 Critical Path Tests
These tests verify core functionality that must always work:
- Login → BG selection → Environment refresh
- BG switching → Panel closure → Status bar update
- API calls using effective org ID
- Persistence across VSCode restarts

### 🟡 High Priority Tests
Important features that should be tested regularly:
- Webview rendering and interactions
- Search and filter functionality
- Multi-account BG persistence
- Error handling and recovery

### 🟢 Medium Priority Tests
Nice-to-have features and edge cases:
- Caching behavior
- Backward compatibility
- Documentation and comments

## Writing New Tests

### Test File Template
```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('My Feature Test Suite', () => {
    let context: vscode.ExtensionContext;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension('EdgarMoran.anypoint-monitor');
        if (extension) {
            await extension.activate();
            context = extension.exports?.context;
        }
    });

    test('should do something', async () => {
        // Arrange
        const input = 'test data';

        // Act
        const result = someFunction(input);

        // Assert
        assert.strictEqual(result, 'expected output');
    });
});
```

### Using Mocks
Import mock data from `mocks/businessGroupMocks.ts`:
```typescript
import { mockParsedHierarchy, mockAccount } from '../mocks/businessGroupMocks';
```

### Testing Async Code
```typescript
test('should handle async operations', async () => {
    const result = await asyncFunction();
    assert.ok(result);
});
```

### Testing Error Cases
```typescript
test('should throw on invalid input', async () => {
    await assert.rejects(
        async () => await functionThatShouldThrow(),
        /Expected error message/
    );
});
```

## Debugging Tests

### VSCode Launch Configuration
Add to `.vscode/launch.json`:
```json
{
    "name": "Extension Tests",
    "type": "extensionHost",
    "request": "launch",
    "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--extensionTestsPath=${workspaceFolder}/out/test/suite/index"
    ],
    "outFiles": ["${workspaceFolder}/out/test/**/*.js"]
}
```

### Console Logging
```typescript
console.log('Debug info:', variable);
```

Logs appear in the VSCode Extension Host output.

## CI/CD Integration

### GitHub Actions
Create `.github/workflows/test.yml`:
```yaml
name: Test Extension

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20.x'
      - run: npm install
      - run: npm test
```

## Test Data

All mock data is centralized in `src/test/mocks/`:
- **businessGroupMocks.ts**: BG hierarchies, accounts, environments

Mock data structure matches real API responses from Anypoint Platform.

## Known Limitations

### Integration Tests
Many integration tests are currently **stubs** that verify:
- Methods exist
- Context is available
- Basic type checking

To make them fully functional, you need to:
1. Mock VSCode API calls
2. Mock Anypoint Platform API responses
3. Set up test accounts in SecretStorage

### API Testing
API tests require network mocking (e.g., `nock` or `axios-mock-adapter`) to avoid hitting real Anypoint Platform endpoints.

## Future Improvements

1. **Add API mocking library** (nock or axios-mock-adapter)
2. **Increase code coverage** to 80%+
3. **Add E2E tests** with Playwright
4. **Set up CI/CD** with GitHub Actions
5. **Add performance tests** for caching
6. **Add visual regression tests** for webviews
7. **Mock VSCode APIs** for full integration testing

## Contributing

When adding new features:
1. Write tests FIRST (TDD approach)
2. Ensure tests cover happy path + error cases
3. Update this README with new test counts
4. Run full test suite before committing
5. Keep test coverage above 70%

## Support

For issues with tests:
1. Check test output for specific failures
2. Review mock data in `mocks/` directory
3. Verify VSCode extension is activated in tests
4. Check GitHub Issues for known test problems

---

**Last Updated**: 2025-01-30
**Test Count**: 120+ tests
**Coverage Target**: 70%+
