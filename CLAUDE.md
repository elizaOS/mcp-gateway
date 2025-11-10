# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## PROJECT INFORMATION
- **Working Directory:** `/Users/studio/Documents/GitHub/studio-mcp-gateway`
- **Git Repository:** Yes
- **Main Branch:** `main`
- **Package Manager:** `bun`
- **Runtime:** Bun (migrated from Node.js)

---

## COMMON COMMANDS

```bash
# Development - SSE Mode (default, exposes HTTP/SSE endpoints)
bun run start --config=examples/config.yaml              # Start gateway in SSE mode on port 8000
bun run start --config=examples/config.yaml --port=3000  # SSE mode on custom port
bun run dev --config=examples/config.yaml                # Development SSE mode

# Development - STDIO Mode (for Claude Desktop integration)
bun run start:stdio --config=examples/config.yaml        # Start gateway in STDIO mode
bun run dev:stdio --config=examples/config.yaml          # Development STDIO mode

# Direct invocation with mode flags
bun run src/index.ts --config=config.yaml --mode=sse --port=8000   # SSE mode (explicit)
bun run src/index.ts --config=config.yaml --mode=stdio             # STDIO mode (explicit)

# Testing
bun run test               # Run comprehensive E2E tests
bun run test:quick         # Run fast, essential tests only (recommended during development)
./tests/test-runner.sh quick          # Alternative quick test runner
./tests/test-runner.sh config <file>  # Test specific configuration
./tests/test-runner.sh manual         # Interactive testing with MCP Inspector

# No separate type checking needed - Bun runs TypeScript directly

# Testing with paid config
bun run start --config=examples/paid-config.yaml --port=8000
```

**IMPORTANT:** 
- There is NO build, lint, or compilation step. The project runs directly from TypeScript source files using Bun.
- **Default mode is SSE** (HTTP/SSE server), which exposes the gateway over HTTP with x402 payment support
- **STDIO mode** is for local integrations (Claude Desktop, Cursor, etc.)

---

## ARCHITECTURE OVERVIEW

### High-Level Design

The MCP Gateway is a **proxy aggregator** that connects multiple MCP (Model Context Protocol) servers into a unified interface. It acts as a single MCP server that internally manages connections to multiple downstream MCP servers.

**Core Flow:**
1. Gateway starts and reads configuration (YAML/JSON or environment variables)
2. ServerManager establishes connections to all enabled MCP servers via various transports
3. GatewayRegistry aggregates tools/resources/prompts from connected servers
4. Gateway exposes unified MCP interface via STDIO to clients (Claude Desktop, Cursor, etc.)
5. Client requests are routed to appropriate downstream server based on namespaced tool/resource names

### Core Components

#### 1. **GatewayServer** (`src/core/gateway.ts`)
- Main server class implementing MCP protocol
- Sets up MCP request handlers for:
  - `ListTools`, `CallTool` - Tool discovery and execution
  - `ListResources`, `ReadResource` - Resource discovery and reading
  - `ListPrompts`, `GetPrompt` - Prompt discovery and retrieval
- Routes requests to appropriate downstream server via registry lookup
- **Payment verification** before tool execution (if enabled)
- Manages health check intervals and graceful shutdown

#### 2. **ServerManager** (`src/core/server-manager.ts`)
- Manages lifecycle of downstream MCP server connections
- Initializes servers in parallel with error handling
- Creates MCP clients for each configured server
- Performs health checks (by calling `listTools()` on each server)
- Tracks connection status: `connecting`, `connected`, `disconnected`, `error`

#### 3. **GatewayRegistry** (`src/core/registry.ts`)
- Central registry aggregating capabilities from all connected servers
- Collects tools, resources, and prompts from each server
- Applies namespace prefixes (e.g., `docs:resolve-library-id`)
- Resolves naming conflicts using conflict resolution strategies
- Provides lookup methods: `findTool()`, `findResource()`, `findPrompt()`

#### 4. **TransportFactory** (`src/transports/factory.ts`)
- Factory for creating transport instances based on configuration
- Supports 4 transport types:
  - **STDIO**: Local command-line MCP servers (most common)
  - **HTTP**: Remote MCP servers via HTTP/HTTPS
  - **SSE**: Server-Sent Events for streaming
  - **WebSocket**: Bidirectional real-time communication
- Validates transport configuration
- Normalizes legacy format (direct `command`/`args`) to modern `transport` object

#### 5. **ConfigManager** (`src/config/manager.ts`)
- Loads configuration from YAML, JSON, or environment variables
- Validates config with Zod schemas
- Ensures no duplicate server names
- Validates namespace format: `/^[a-zA-Z][a-zA-Z0-9_-]*$/`

#### 6. **PaymentMiddleware** (`src/core/payment-middleware.ts`)
- Handles payment verification for tool access
- Supports dual authentication methods:
  - **x402 blockchain payments**: Verifies payment proofs via facilitator
  - **ELIZA API keys**: Traditional API key authentication with tiers
- Implements tiered pricing (premium/basic/free)
- Generates 402 Payment Required responses
- Tracks payment statistics

### Configuration System

**Two configuration formats:**

1. **Modern format** (recommended):
```yaml
servers:
  - name: "server-name"
    transport:
      type: "stdio"  # or "http", "sse", "websocket"
      command: "npx"
      args: ["-y", "package-name"]
```

2. **Legacy format** (still supported):
```yaml
servers:
  - name: "server-name"
    command: "npx"
    args: ["-y", "package-name"]
```

**Key configuration concepts:**
- **Namespace**: Prefix for tools/resources to avoid conflicts (e.g., `docs:tool-name`)
- **Conflict Resolution**: When enabled, duplicate names get suffixed with `_serverName`
- **Health Check Interval**: Periodic connection verification (default: 60s)
- **Payment Config**: Optional payment gating with x402 and API keys
- **Tool Pricing**: Per-tool or server-wide pricing configuration

### Namespacing Strategy

**Problem:** Multiple servers may expose tools with the same name
**Solution:** Apply namespace prefixes automatically

Example:
- Original tool: `resolve-library-id` from server `context7`
- Namespaced tool: `docs:resolve-library-id` (if namespace is `docs`)
- On conflict: `docs:resolve-library-id_context7`

Resources use URL query parameter: `?namespace=docs`

---

## CODE ARCHITECTURE PATTERNS

### Error Handling
- Use `McpError` from SDK for protocol-level errors
- Wrap downstream errors with context (server name, operation)
- Log errors before throwing for debugging
- Use `Promise.allSettled()` for parallel operations to prevent cascading failures

### Connection Management
- Servers initialize in parallel (not sequential)
- Failed server connections don't block gateway startup
- Health checks run on interval to detect disconnections
- Graceful shutdown: close all server connections before exiting

### Registry Updates
- Registry is refreshed on:
  - Initial startup after server connections
  - Health check intervals
  - Manual refresh via `refreshRegistry()`
- Refresh clears and rebuilds entire registry from connected servers

### Type Safety
- Zod schemas validate all configuration at runtime
- TypeScript strict mode enabled
- Type inference from Zod schemas: `z.infer<typeof Schema>`

---

## TESTING STRATEGY

### Test Files
- `tests/e2e-simple.ts` - Quick smoke tests (use during development)
- `tests/e2e-test.ts` - Comprehensive E2E suite (use before commits)
- `tests/test-runner.sh` - Test orchestration script

### Test Configurations
Located in `tests/configs/`:
- `basic.yaml` - Single STDIO server
- `multi-server.yaml` - Multiple servers with namespaces
- `namespaced.yaml` - Single server with namespace
- `invalid.yaml` - Error handling test
- `failing-server.yaml` - Connection failure test

### Testing Best Practices
- Run `bun run test:quick` during active development
- Run `bun run test` before committing
- Use `./tests/test-runner.sh manual <config>` for interactive debugging
- Tests validate: config loading, server connections, tool execution, error handling

---

## PAYMENT SYSTEM

### Architecture
The gateway now supports **payment gating** for monetizing MCP tools:

1. **Payment Methods**:
   - **x402**: Blockchain micropayments (gasless, instant, $0.001+ min)
   - **ELIZA_API_KEY**: Traditional API key auth with tiered pricing

2. **Payment Flow**:
   ```
   Client Request → Gateway → Payment Middleware
                              ├─ Check if tool requires payment
                              ├─ Verify x402 payment OR API key
                              └─ If valid → Route to server
                                 If invalid → Return 402 Payment Required
   ```

3. **Configuration Structure**:
   ```yaml
   payment:
     enabled: true
     recipient: "0xEthereumAddress"
     network: "base-sepolia"
     apiKeys:
       - key: "eliza_premium_xxx"
         tier: "premium"

   servers:
     - name: "server-name"
       tools:
         - name: "tool-name"
           pricing:
             x402: "$0.01"
             apiKeyTiers:
               premium: "free"
   ```

4. **Pricing Strategies**:
   - **Free**: `pricing: { free: true }`
   - **x402 Only**: `pricing: { x402: "$0.01" }`
   - **Tiered**: Different prices per API key tier
   - **Server-wide**: `defaultPricing` applies to all tools

### Implementation Details

**Payment Verification (`src/core/payment-middleware.ts`)**:
- Checks API key first (faster than blockchain verification)
- Falls back to x402 payment verification via facilitator
- Caches API key configs for fast lookup
- Generates proper 402 responses with payment requirements

**Integration Points**:
- `GatewayServer.setupHandlers()`: Payment check before tool execution (src/core/gateway.ts:82-124)
- `PaymentMiddleware.verifyPayment()`: Main verification entry point
- `PaymentMiddleware.generatePaymentRequiredResponse()`: 402 response generation

**USDC Contract Addresses** (hardcoded in PaymentMiddleware):
- `base-sepolia`: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
- `base`: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
- `ethereum`: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

**Amount Conversion**:
- Dollar amounts → atomic units (USDC has 6 decimals)
- `parseAmountToAtomicUnits("$0.01")` → `"10000"`

### Testing Payment Features

1. **Free Testnet USDC**: Get from [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-sepolia-faucet)
2. **Example Configs**: `examples/paid-config.yaml` or `examples/paid-config.json`
3. **Test Command**: `bun run start --config=examples/paid-config.yaml`
4. **API Key Testing**: Add `X-ELIZA-API-KEY` header to requests

### Common Payment Tasks

**Adding a New Payment Tier**:
```yaml
payment:
  apiKeys:
    - key: "eliza_enterprise_xxx"
      tier: "enterprise"
      rateLimit: 100000
```

**Making a Tool Paid**:
```yaml
servers:
  - name: "my-server"
    tools:
      - name: "expensive-tool"
        pricing:
          x402: "$0.50"
```

**Debugging Payment Issues**:
1. Set `logLevel: "debug"` in config
2. Check payment middleware logs: `[INFO] Payment verified` or `[WARN] Payment required`
3. Verify facilitator connectivity: `curl https://x402.org/facilitator/verify`
4. Test API key: Headers must include `X-ELIZA-API-KEY` or `Authorization: Bearer <key>`

## IMPORTANT DEVELOPMENT NOTES

### Entry Point
- `src/index.ts` is the CLI entry point with dual-mode support
- **SSE mode** (default): Runs HTTP/SSE wrapper for network access with x402 payment support
- **STDIO mode**: Direct stdin/stdout for local clients (Claude Desktop, Cursor, etc.)
- Accepts flags:
  - `--config=<path>` - Configuration file path (required for SSE mode)
  - `--mode=<sse|stdio>` - Transport mode (default: sse)
  - `--port=<number>` - Port for SSE mode (default: 8000)
- Falls back to environment variables if no config file provided (STDIO mode only)

### Transport Modes
- **SSE** (default): HTTP/SSE server mode - exposes gateway over HTTP with x402 payment support
  - Used for: Network access, agent integrations, payment-gated APIs
  - Endpoints: `GET /sse` (Server-Sent Events), `POST /message`
- **STDIO**: Standard input/output mode - direct communication via stdin/stdout
  - Used for: Claude Desktop, Cursor, local MCP clients, testing
  - Required for all test suites

### Downstream Server Transports
Gateway can connect to downstream servers using:
- **STDIO** - Most common (local MCP servers)
- **HTTP/HTTPS** - Remote MCP servers
- **SSE** - Streaming connections
- **WebSocket** - Bidirectional real-time
- Legacy format auto-converts to STDIO transport

### Logging System
- Custom logger wrapper around console with log level filtering
- Log levels: `error`, `warn`, `info`, `debug`
- Set via `MCP_LOG_LEVEL` env var or config `settings.logLevel`
- Use structured logging: `[INFO] message` format

### Type Definitions
- All types defined in `src/types/index.ts`
- Core interfaces: `ServerConnection`, `AggregatedTool`, `AggregatedResource`, `AggregatedPrompt`
- Transport types: Union of STDIO/HTTP/SSE/WebSocket configs
- Use Zod schemas as source of truth for config types

### Critical Rules
- Always validate config before creating transports
- Never expose original tool names to clients (use namespaced names)
- Store both `name` (namespaced) and `originalName` in registry
- When calling downstream servers, use `originalName` not `name`

---

## COMMON DEVELOPMENT TASKS

### Adding a New Transport Type
1. Define Zod schema in `src/types/index.ts` (e.g., `GrpcTransportSchema`)
2. Add to `TransportConfigSchema` discriminated union
3. Add case in `TransportFactory.create()` to instantiate transport
4. Add validation in `TransportFactory.validateConfig()`
5. Add display name in `TransportFactory.getTransportDisplayName()`

### Debugging Connection Issues
1. Set log level to `debug`: `MCP_LOG_LEVEL=debug bun run dev --config=config.yaml`
2. Check transport validation errors in logs
3. Verify server command runs independently: `npx -y package-name`
4. Use MCP Inspector: `npx @modelcontextprotocol/inspector node build/index.js --config=config.yaml`
5. Check server connection status in `ServerManager.getConnectionStatus()`

### Adding New Registry Capability Types
Currently supports: tools, resources, prompts. To add more:
1. Add aggregated type interface in `src/types/index.ts`
2. Add Map in `GatewayRegistry` constructor
3. Add collection method (e.g., `collectCapabilityType()`)
4. Add to `refresh()` parallel collection
5. Add getter, finder, and stats methods
6. Add MCP request handlers in `GatewayServer.setupHandlers()`

---

## ENVIRONMENT VARIABLES

```bash
# Gateway Identity
MCP_GATEWAY_NAME="My Gateway"
MCP_GATEWAY_VERSION="1.0.0"
MCP_GATEWAY_DESCRIPTION="Description"

# Server Configuration (semicolon-separated)
MCP_SERVERS="server1:npx:package1;server2:node:script.js"

# Settings
MCP_LOG_LEVEL=info                              # error, warn, info, debug
MCP_ENABLE_TOOL_CONFLICT_RESOLUTION=true
MCP_ENABLE_RESOURCE_CONFLICT_RESOLUTION=true
MCP_ENABLE_PROMPT_CONFLICT_RESOLUTION=true
MCP_MAX_CONCURRENT_CONNECTIONS=10
MCP_HEALTH_CHECK_INTERVAL=60000                 # milliseconds
```

---

## PROJECT STRUCTURE

```
src/
├── index.ts                  # CLI entry point, main() function
├── types/index.ts            # Zod schemas and TypeScript types
├── core/
│   ├── gateway.ts           # Main MCP server implementation
│   ├── server-manager.ts    # Downstream server connection manager
│   └── registry.ts          # Aggregated capability registry
├── config/
│   └── manager.ts           # Configuration loading and validation
└── transports/
    └── factory.ts           # Transport creation and validation

tests/
├── e2e-simple.ts            # Quick smoke tests
├── e2e-test.ts              # Comprehensive E2E tests
├── test-runner.sh           # Test orchestration script
└── configs/                 # Test configuration files

examples/
├── config.yaml              # Basic STDIO example
├── multi-server.yaml        # Multiple servers example
├── http-remote.yaml         # HTTP transport example
└── mixed-transports.yaml    # Multiple transport types
```