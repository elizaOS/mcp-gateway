# Eliza MCP Gateway - E2E Test Suite

This directory contains end-to-end tests for the Eliza MCP Gateway to ensure it works correctly across different configurations and scenarios.

## 🚀 Running Tests

### Quick Tests (Recommended)
```bash
npm run test:quick
```

This runs the simplified e2e test suite that focuses on essential functionality:
- Configuration loading (YAML/JSON/Environment)
- Gateway startup and initialization
- Server connection handling
- Error handling and validation

### Full Test Suite
```bash
npm run test
```

This runs the comprehensive test suite including MCP client communication tests.

### Manual Testing
```bash
# Test a specific configuration
npm run build
node build/index.js --config tests/configs/basic.yaml

# Test with environment variables
MCP_SERVERS="test:npx:user-review-mcp" node build/index.js

# Use MCP Inspector for interactive testing
npx @modelcontextprotocol/inspector node build/index.js --config tests/configs/basic.yaml
```

## 📋 Test Configurations

### `configs/basic.yaml`
- Simple single-server configuration
- Uses `user-review-mcp` (no API key required)
- Tests basic STDIO transport

### `configs/basic.json`
- Same as basic.yaml but in JSON format
- Tests JSON configuration parsing

### `configs/namespaced.yaml`
- Single server with namespace
- Tests namespace functionality

### `configs/multi-server.yaml`
- Multiple servers with different namespaces
- Tests multi-server coordination
- Mixes modern and legacy configuration formats

### `configs/invalid.yaml`
- Invalid configuration with errors
- Tests configuration validation
- Should be rejected by the gateway

### `configs/failing-server.yaml`
- Contains servers that will fail to connect
- Tests error handling and resilience
- Gateway should handle failures gracefully

## 🧪 Test Scenarios

### Configuration Loading
- ✅ YAML configuration parsing
- ✅ JSON configuration parsing
- ✅ Environment variable configuration
- ✅ Configuration validation and error handling

### Basic Functionality
- ✅ Gateway startup and initialization
- ✅ Server connection attempts
- ✅ Process management and cleanup

### Namespace Handling
- ✅ Single server with namespace
- ✅ Multiple servers with different namespaces
- ✅ Conflict resolution

### Error Handling
- ✅ Invalid configuration rejection
- ✅ Server connection failure handling
- ✅ Graceful degradation

### Transport Types (Future)
- 📝 STDIO transport (current)
- 📝 HTTP transport testing
- 📝 SSE transport testing
- 📝 WebSocket transport testing

## 🛠️ Test Architecture

### Simple E2E Tests (`e2e-simple.ts`)
- Focuses on gateway startup and configuration
- Uses process spawning and output monitoring
- Fast execution, no external dependencies
- Suitable for CI/CD pipelines

### Full E2E Tests (`e2e-test.ts`)
- Comprehensive MCP client communication testing
- Tests actual tool execution and MCP protocol
- More thorough but requires MCP SDK
- Better for development and detailed validation

## 📊 Expected Results

When all tests pass, you should see:
```
🎉 All tests passed! Gateway is working correctly.
📊 Success Rate: 100%
```

If tests fail, the output will show:
- Which specific tests failed
- Error messages and details
- Timing information
- Suggestions for debugging

## 🐛 Troubleshooting

### Tests Timeout
- Increase timeout values in test files
- Check if `user-review-mcp` is accessible via `npx`
- Verify build completed successfully

### Configuration Errors
- Ensure test config files exist in `tests/configs/`
- Check YAML/JSON syntax
- Verify file permissions

### Server Connection Issues
- Test MCP servers individually: `npx -y user-review-mcp`
- Check network connectivity for remote servers
- Verify API keys for services that require them

### Build Failures
- Run `npm install` to ensure dependencies
- Check TypeScript compilation: `npm run type-check`
- Verify Node.js version compatibility

## 🔧 Adding New Tests

To add new test scenarios:

1. **Create test configuration** in `tests/configs/`
2. **Add test case** in `e2e-simple.ts` or `e2e-test.ts`
3. **Update this README** with new test description
4. **Run tests** to ensure they pass

Example new test:
```typescript
await this.runTest('My new test', async () => {
  const configPath = join(process.cwd(), 'tests', 'configs', 'my-config.yaml');
  const output = await this.runGatewayWithTimeout(configPath, 8000);
  
  if (!output.includes('expected-message')) {
    throw new Error('Test condition not met');
  }
});
```
