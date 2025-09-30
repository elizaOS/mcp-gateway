# x402 Passthrough Payment Documentation

The MCP Gateway now supports **bidirectional x402 payments**: receiving payments from clients AND making payments to downstream x402-compatible APIs.

## 📊 Payment Modes

The gateway supports three payment routing strategies:

### 1. **Passthrough Mode** 🔄
Forward client payment headers directly to downstream APIs.

**Use Case**: Pure proxy - gateway doesn't handle money, just routes payments

```yaml
servers:
  - name: "paid-api"
    transport:
      type: "http"
      url: "https://paid-api.example.com"
    paymentMode: "passthrough"
```

**Flow:**
```
Client → Gateway → Downstream API
  └─ payment headers forwarded directly
```

**Pros:**
- Simple, no payment processing
- Zero risk for gateway operator
- Lowest latency

**Cons:**
- No revenue for gateway operator
- No payment visibility

---

### 2. **Markup Mode** 💰
Gateway receives payment from client, pays downstream with a margin.

**Use Case**: Monetize existing paid APIs by adding a markup

```yaml
payment:
  enabled: true
  recipient: "0xYourWallet"
  outboundWallet: "0xYourPrivateKey"  # For paying downstream

servers:
  - name: "paid-api"
    transport:
      type: "http"
      url: "https://paid-api.example.com"
    paymentMode: "markup"
    markup: "20%"  # Add 20% on top of downstream price
```

**Markup Types:**
- **Percentage**: `"20%"` - Add 20% to downstream price
- **Fixed**: `"$0.01"` - Add $0.01 to downstream price

**Flow:**
```
Client pays $0.12 → Gateway (keeps $0.02) → Downstream receives $0.10
```

**Pros:**
- Gateway earns revenue from markup
- Automatic payment handling
- Client pays fair market price + service fee

**Cons:**
- Gateway must manage wallet and funds
- Requires outboundWallet configuration

---

### 3. **Absorb Mode** 🎁
Gateway pays all downstream costs from its own wallet.

**Use Case**: Subscription/membership model - clients pay gateway flat rate, gateway covers all downstream costs

```yaml
payment:
  enabled: true
  recipient: "0xYourWallet"
  outboundWallet: "0xYourPrivateKey"

  apiKeys:
    - key: "eliza_premium_abc123"
      tier: "premium"
      rateLimit: 10000

servers:
  - name: "expensive-api"
    transport:
      type: "http"
      url: "https://paid-api.example.com"
    paymentMode: "absorb"
    tools:
      - name: "premium-tool"
        pricing:
          apiKeyTiers:
            premium: "free"  # Subscribers get it free
          x402: "$5.00"      # Others pay one-time fee
```

**Flow:**
```
Client pays $5.00 → Gateway → Gateway pays downstream $0.10 from its wallet
(Gateway profit: $4.90 per call)
```

**Pros:**
- Subscription business model
- High margin potential
- Client gets predictable pricing

**Cons:**
- Gateway must fund downstream costs
- Risk if usage exceeds expectations

---

## 🚀 Quick Start

### Example 1: Pure Passthrough (No Gateway Payment)

```yaml
name: "Passthrough Gateway"

# No payment config needed - just forward headers
payment:
  enabled: false

servers:
  - name: "paid-api"
    transport:
      type: "http"
      url: "https://paid-api.example.com"
    paymentMode: "passthrough"
```

**Client usage:**
```typescript
// Client's payment headers automatically forwarded
const response = await mcpClient.callTool({
  name: "tool-name",
  arguments: {},
  headers: {
    "X-PAYMENT": "x402_payment_proof_here"
  }
});
```

---

### Example 2: Markup Mode (Gateway Earns Revenue)

```yaml
name: "Markup Gateway"

payment:
  enabled: true
  recipient: "0xYourWallet"
  network: "base-sepolia"
  outboundWallet: "0xYourPrivateKeyHere"

servers:
  - name: "docs-api"
    transport:
      type: "http"
      url: "https://docs-api.example.com"
    paymentMode: "markup"
    markup: "25%"
```

**Example Pricing:**
- Downstream charges: $0.10
- Gateway charges: $0.125 (25% markup)
- Gateway profit: $0.025 per call

---

### Example 3: Absorb Mode (Subscription Model)

```yaml
name: "Subscription Gateway"

payment:
  enabled: true
  recipient: "0xYourWallet"
  outboundWallet: "0xYourPrivateKey"

  apiKeys:
    - key: "premium_key_abc123"
      tier: "premium"
    - key: "basic_key_xyz789"
      tier: "basic"

servers:
  - name: "ai-api"
    transport:
      type: "http"
      url: "https://expensive-ai-api.com"
    paymentMode: "absorb"
    tools:
      - name: "ai-analysis"
        pricing:
          apiKeyTiers:
            premium: "free"     # Premium subscribers
            basic: "$1.00"      # Basic tier pays per use
          x402: "$2.00"         # No subscription pays most
```

**Business Model:**
- Premium subscribers: Unlimited use
- Basic tier: $1 per call
- Pay-per-use: $2 per call
- Gateway pays downstream: ~$0.10 per call

---

## 🔧 Configuration Reference

### Payment Config

```yaml
payment:
  enabled: true|false          # Enable inbound payments
  recipient: "0xAddress"       # Where client payments go
  network: "base-sepolia"      # Blockchain network
  outboundWallet: "0xPrivKey"  # For paying downstream APIs

  apiKeys:
    - key: "eliza_premium_xxx"
      tier: "premium"
      rateLimit: 10000
```

### Server Config

```yaml
servers:
  - name: "server-name"
    transport:
      type: "http"
      url: "https://api.example.com"

    # Payment routing mode
    paymentMode: "passthrough"|"markup"|"absorb"

    # Markup configuration (if mode=markup)
    markup: "20%"  # or "$0.01"

    # Per-server wallet override (optional)
    paymentWallet: "0xServerSpecificPrivateKey"

    # Tool-specific pricing (if mode=absorb)
    tools:
      - name: "tool-name"
        pricing:
          free: true|false
          x402: "$0.10"
          apiKeyTiers:
            premium: "free"
            basic: "$0.05"
```

---

## 🧪 Testing

### Run Passthrough Tests

```bash
bun run test:passthrough
```

**Test Coverage:**
- ✅ Passthrough mode configuration
- ✅ Markup calculation (percentage and fixed)
- ✅ Absorb mode with API keys
- ✅ Hybrid mode (mix of all strategies)

### Example Configs

Try these example configurations:

```bash
# Pure passthrough
bun run start --config=examples/passthrough-config.yaml

# Absorb mode (subscription)
bun run start --config=examples/absorb-config.yaml

# Hybrid (multiple strategies)
bun run start --config=examples/hybrid-payment-config.yaml
```

---

## 💡 Use Cases

### 1. **API Marketplace** (Markup Mode)
Aggregate multiple paid APIs and add 10-30% markup for curation and reliability.

### 2. **Enterprise Gateway** (Absorb Mode)
Sell subscriptions to companies, absorb all downstream costs, profit from volume discounts.

### 3. **Developer Platform** (Passthrough Mode)
Let developers access paid APIs directly, gateway just provides discovery and routing.

### 4. **Hybrid SaaS** (Mixed Modes)
- Free tier: Limited access to free APIs
- Basic tier: Passthrough to paid APIs
- Premium tier: Absorb mode with generous limits
- Enterprise: Custom markup arrangements

---

## 🔐 Security Notes

### Wallet Management

**IMPORTANT**: Never commit private keys to git!

```bash
# Use environment variables
export OUTBOUND_WALLET_KEY="0xYourPrivateKey"
```

```yaml
payment:
  outboundWallet: "${OUTBOUND_WALLET_KEY}"
```

### Production Checklist

- [ ] Use hardware wallet or KMS for production
- [ ] Monitor wallet balance alerts
- [ ] Set up rate limiting per API key
- [ ] Implement fraud detection (unusual usage patterns)
- [ ] Keep audit logs of all transactions
- [ ] Use mainnet for production (base, ethereum, etc)
- [ ] Test on testnet first (base-sepolia)

---

## 📚 Advanced Topics

### Custom Markup Logic

Want dynamic markup based on usage? Extend `PaymentMiddleware.calculateMarkup()`:

```typescript
// src/core/payment-middleware.ts
calculateMarkup(downstreamPrice: string, markup: string, usage?: number): string {
  const base = parseFloat(downstreamPrice.replace(/[^0-9.]/g, ''));

  // Volume discount example
  if (usage && usage > 1000) {
    return `$${(base * 1.10).toFixed(6)}`; // Only 10% markup for high volume
  }

  // Default markup logic
  // ...
}
```

### Multiple Downstream Wallets

Pay different APIs from different wallets:

```yaml
payment:
  outboundWallet: "0xDefaultWallet"

servers:
  - name: "expensive-api"
    paymentWallet: "0xHighValueWallet"  # Override for this server

  - name: "cheap-api"
    # Uses default outboundWallet
```

---

## 🐛 Troubleshooting

### Gateway not paying downstream

**Symptoms**: 402 errors from downstream APIs

**Solutions:**
1. Check `outboundWallet` is configured
2. Verify wallet has USDC balance
3. Check network setting matches downstream
4. Verify facilitator URL is correct

### Markup not applied

**Symptoms**: Client charged wrong amount

**Solutions:**
1. Verify `paymentMode: "markup"` is set
2. Check `markup` field format (`"20%"` or `"$0.01"`)
3. Enable debug logging: `logLevel: "debug"`

### Passthrough failing

**Symptoms**: Client payment headers not reaching downstream

**Solutions:**
1. Verify `paymentMode: "passthrough"` is set
2. Check client is sending payment headers
3. Verify downstream API accepts x402 payments
4. Enable debug logging to see header forwarding

---

## 🌐 Finding Paid x402 MCP Servers

### MCPay.tech - Paid MCP Server Directory

Visit https://mcpay.tech/servers to find real x402-compatible MCP servers you can:
- **Passthrough** to (forward client payments)
- **Markup** on (add your margin)
- **Absorb** from (pay with your wallet)

### Using MCPay Servers with Gateway

**Step 1: Find Server URLs**
```bash
# Visit https://mcpay.tech/servers
# Copy the HTTP endpoint URL for the server you want
```

**Step 2: Configure Gateway**
```yaml
servers:
  - name: "mcpay-server"
    transport:
      type: "http"
      url: "https://api.mcpay.tech/server-name"  # Replace with actual URL
    paymentMode: "passthrough"  # or "markup" or "absorb"
```

**Step 3: Test with Testnet**
```bash
# Get free testnet USDC
# Visit: https://www.coinbase.com/faucets/base-sepolia-faucet

# Run gateway with testnet config
bun run start --config=examples/mcpay-passthrough-example.yaml
```

**Example Configs:**
- `examples/mcpay-passthrough-example.yaml` - Pure passthrough to MCPay servers
- `examples/mcpay-markup-example.yaml` - 25% markup on MCPay servers

---

## 📖 Further Reading

- **x402 Protocol**: https://developers.cloudflare.com/agents/x402/
- **x402 GitHub**: https://github.com/coinbase/x402
- **MCP Specification**: https://modelcontextprotocol.io
- **Base Sepolia Faucet**: https://www.coinbase.com/faucets/base-sepolia-faucet
- **MCPay Paid Servers**: https://mcpay.tech/servers
- **x402 MCP Server Guide**: https://docs.cdp.coinbase.com/x402/mcp-server.md

---

## 🤝 Support

Found a bug? Have a feature request?

- GitHub Issues: https://github.com/elizaOS/mcp-gateway/issues
- Documentation: https://github.com/elizaOS/mcp-gateway#readme
