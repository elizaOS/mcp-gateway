# MCP Gateway Feature Map

Complete mapping of all features in the Eliza MCP Gateway for E2E testing.

---

## 🎯 Core Features

### 1. **Configuration Management**
- ✅ YAML config loading (`config.yaml`)
- ✅ JSON config loading (`config.json`)
- ✅ Environment variable config (`MCP_SERVERS`, `MCP_GATEWAY_NAME`, etc.)
- ✅ Config validation (duplicate server names, invalid namespaces)
- ✅ Default value handling
- ❌ Config hot-reloading (not implemented)

**Test Coverage:**
- `tests/e2e-simple.ts`: testConfigurationLoading()
- Configs: `tests/configs/basic.yaml`, `tests/configs/basic.json`

---

### 2. **Server Connection Management**
- ✅ STDIO transport (local command execution)
- ✅ HTTP transport (remote HTTP servers)
- ✅ SSE transport (Server-Sent Events)
- ✅ WebSocket transport (bidirectional)
- ✅ Legacy format support (`command`/`args`)
- ✅ Modern format support (`transport` object)
- ✅ Parallel server initialization
- ✅ Connection health checks
- ✅ Graceful degradation (failed servers don't crash gateway)
- ✅ Server retry logic (configurable attempts/delay)

**Test Coverage:**
- `tests/e2e-simple.ts`: testBasicStartup()
- `tests/e2e-test.ts`: Full transport validation
- Configs: `tests/configs/multi-server.yaml`, `examples/mixed-transports.yaml`

---

### 3. **Namespace Management**
- ✅ Namespace prefixing (`docs:tool-name`)
- ✅ Conflict resolution (duplicate tool names)
- ✅ Resource URI namespacing
- ✅ Prompt namespacing
- ✅ Namespace validation (regex: `/^[a-zA-Z][a-zA-Z0-9_-]*$/`)
- ✅ Optional namespaces (servers without namespace)

**Test Coverage:**
- `tests/e2e-simple.ts`: testNamespaceHandling()
- Configs: `tests/configs/namespaced.yaml`

---

### 4. **Tool Aggregation & Routing**
- ✅ Tool discovery (`ListTools`)
- ✅ Tool execution (`CallTool`)
- ✅ Original name preservation
- ✅ Namespaced name mapping
- ✅ Server routing (find correct server for tool)
- ✅ Input schema forwarding
- ✅ Tool description enrichment
- ✅ Error propagation from downstream servers

**Test Coverage:**
- `tests/e2e-test.ts`: Tool listing and execution tests
- Currently tested implicitly

---

### 5. **Resource Aggregation & Routing**
- ✅ Resource discovery (`ListResources`)
- ✅ Resource reading (`ReadResource`)
- ✅ URI namespacing (query parameter or prefix)
- ✅ MIME type forwarding
- ✅ Resource description enrichment

**Test Coverage:**
- Currently minimal - needs dedicated tests

---

### 6. **Prompt Aggregation & Routing**
- ✅ Prompt discovery (`ListPrompts`)
- ✅ Prompt execution (`GetPrompt`)
- ✅ Argument forwarding
- ✅ Prompt description enrichment

**Test Coverage:**
- Currently minimal - needs dedicated tests

---

### 7. **Health Monitoring**
- ✅ Configurable health check interval
- ✅ Server status tracking (connecting/connected/disconnected/error)
- ✅ Automatic registry refresh on health check
- ✅ Connection statistics
- ✅ Last health check timestamp
- ✅ Error tracking per server

**Test Coverage:**
- Currently minimal - needs time-based tests

---

### 8. **Error Handling**
- ✅ Invalid config rejection
- ✅ Server connection failures (graceful)
- ✅ Tool not found errors
- ✅ Server disconnection handling
- ✅ MCP protocol errors
- ✅ Timeout handling
- ✅ Transport validation errors

**Test Coverage:**
- `tests/e2e-simple.ts`: testErrorHandling()
- Configs: `tests/configs/invalid.yaml`, `tests/configs/failing-server.yaml`

---

### 9. **Payment Gating** ⭐ NEW
- ✅ Payment config loading
- ✅ x402 payment verification
- ✅ API key authentication
- ✅ Tiered pricing (premium/basic/free)
- ✅ Per-tool pricing
- ✅ Server-wide default pricing
- ✅ Free tool designation
- ✅ 402 Payment Required responses
- ✅ Payment facilitator integration
- ✅ USDC multi-network support
- ✅ Amount conversion (dollars → atomic units)
- ✅ API key caching
- ✅ Payment statistics

**Test Coverage:**
- ❌ No tests yet - NEEDS IMPLEMENTATION

---

### 10. **Registry Management**
- ✅ Tool registry (Map-based storage)
- ✅ Resource registry
- ✅ Prompt registry
- ✅ Registry refresh
- ✅ Capability discovery
- ✅ Statistics tracking (tools/resources/prompts by server)
- ✅ Conflict detection and resolution

**Test Coverage:**
- Tested implicitly through tool/resource/prompt tests

---

### 11. **Logging & Observability**
- ✅ Configurable log levels (error/warn/info/debug)
- ✅ Structured logging format (`[INFO]`, `[ERROR]`, etc.)
- ✅ Startup logs
- ✅ Connection status logs
- ✅ Tool execution logs
- ✅ Payment verification logs (NEW)
- ✅ Health check logs
- ✅ Error logging with context

**Test Coverage:**
- Validated through output parsing in tests

---

### 12. **Process Management**
- ✅ Graceful shutdown (SIGINT/SIGTERM)
- ✅ Cleanup on exit
- ✅ Server connection cleanup
- ✅ Health check interval cleanup
- ✅ Uncaught exception handling
- ✅ Unhandled rejection handling

**Test Coverage:**
- Tested via process timeout/kill in test runner

---

## 📊 Feature Coverage Matrix

| Feature | Implementation | Unit Tests | E2E Tests | Integration Tests |
|---------|---------------|------------|-----------|-------------------|
| YAML Config | ✅ | ✅ | ✅ | ✅ |
| JSON Config | ✅ | ✅ | ✅ | ✅ |
| Env Config | ✅ | ❌ | ✅ | ✅ |
| STDIO Transport | ✅ | ❌ | ✅ | ✅ |
| HTTP Transport | ✅ | ❌ | ⚠️ | ⚠️ |
| SSE Transport | ✅ | ❌ | ⚠️ | ❌ |
| WebSocket Transport | ✅ | ❌ | ⚠️ | ❌ |
| Namespace Prefixing | ✅ | ❌ | ✅ | ✅ |
| Conflict Resolution | ✅ | ❌ | ⚠️ | ⚠️ |
| Tool Aggregation | ✅ | ❌ | ⚠️ | ⚠️ |
| Resource Aggregation | ✅ | ❌ | ❌ | ❌ |
| Prompt Aggregation | ✅ | ❌ | ❌ | ❌ |
| Health Checks | ✅ | ❌ | ❌ | ❌ |
| Error Handling | ✅ | ❌ | ✅ | ✅ |
| **Payment - x402** | ✅ | ❌ | ❌ | ❌ |
| **Payment - API Keys** | ✅ | ❌ | ❌ | ❌ |
| **Payment - Tiered Pricing** | ✅ | ❌ | ❌ | ❌ |
| **Payment - Free Tools** | ✅ | ❌ | ❌ | ❌ |
| **Payment - 402 Responses** | ✅ | ❌ | ❌ | ❌ |
| Graceful Shutdown | ✅ | ❌ | ⚠️ | ⚠️ |
| Logging | ✅ | ❌ | ⚠️ | ⚠️ |

Legend:
- ✅ = Fully implemented/tested
- ⚠️ = Partially implemented/tested
- ❌ = Not implemented/tested

---

## 🎯 Test Scenarios Needed

### **Payment Feature Tests** (Priority: HIGH)

#### Test Suite: `tests/e2e-payment.ts`

1. **Payment Config Loading**
   - ✅ Load paid config YAML
   - ✅ Load paid config JSON
   - ✅ Validate payment recipient address
   - ✅ Validate API key format
   - ✅ Validate network selection

2. **Free Tool Access**
   - Test tool marked as `free: true`
   - No payment required
   - No API key required

3. **API Key Authentication**
   - Test valid API key (premium tier)
   - Test valid API key (basic tier)
   - Test invalid API key (rejected)
   - Test missing API key (402 error)
   - Test tier-based pricing
   - Test free tier access

4. **x402 Payment Verification**
   - Mock facilitator responses
   - Test valid payment header
   - Test invalid payment header
   - Test payment amount validation
   - Test network compatibility
   - Test USDC contract addressing

5. **Tiered Pricing**
   - Premium tier gets free access
   - Basic tier gets discount
   - No tier pays full price
   - Per-tool pricing override

6. **Default Pricing**
   - Server-wide default pricing
   - Tool-specific override
   - Multiple pricing strategies

7. **402 Error Responses**
   - Correct payment requirements structure
   - x402Version = 1
   - Valid payment scheme
   - Correct USDC address for network
   - Atomic units conversion

8. **Edge Cases**
   - Payment disabled (backward compatibility)
   - Tool without pricing config (free by default)
   - Mixed free and paid tools
   - Multiple API key tiers

---

### **Transport Tests** (Priority: MEDIUM)

#### Test Suite: `tests/e2e-transports.ts`

1. HTTP Transport
2. SSE Transport
3. WebSocket Transport
4. Mixed transports in one gateway

---

### **Resource Tests** (Priority: MEDIUM)

#### Test Suite: `tests/e2e-resources.ts`

1. Resource listing
2. Resource reading
3. Resource namespacing
4. Resource conflict resolution

---

### **Prompt Tests** (Priority: MEDIUM)

#### Test Suite: `tests/e2e-prompts.ts`

1. Prompt listing
2. Prompt execution
3. Prompt argument forwarding
4. Prompt namespacing

---

### **Health Check Tests** (Priority: LOW)

#### Test Suite: `tests/e2e-health.ts`

1. Initial health check
2. Periodic health checks
3. Server reconnection on failure
4. Registry refresh on health check

---

## 📁 Test Config Files Needed

### Payment Configs
- `tests/configs/paid-free-tools.yaml` - Mix of free and paid tools
- `tests/configs/paid-api-key-only.yaml` - API key authentication only
- `tests/configs/paid-x402-only.yaml` - x402 payment only
- `tests/configs/paid-tiered.yaml` - Multiple pricing tiers
- `tests/configs/paid-default-pricing.yaml` - Server-wide defaults

### Mock Servers
- `tests/mocks/mock-paid-server.ts` - Mock MCP server with payment
- `tests/mocks/mock-facilitator.ts` - Mock x402 facilitator

---

## 🚀 Testing Strategy

### Phase 1: Payment Feature Tests (CURRENT)
1. Create mock facilitator for x402 verification
2. Create test configs for all payment scenarios
3. Implement `tests/e2e-payment.ts`
4. Add payment tests to CI workflow

### Phase 2: Transport Tests
1. Create HTTP/SSE/WebSocket mock servers
2. Test all transport types
3. Test transport failure modes

### Phase 3: Resource & Prompt Tests
1. Test full resource lifecycle
2. Test full prompt lifecycle
3. Test conflict resolution

### Phase 4: Advanced Tests
1. Health check timing tests
2. Stress tests (many servers/tools)
3. Performance benchmarks

---

## 📊 Success Metrics

- **Code Coverage**: Target 80%+ for core features
- **E2E Coverage**: All features have at least 1 E2E test
- **Payment Tests**: 100% coverage of payment flows
- **CI/CD**: All tests pass on every commit
- **Documentation**: Every feature documented and tested

---

## 🎯 Next Steps

1. ✅ Create this feature map
2. ⏳ Implement `tests/e2e-payment.ts`
3. ⏳ Create payment test configs
4. ⏳ Add mock facilitator
5. ⏳ Update CI workflow
6. ⏳ Implement remaining test suites