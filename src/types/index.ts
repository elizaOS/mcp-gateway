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
  retryDelay: z.number().default(1000)
});

export const GatewayConfigSchema = z.object({
  name: z.string().default('MCP Gateway'),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  servers: z.array(McpServerConfigSchema),
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


