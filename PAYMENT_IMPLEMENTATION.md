# Payment Gating Implementation Summary

## ✅ Implementation Complete

The MCP Gateway now supports **payment gating and monetization** using both x402 blockchain payments and ELIZA API keys.

---

## 📋 What Was Implemented

### 1. **Type Definitions** (`src/types/index.ts`)
- ✅ `PaymentConfigSchema` - Gateway-level payment config
- ✅ `ToolPricingSchema` - Per-tool pricing config
- ✅ `ToolConfigSchema` - Tool-level configuration
- ✅ `ApiKeyConfigSchema` - API key tier configuration
- ✅ Updated `McpServerConfigSchema` with `tools` and `defaultPricing`
- ✅ Updated `GatewayConfigSchema` with `payment` field

### 2. **Payment Middleware** (`src/core/payment-middleware.ts`)
- ✅ Dual authentication: x402 + ELIZA API keys
- ✅ API key tier verification with caching
- ✅ x402 payment verification via facilitator
- ✅ Tiered pricing support (premium/basic/free)
- ✅ 402 Payment Required response generation
- ✅ USDC contract address mapping for multiple networks
- ✅ Dollar amount → atomic units conversion

### 3. **Gateway Integration** (`src/core/gateway.ts`)
- ✅ Payment middleware initialization
- ✅ Payment verification in `CallTool` handler
- ✅ 402 error responses with payment requirements
- ✅ Payment logging and statistics

### 4. **Dependencies** (`package.json`)
- ✅ `x402`: ^0.6.5 (payment protocol)
- ✅ `viem`: ^2.21.45 (blockchain interaction)

### 5. **Configuration Examples**
- ✅ `examples/paid-config.yaml` - Full YAML example
- ✅ `examples/paid-config.json` - JSON format example

### 6. **Documentation**
- ✅ `README.md` - Complete payment documentation section
- ✅ `CLAUDE.md` - Developer-focused payment system docs
- ✅ `PAYMENT_IMPLEMENTATION.md` - This summary

---

## 🚀 Features

### Payment Methods
1. **x402 Blockchain Payments**
   - Gasless transactions via facilitator
   - Instant settlement (2 seconds)
   - $0.001 minimum payment
   - No account or credit card needed
   - Supports: Base, Base Sepolia, Ethereum, Optimism, Polygon

2. **ELIZA API Keys**
   - Traditional API key authentication
   - Tiered pricing (premium/basic/developer)
   - Rate limiting per tier
   - Header format: `X-ELIZA-API-KEY` or `Authorization: Bearer <key>`

### Pricing Strategies
- **Free Tools**: `pricing: { free: true }`
- **x402 Only**: `pricing: { x402: "$0.01" }`
- **Tiered Pricing**: Different prices per API key tier
- **Server-wide Defaults**: `defaultPricing` for all tools
- **Per-tool Overrides**: Individual tool pricing configs

---

## 📖 Usage Examples

### Configuration

```yaml
payment:
  enabled: true
  recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
  network: "base-sepolia"
  facilitator: "https://x402.org/facilitator"

  apiKeys:
    - key: "eliza_premium_abc123"
      tier: "premium"
      rateLimit: 10000
    - key: "eliza_basic_xyz789"
      tier: "basic"
      rateLimit: 100

servers:
  - name: "context7"
    command: "npx"
    args: ["-y", "@upstash/context7-mcp"]
    namespace: "docs"

    tools:
      # Free tool
      - name: "resolve-library-id"
        pricing:
          free: true

      # Paid tool with tiered pricing
      - name: "get-library-docs"
        pricing:
          x402: "$0.01"
          apiKeyTiers:
            basic: "$0.005"
            premium: "free"
```

### Client Integration

**x402 Payment (JavaScript/TypeScript):**
```typescript
import { privateKeyToAccount } from 'viem/accounts';
import { withPaymentInterceptor } from 'x402-axios';
import axios from 'axios';

const account = privateKeyToAccount('0xYourPrivateKey');
const client = withPaymentInterceptor(axios.create(), account);

// Payments happen automatically on 402 responses
const response = await client.post('/mcp/tool', { args: {} });
```

**API Key (Any Language):**
```bash
curl -H "X-ELIZA-API-KEY: eliza_premium_abc123" \
     -X POST http://gateway/mcp/tool
```

### Revenue Models

**1. Freemium:**
```yaml
tools:
  - name: "basic-search"
    pricing:
      free: true
  - name: "advanced-search"
    pricing:
      x402: "$0.05"
```

**2. Pay-Per-Use:**
```yaml
defaultPricing:
  x402: "$0.01"
```

**3. Subscription via API Keys:**
```yaml
apiKeys:
  - key: "monthly_subscriber"
    tier: "subscriber"
defaultPricing:
  apiKeyTiers:
    subscriber: "free"
```

---

## 🧪 Testing

### Quick Start
```bash
# Install dependencies
bun install

# Run with paid config (testnet)
bun run start --config=examples/paid-config.yaml
```

### Get Testnet USDC
1. Visit [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-sepolia-faucet)
2. Get free testnet USDC for testing
3. Use testnet private key in x402 client

### Test with API Keys
```bash
# Set API key in environment
export ELIZA_API_KEY="eliza_premium_abc123"

# Or pass in Claude Desktop config
{
  "mcpServers": {
    "paid-gateway": {
      "command": "bun",
      "args": ["run", "start", "--config=examples/paid-config.yaml"],
      "env": {
        "ELIZA_API_KEY": "eliza_premium_abc123"
      }
    }
  }
}
```

### Debugging
```yaml
# Enable debug logging
settings:
  logLevel: "debug"
```

Check logs for:
- `[INFO] Payment middleware enabled`
- `[INFO] Payment verified for <tool>: method=apiKey, amount=$0.00`
- `[WARN] Payment required for tool '<tool>': Payment required: $0.01`

---

## 🔧 Technical Details

### Payment Flow
```
1. Client calls tool
   ↓
2. Gateway receives request
   ↓
3. PaymentMiddleware.verifyPayment()
   ├─ Check if tool requires payment
   ├─ Try API key verification (fast)
   │  └─ Cache lookup → tier check → pricing
   ├─ Try x402 verification (blockchain)
   │  └─ Decode header → verify with facilitator
   └─ Decision: authorized or 402 error
   ↓
4. If authorized:
   → Route to downstream server
5. If unauthorized:
   → Return 402 Payment Required with payment details
```

### Key Files
- `src/types/index.ts` - Type definitions (lines 40-64, 78-79, 87, 101-104)
- `src/core/payment-middleware.ts` - Payment logic (350 lines)
- `src/core/gateway.ts` - Integration (lines 15, 23, 35-40, 82-124)
- `examples/paid-config.yaml` - Example configuration
- `examples/paid-config.json` - JSON format example

### Networks Supported
- **base** (mainnet): USDC at 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
- **base-sepolia** (testnet): USDC at 0x036CbD53842c5426634e7929541eC2318f3dCF7e
- **ethereum**: USDC at 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
- **optimism**: USDC at 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85
- **polygon**: USDC at 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359

---

## 📚 Learn More

- **x402 Protocol**: https://developers.cloudflare.com/agents/x402/
- **x402 GitHub**: https://github.com/coinbase/x402
- **MCP Specification**: https://modelcontextprotocol.io
- **Base Sepolia Faucet**: https://www.coinbase.com/faucets/base-sepolia-faucet

---

## 🎯 Next Steps

Ready to monetize your MCP gateway! Here's what you can do:

1. **Configure Payment**: Edit `examples/paid-config.yaml` with your recipient address
2. **Generate API Keys**: Create unique keys for your users
3. **Set Pricing**: Define per-tool or server-wide pricing
4. **Test on Testnet**: Use base-sepolia network for testing
5. **Go Live**: Switch to `network: "base"` for mainnet

**Example Production Setup:**
```yaml
payment:
  enabled: true
  recipient: "0xYourMainnetAddress"
  network: "base"  # Mainnet
  apiKeys:
    - key: "eliza_prod_premium_xxx"
      tier: "premium"
      rateLimit: 10000

servers:
  - name: "production-server"
    defaultPricing:
      x402: "$0.05"  # $0.05 per tool call
      apiKeyTiers:
        premium: "$0.01"  # Premium gets 80% discount
```

---

## ✨ Benefits

- **Monetize**: Earn revenue from your MCP gateway
- **Flexible**: Choose between blockchain or API keys
- **Tiered**: Different pricing for different users
- **Instant**: Payments settle in 2 seconds
- **Low Fees**: No credit card fees, minimal gas costs
- **Easy**: One config file to set up everything

🎉 **Your gateway is now a revenue-generating API!**