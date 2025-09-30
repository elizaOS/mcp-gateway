import { z } from 'zod';

const StdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional()
});

const HttpTransportSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  apiKey: z.string().optional()
});

const SseTransportSchema = z.object({
  type: z.literal('sse'),
  sseUrl: z.string().url(),
  postUrl: z.string().url(),
  headers: z.record(z.string()).optional(),
  apiKey: z.string().optional()
});

const WebSocketTransportSchema = z.object({
  type: z.literal('websocket'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  apiKey: z.string().optional()
});

const TransportConfigSchema = z.discriminatedUnion('type', [
  StdioTransportSchema,
  HttpTransportSchema,
  SseTransportSchema,
  WebSocketTransportSchema
]);

// Payment configuration schemas
const ToolPricingSchema = z.object({
  free: z.boolean().optional(),
  x402: z.string().optional(),
  apiKeyTiers: z.record(z.string()).optional()
});

const ToolConfigSchema = z.object({
  name: z.string(),
  pricing: ToolPricingSchema.optional()
});

const ApiKeyConfigSchema = z.object({
  key: z.string(),
  tier: z.string(),
  rateLimit: z.number().optional()
});

const PaymentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  recipient: z.string().optional(),
  network: z.string().default('base-sepolia'),
  facilitator: z.string().default('https://x402.org/facilitator'),
  apiKeys: z.array(ApiKeyConfigSchema).optional(),
  // Outbound payment config (for paying downstream x402 APIs)
  outboundWallet: z.string().optional() // Private key for paying downstream
});

export const McpServerConfigSchema = z.object({
  name: z.string(),
  transport: TransportConfigSchema.optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  namespace: z.string().optional(),
  enabled: z.boolean().default(true),
  timeout: z.number().default(30000),
  retryAttempts: z.number().default(3),
  retryDelay: z.number().default(1000),
  tools: z.array(ToolConfigSchema).optional(),
  defaultPricing: ToolPricingSchema.optional(),
  // Outbound payment configuration
  paymentMode: z.enum(['passthrough', 'markup', 'absorb']).optional(),
  markup: z.string().optional(), // e.g., "20%" or "$0.01"
  paymentWallet: z.string().optional() // Override wallet for this server
});

export const GatewayConfigSchema = z.object({
  name: z.string().default('MCP Gateway'),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  servers: z.array(McpServerConfigSchema),
  payment: PaymentConfigSchema.optional(),
  settings: z.object({
    enableToolConflictResolution: z.boolean().default(true),
    enableResourceConflictResolution: z.boolean().default(true),
    enablePromptConflictResolution: z.boolean().default(true),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    maxConcurrentConnections: z.number().default(10),
    healthCheckInterval: z.number().default(60000)
  }).optional().default({})
});

export type TransportConfig = z.infer<typeof TransportConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type ToolPricing = z.infer<typeof ToolPricingSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type ApiKeyConfig = z.infer<typeof ApiKeyConfigSchema>;
export type PaymentConfig = z.infer<typeof PaymentConfigSchema>;

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export interface ServerConnection {
  config: McpServerConfig;
  client: Client | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastError?: Error;
  lastHealthCheck?: Date;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

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
    description?: string | undefined;
    required?: boolean | undefined;
  }> | undefined;
}


