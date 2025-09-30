import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { ServerManager } from './server-manager';
import { GatewayRegistry } from './registry';
import { PaymentMiddleware } from './payment-middleware';
import { X402PaymentClient } from './x402-client';
import { type GatewayConfig } from '../types/index';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export class GatewayServer {
  private server: Server;
  private serverManager: ServerManager;
  private registry: GatewayRegistry;
  private paymentMiddleware?: PaymentMiddleware;
  private x402Client?: X402PaymentClient;
  private config: GatewayConfig;
  private logger: Console;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: GatewayConfig, logger: Console = console) {
    this.config = config;
    this.logger = logger;
    this.serverManager = new ServerManager(logger);
    this.registry = new GatewayRegistry(config, logger);

    // Initialize payment middleware if enabled
    if (config.payment?.enabled) {
      this.paymentMiddleware = new PaymentMiddleware(config, logger);
      this.logger.info('Payment middleware enabled');
      const stats = this.paymentMiddleware.getStats();
      this.logger.info(`Payment config: network=${stats.network}, recipient=${stats.recipient}, apiKeys=${stats.apiKeys}`);
    }

    // Initialize x402 payment client for outbound payments
    if (config.payment?.outboundWallet) {
      try {
        this.x402Client = new X402PaymentClient(config, logger);
        this.logger.info(`X402 payment client enabled for outbound payments: ${this.x402Client.getWalletAddress()}`);
      } catch (error) {
        this.logger.error(`Failed to initialize x402 payment client: ${error}`);
      }
    }

    this.server = new Server(
      {
        name: config.name,
        version: config.version,
        description: config.description
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.registry.getTools().map(tool => ({
        name: tool.name,
        description: tool.description || `Tool from ${tool.serverId}${tool.namespace ? ` (${tool.namespace})` : ''}`,
        inputSchema: tool.inputSchema
      }));

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = this.registry.findTool(name);
      if (!tool) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Tool '${name}' not found`
        );
      }

      // Payment verification
      if (this.paymentMiddleware) {
        try {
          // Extract headers from request metadata (MCP clients can pass custom metadata)
          const headers = (request.params as any)._meta?.headers || {};

          const verification = await this.paymentMiddleware.verifyPayment(
            tool.originalName,
            tool.serverId,
            headers
          );

          if (!verification.authorized) {
            // Generate 402 Payment Required response
            const paymentRequirements = this.paymentMiddleware.generatePaymentRequiredResponse(
              tool.originalName,
              tool.serverId
            );

            this.logger.warn(`Payment required for tool '${name}': ${verification.error}`);

            throw new McpError(
              ErrorCode.InvalidRequest,
              `Payment Required: ${JSON.stringify(paymentRequirements)}`
            );
          }

          // Log successful payment
          this.logger.info(
            `Payment verified for ${name}: method=${verification.pricing?.method}, amount=${verification.pricing?.amount}`
          );

        } catch (error) {
          if (error instanceof McpError) {
            throw error;
          }
          this.logger.error(`Payment verification error for ${name}: ${error}`);
          throw new McpError(
            ErrorCode.InternalError,
            `Payment verification failed: ${error}`
          );
        }
      }

      const connection = this.serverManager.getConnection(tool.serverId);
      if (!connection || connection.status !== 'connected') {
        throw new McpError(
          ErrorCode.InternalError,
          `Server '${tool.serverId}' is not connected`
        );
      }

      try {
        const response = await connection.client!.callTool({
          name: tool.originalName,
          arguments: args || {}
        });

        return response;
      } catch (error) {
        this.logger.error(`Tool call failed for ${name}: ${error}`);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error}`
        );
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = this.registry.getResources().map(resource => ({
        uri: resource.uri,
        name: resource.name || resource.originalUri,
        description: resource.description || `Resource from ${resource.serverId}${resource.namespace ? ` (${resource.namespace})` : ''}`,
        mimeType: resource.mimeType
      }));

      return { resources };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      
      const resource = this.registry.findResource(uri);
      if (!resource) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Resource '${uri}' not found`
        );
      }

      const connection = this.serverManager.getConnection(resource.serverId);
      if (!connection || connection.status !== 'connected') {
        throw new McpError(
          ErrorCode.InternalError,
          `Server '${resource.serverId}' is not connected`
        );
      }

      try {
        const response = await connection.client!.readResource({
          uri: resource.originalUri
        });

        return response;
      } catch (error) {
        this.logger.error(`Resource read failed for ${uri}: ${error}`);
        throw new McpError(
          ErrorCode.InternalError,
          `Resource read failed: ${error}`
        );
      }
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = this.registry.getPrompts().map(prompt => ({
        name: prompt.name,
        description: prompt.description || `Prompt from ${prompt.serverId}${prompt.namespace ? ` (${prompt.namespace})` : ''}`,
        arguments: prompt.arguments
      }));

      return { prompts };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      const prompt = this.registry.findPrompt(name);
      if (!prompt) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Prompt '${name}' not found`
        );
      }

      const connection = this.serverManager.getConnection(prompt.serverId);
      if (!connection || connection.status !== 'connected') {
        throw new McpError(
          ErrorCode.InternalError,
          `Server '${prompt.serverId}' is not connected`
        );
      }

      try {
        const response = await connection.client!.getPrompt({
          name: prompt.originalName,
          arguments: args || {}
        });

        return response;
      } catch (error) {
        this.logger.error(`Prompt get failed for ${name}: ${error}`);
        throw new McpError(
          ErrorCode.InternalError,
          `Prompt get failed: ${error}`
        );
      }
    });
  }

  async start(): Promise<void> {
    try {
      this.logger.info(`Starting MCP Gateway Server: ${this.config.name} v${this.config.version}`);

      await this.serverManager.initializeServers(this.config.servers);

      const connectedServers = this.serverManager.getConnectedServers();
      await this.registry.refresh(connectedServers);

      const healthCheckInterval = this.config.settings?.healthCheckInterval;
      if (healthCheckInterval && healthCheckInterval > 0) {
        this.healthCheckInterval = setInterval(async () => {
          await this.performHealthCheck();
        }, healthCheckInterval);
      }

      this.logger.info('MCP Gateway Server started successfully');
      this.logStatus();
    } catch (error) {
      this.logger.error(`Failed to start MCP Gateway Server: ${error}`);
      throw error;
    }
  }

  async connect(transport: StdioServerTransport): Promise<void> {
    await this.server.connect(transport);
  }

  private async performHealthCheck(): Promise<void> {
    try {
      this.logger.debug('Performing health check...');
      await this.serverManager.performHealthChecks();
      const connectedServers = this.serverManager.getConnectedServers();
      await this.registry.refresh(connectedServers);
      this.logger.debug('Health check completed');
    } catch (error) {
      this.logger.error(`Health check failed: ${error}`);
    }
  }

  private logStatus(): void {
    const connectionStatus = this.serverManager.getConnectionStatus();
    const registryStats = this.registry.getStats();

    this.logger.info('=== MCP Gateway Status ===');
    this.logger.info(`Server Connections: ${connectionStatus.connected}/${connectionStatus.total} active`);
    this.logger.info(`- Connected: ${connectionStatus.connected}`);
    this.logger.info(`- Connecting: ${connectionStatus.connecting}`);
    this.logger.info(`- Disconnected: ${connectionStatus.disconnected}`);
    this.logger.info(`- Error: ${connectionStatus.error}`);
    
    this.logger.info('Aggregated Capabilities:');
    this.logger.info(`- Tools: ${registryStats.tools}`);
    this.logger.info(`- Resources: ${registryStats.resources}`);
    this.logger.info(`- Prompts: ${registryStats.prompts}`);

    if (Object.keys(registryStats.toolsByServer).length > 0) {
      this.logger.info('Tools by Server:');
      for (const [serverId, count] of Object.entries(registryStats.toolsByServer)) {
        this.logger.info(`  - ${serverId}: ${count} tools`);
      }
    }
  }

  getStatus() {
    return {
      connections: this.serverManager.getConnectionStatus(),
      registry: this.registry.getStats(),
      config: this.config
    };
  }

  async refreshRegistry(): Promise<void> {
    const connectedServers = this.serverManager.getConnectedServers();
    await this.registry.refresh(connectedServers);
    this.logger.info('Registry manually refreshed');
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping MCP Gateway Server...');
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    await this.serverManager.closeAll();
    await this.server.close();
    this.logger.info('MCP Gateway Server stopped');
  }
}


