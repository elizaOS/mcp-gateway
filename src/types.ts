import { z } from 'zod';

// Transport-specific configuration schemas
const StdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().describe('Command to execute the MCP server'),
  args: z.array(z.string()).optional().describe('Arguments for the command'),
  env: z.record(z.string()).optional().describe('Environment variables'),
  cwd: z.string().optional().describe('Working directory')
});

const HttpTransportSchema = z.object({
  type: z.literal('http'),
  url: z.string().url().describe('HTTP endpoint URL for the MCP server'),
  headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
  apiKey: z.string().optional().describe('API key for authentication')
});

const SseTransportSchema = z.object({
  type: z.literal('sse'),
  sseUrl: z.string().url().describe('Server-Sent Events URL for receiving messages'),
  postUrl: z.string().url().describe('HTTP POST URL for sending messages'),
  headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
  apiKey: z.string().optional().describe('API key for authentication')
});

const WebSocketTransportSchema = z.object({
  type: z.literal('websocket'),
  url: z.string().url().describe('WebSocket URL'),
  headers: z.record(z.string()).optional().describe('Additional headers'),
  apiKey: z.string().optional().describe('API key for authentication')
});

const TransportConfigSchema = z.discriminatedUnion('type', [
  StdioTransportSchema,
  HttpTransportSchema,
  SseTransportSchema,
  WebSocketTransportSchema
]);

// x402 middleware configuration schemas
const X402WalletSchema = z.object({
  type: z.enum(['evm', 'svm', 'multi']).describe('Wallet type to use for x402 payments'),
  network: z.string().describe('Network identifier, e.g. base, base-sepolia, solana-devnet'),
  privateKeyEnv: z.string().describe('Environment variable name containing the private key')
});

const X402MiddlewareSchema = z.object({
  enabled: z.boolean().default(true).describe('Enable x402 payment middleware for this server'),
  wallet: X402WalletSchema.describe('Wallet configuration for creating payment headers'),
  maxValueMicroUSDC: z.string().optional().describe('Maximum payment per request in micro-USDC (default 100000 = $0.10)')
});

// Paywall enforcement configuration schemas (for inbound requests)
const PaywallWalletSchema = z.object({
  type: z.enum(['evm']).describe('Wallet type for paywall enforcement (only evm supported for now)'),
  network: z.enum(['base', 'base-sepolia']).describe('Network for paywall enforcement'),
  privateKeyEnv: z.string().describe('Environment variable name containing the private key for paywall enforcement')
});

const PaywallPricingSchema = z.object({
  defaultPriceMicroUSDC: z.string().optional().describe('Default price in micro-USDC if no specific rule matches'),
  perTool: z.record(z.string(), z.string()).optional().describe('Per-tool pricing: toolName -> micro-USDC string'),
  perResource: z.record(z.string(), z.string()).optional().describe('Per-resource pricing: uri -> micro-USDC string'),
  perPrompt: z.record(z.string(), z.string()).optional().describe('Per-prompt pricing: promptName -> micro-USDC string')
}).refine((data) => {
  // Validate that all pricing values are valid non-negative bigint strings
  const validatePriceString = (priceStr: string): boolean => {
    try {
      const price = BigInt(priceStr);
      return price >= 0n;
    } catch {
      return false;
    }
  };

  if (data.defaultPriceMicroUSDC && !validatePriceString(data.defaultPriceMicroUSDC)) {
    return false;
  }

  if (data.perTool) {
    for (const price of Object.values(data.perTool)) {
      if (!validatePriceString(price)) return false;
    }
  }

  if (data.perResource) {
    for (const price of Object.values(data.perResource)) {
      if (!validatePriceString(price)) return false;
    }
  }

  if (data.perPrompt) {
    for (const price of Object.values(data.perPrompt)) {
      if (!validatePriceString(price)) return false;
    }
  }

  return true;
}, {
  message: 'All pricing values must be valid non-negative numeric strings'
});

const PaywallPolicySchema = z.object({
  freeList: z.boolean().default(true).describe('Allow listing tools/resources/prompts without payment'),
  requireForCalls: z.boolean().default(true).describe('Require payment for actual tool calls, resource reads, and prompt gets')
});

const PaywallConfigSchema = z.object({
  enabled: z.boolean().default(false).describe('Enable paywall enforcement for this server'),
  wallet: PaywallWalletSchema.describe('Wallet configuration for paywall enforcement'),
  maxValueMicroUSDC: z.string().optional().describe('Maximum payment per request in micro-USDC (default 100000 = $0.10)'),
  pricing: PaywallPricingSchema.describe('Pricing configuration for tools, resources, and prompts'),
  policy: PaywallPolicySchema.optional().default({}).describe('Policy configuration for paywall enforcement')
});

// Configuration schema for individual MCP servers
export const McpServerConfigSchema = z.object({
  name: z.string().describe('Unique name for this server'),
  transport: TransportConfigSchema.optional().describe('Transport configuration (defaults to stdio)'),
  // Legacy fields for backward compatibility
  command: z.string().optional().describe('Command to execute (legacy - use transport.command)'),
  args: z.array(z.string()).optional().describe('Arguments (legacy - use transport.args)'),
  env: z.record(z.string()).optional().describe('Environment variables (legacy - use transport.env)'),
  cwd: z.string().optional().describe('Working directory (legacy - use transport.cwd)'),
  namespace: z.string().optional().describe('Optional namespace prefix for tools/resources'),
  enabled: z.boolean().default(true).describe('Whether this server is enabled'),
  timeout: z.number().default(30000).describe('Connection timeout in milliseconds'),
  retryAttempts: z.number().default(3).describe('Number of retry attempts on failure'),
  retryDelay: z.number().default(1000).describe('Delay between retries in milliseconds'),
  // x402 middleware can be enabled as a boolean or configured with an object
  x402Middleware: z.union([z.boolean(), X402MiddlewareSchema]).optional().describe('Enable and configure x402 payment middleware'),
  // Paywall enforcement for inbound requests (independent of x402Middleware which is for outbound)
  paywall: PaywallConfigSchema.optional().describe('Enable and configure paywall enforcement for incoming client requests')
});

// Main gateway configuration
export const GatewayConfigSchema = z.object({
  name: z.string().default('MCP Gateway').describe('Name of the gateway server'),
  version: z.string().default('1.0.0').describe('Version of the gateway'),
  description: z.string().optional().describe('Description of the gateway'),
  servers: z.array(McpServerConfigSchema).describe('List of MCP servers to aggregate'),
  settings: z.object({
    enableToolConflictResolution: z.boolean().default(true).describe('Whether to resolve tool name conflicts'),
    enableResourceConflictResolution: z.boolean().default(true).describe('Whether to resolve resource URI conflicts'),
    enablePromptConflictResolution: z.boolean().default(true).describe('Whether to resolve prompt name conflicts'),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info').describe('Logging level'),
    maxConcurrentConnections: z.number().default(10).describe('Maximum concurrent server connections'),
    healthCheckInterval: z.number().default(60000).describe('Health check interval in milliseconds')
  }).optional().default({})
});

export type TransportConfig = z.infer<typeof TransportConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

// Runtime types for managing server connections
export interface ServerConnection {
  config: McpServerConfig;
  client: any; // Will be typed with MCP client when we implement
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastError?: Error | undefined;
  lastHealthCheck?: Date | undefined;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  } | undefined;
}

// Aggregated registry types
export interface AggregatedTool {
  name: string;
  originalName: string;
  serverId: string;
  namespace?: string | undefined;
  description?: string | undefined;
  inputSchema: object;
}

export interface AggregatedResource {
  uri: string;
  originalUri: string;
  serverId: string;
  namespace?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  mimeType?: string | undefined;
}

export interface AggregatedPrompt {
  name: string;
  originalName: string;
  serverId: string;
  namespace?: string | undefined;
  description?: string | undefined;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }> | undefined;
}

// Paywall-related runtime types
export interface VerifiedPaymentReceipt {
  paymentId: string;
  amount: bigint;
  network: string;
  recipient: string;
  timestamp: Date;
  txHash?: string;
}

export interface PaywallSession {
  sessionId: string;
  authorizedAmount: bigint;
  remainingBalance: bigint;
  receipts: VerifiedPaymentReceipt[];
  expiresAt: Date;
}

export interface PaywallStats {
  totalPayments: number;
  totalAmount: bigint;
  activeSessions: number;
  paymentsToday: number;
  averagePayment: bigint;
}
