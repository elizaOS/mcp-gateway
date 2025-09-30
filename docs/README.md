# MCP Gateway Documentation

Complete documentation for the Eliza MCP Gateway.

---

## 📚 Documentation Index

### Getting Started
- **[Main README](../README.md)** - Project overview, installation, quick start
- **[CLAUDE.md](CLAUDE.md)** - Developer guide for working with this codebase

### Payment & Monetization
- **[PASSTHROUGH_PAYMENT.md](PASSTHROUGH_PAYMENT.md)** - Complete x402 payment guide
  - Three payment modes (passthrough, markup, absorb)
  - Configuration examples
  - Revenue models
  - Security best practices

- **[PAYMENT_IMPLEMENTATION.md](PAYMENT_IMPLEMENTATION.md)** - Original payment implementation details
  - Inbound payment gating
  - API key authentication
  - x402 verification

- **[PASSTHROUGH_IMPLEMENTATION.md](PASSTHROUGH_IMPLEMENTATION.md)** - Technical implementation summary
  - Bidirectional payment architecture
  - Code structure
  - Dependencies

- **[MCPAY_INTEGRATION.md](MCPAY_INTEGRATION.md)** - Real paid server integration
  - Working example with 5 MCPay servers
  - Revenue scenarios
  - Setup instructions

- **[X402_PASSTHROUGH_SUMMARY.md](X402_PASSTHROUGH_SUMMARY.md)** - Executive summary
  - Quick reference
  - Final results
  - Production checklist

### Testing
- **[TESTING.md](TESTING.md)** - Complete testing guide
  - Test suites overview
  - Running tests
  - Writing new tests

- **[TEST_SUMMARY.md](TEST_SUMMARY.md)** - Latest test results
  - Test coverage report
  - Success rates
  - Quick reference

### Features
- **[FEATURE_MAP.md](FEATURE_MAP.md)** - Complete feature inventory
  - 60+ features mapped
  - Coverage matrix
  - Test scenarios

---

## 🚀 Quick Links

### Common Tasks
- [Configure payment gating](PASSTHROUGH_PAYMENT.md#payment-modes)
- [Add new MCP server](../README.md#configuration)
- [Run tests](TESTING.md#running-tests)
- [Debug connection issues](CLAUDE.md#debugging-connection-issues)
- [Configure namespace](../README.md#namespace-support)

### Examples
- Basic configuration: [`examples/config.yaml`](../examples/config.yaml)
- Payment config: [`examples/paid-config.yaml`](../examples/paid-config.yaml)
- Passthrough config: [`examples/passthrough-config.yaml`](../examples/passthrough-config.yaml)
- Real servers: [`examples/mcpay-real-servers.yaml`](../examples/mcpay-real-servers.yaml)

---

## 📖 Documentation by Use Case

### I want to...

**Set up the gateway for the first time**
→ [Main README](../README.md#installation)

**Connect multiple MCP servers**
→ [Main README](../README.md#configuration)

**Monetize my MCP tools**
→ [PASSTHROUGH_PAYMENT.md](PASSTHROUGH_PAYMENT.md)

**Forward payments to paid APIs**
→ [PASSTHROUGH_PAYMENT.md](PASSTHROUGH_PAYMENT.md#mode-1-passthrough-)

**Add markup to downstream APIs**
→ [PASSTHROUGH_PAYMENT.md](PASSTHROUGH_PAYMENT.md#mode-2-markup-)

**Build a subscription service**
→ [PASSTHROUGH_PAYMENT.md](PASSTHROUGH_PAYMENT.md#mode-3-absorb-)

**Test my configuration**
→ [TESTING.md](TESTING.md#running-tests)

**Understand the architecture**
→ [CLAUDE.md](CLAUDE.md#architecture-overview)

**Debug issues**
→ [CLAUDE.md](CLAUDE.md#debugging-connection-issues)

---

## 🎯 Documentation Status

| Document | Lines | Status | Last Updated |
|----------|-------|--------|--------------|
| Main README | 500+ | ✅ Current | 2025-09-30 |
| CLAUDE.md | 400+ | ✅ Current | 2025-09-30 |
| PASSTHROUGH_PAYMENT.md | 473 | ✅ Current | 2025-09-30 |
| MCPAY_INTEGRATION.md | 450+ | ✅ Current | 2025-09-30 |
| PASSTHROUGH_IMPLEMENTATION.md | 350+ | ✅ Current | 2025-09-30 |
| X402_PASSTHROUGH_SUMMARY.md | 300+ | ✅ Current | 2025-09-30 |
| TESTING.md | 200+ | ✅ Current | 2025-09-30 |
| FEATURE_MAP.md | 400+ | ✅ Current | 2025-09-30 |

---

## 🤝 Contributing

Found an error in the docs? Want to improve something?

1. File an issue: https://github.com/elizaOS/mcp-gateway/issues
2. Submit a PR with documentation improvements
3. All documentation is in Markdown format

---

## 📝 Documentation Guidelines

When updating documentation:
- Keep examples up-to-date with actual working configs
- Include both YAML and code examples where relevant
- Cross-reference related documentation
- Update this index when adding new docs
- Test all command examples before committing
