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

import { ServerManager } from './server-manager.js';
import { GatewayRegistry } from './registry.js';
import { type GatewayConfig, type McpServerConfig } from './types.js';
import { PaywallGuard } from './paywall-guard.js';

export class GatewayServer {
  private server: Server;
  private serverManager: ServerManager;
  private registry: GatewayRegistry;
  private config: GatewayConfig;
  private logger: Console;
  private healthCheckInterval?: NodeJS.Timeout;
  private paywallGuard: PaywallGuard;
  private currentSessionId: string;

  constructor(config: GatewayConfig, logger: Console = console) {
    this.config = config;
    this.logger = logger;
    this.serverManager = new ServerManager(logger);
    this.registry = new GatewayRegistry(config, logger);
    this.paywallGuard = new PaywallGuard(logger);
    this.currentSessionId = PaywallGuard.generateSessionId('gateway-session');

    // Initialize MCP server
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

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.registry.getTools().map(tool => ({
        name: tool.name,
        description: tool.description || `Tool from ${tool.serverId}${tool.namespace ? ` (${tool.namespace})` : ''}`,
        inputSchema: tool.inputSchema
      }));

      // Add special paywall tools if any server has paywall enabled
      const paywallTools = this.getPaywallTools();
      tools.push(...paywallTools);

      return { tools };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      // Handle special paywall tools
      if (name.startsWith('gateway:paywall:')) {
        return await this.handlePaywallTool(name, args || {});
      }
      
      const tool = this.registry.findTool(name);
      if (!tool) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Tool '${name}' not found`
        );
      }

      const connection = this.serverManager.getConnection(tool.serverId);
      if (!connection || connection.status !== 'connected') {
        throw new McpError(
          ErrorCode.InternalError,
          `Server '${tool.serverId}' is not connected`
        );
      }

      // Check paywall enforcement
      const serverConfig = this.config.servers.find(s => s.name === tool.serverId);
      if (serverConfig) {
        const requiredPrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', tool.originalName, serverConfig);
        if (requiredPrice !== null && requiredPrice > 0n) {
          const isAuthorized = await this.paywallGuard.isSessionAuthorized(this.currentSessionId, requiredPrice);
          if (!isAuthorized) {
            throw this.createPaymentRequiredError('tool', tool.originalName, requiredPrice, serverConfig);
          }
          
          // Deduct the amount from session balance
          await this.paywallGuard.deductFromSession(this.currentSessionId, requiredPrice);
        }
      }

      try {
        // Forward the call to the original server with the original tool name
        const response = await connection.client.callTool({
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

    // List resources handler
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = this.registry.getResources().map(resource => ({
        uri: resource.uri,
        name: resource.name || resource.originalUri,
        description: resource.description || `Resource from ${resource.serverId}${resource.namespace ? ` (${resource.namespace})` : ''}`,
        mimeType: resource.mimeType
      }));

      return { resources };
    });

    // Read resource handler
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

      // Check paywall enforcement
      const serverConfig = this.config.servers.find(s => s.name === resource.serverId);
      if (serverConfig) {
        const requiredPrice = PaywallGuard.getRequiredPriceMicroUSDC('resource', resource.originalUri, serverConfig);
        if (requiredPrice !== null && requiredPrice > 0n) {
          const isAuthorized = await this.paywallGuard.isSessionAuthorized(this.currentSessionId, requiredPrice);
          if (!isAuthorized) {
            throw this.createPaymentRequiredError('resource', resource.originalUri, requiredPrice, serverConfig);
          }
          
          // Deduct the amount from session balance
          await this.paywallGuard.deductFromSession(this.currentSessionId, requiredPrice);
        }
      }

      try {
        // Forward the call to the original server with the original URI
        const response = await connection.client.readResource({
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

    // List prompts handler
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = this.registry.getPrompts().map(prompt => ({
        name: prompt.name,
        description: prompt.description || `Prompt from ${prompt.serverId}${prompt.namespace ? ` (${prompt.namespace})` : ''}`,
        arguments: prompt.arguments
      }));

      return { prompts };
    });

    // Get prompt handler
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

      // Check paywall enforcement
      const serverConfig = this.config.servers.find(s => s.name === prompt.serverId);
      if (serverConfig) {
        const requiredPrice = PaywallGuard.getRequiredPriceMicroUSDC('prompt', prompt.originalName, serverConfig);
        if (requiredPrice !== null && requiredPrice > 0n) {
          const isAuthorized = await this.paywallGuard.isSessionAuthorized(this.currentSessionId, requiredPrice);
          if (!isAuthorized) {
            throw this.createPaymentRequiredError('prompt', prompt.originalName, requiredPrice, serverConfig);
          }
          
          // Deduct the amount from session balance
          await this.paywallGuard.deductFromSession(this.currentSessionId, requiredPrice);
        }
      }

      try {
        // Forward the call to the original server with the original prompt name
        const response = await connection.client.getPrompt({
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

  /**
   * Get special paywall tools if any server has paywall enabled
   */
  private getPaywallTools(): Array<{ name: string; description: string; inputSchema: object }> {
    const hasPaywallServers = this.config.servers.some(server => PaywallGuard.isPaywallEnabled(server));
    if (!hasPaywallServers) {
      return [];
    }

    return [
      {
        name: 'gateway:paywall:get-pricing',
        description: 'Get pricing information for all paywall-enabled servers and their tools/resources/prompts',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'gateway:paywall:authorize',
        description: 'Authorize payment for paywall-enabled services using x402 payment or token',
        inputSchema: {
          type: 'object',
          properties: {
            xPayment: {
              type: 'string',
              description: 'Raw x402 payment envelope (optional if token is provided)'
            },
            token: {
              type: 'string', 
              description: 'JWT token from HTTP /pay endpoint (optional if xPayment is provided)'
            },
            sessionId: {
              type: 'string',
              description: 'Optional session ID (defaults to current session)'
            }
          },
          additionalProperties: false
        }
      }
    ];
  }

  /**
   * Handle special paywall tools
   */
  private async handlePaywallTool(name: string, args: Record<string, any>): Promise<any> {
    switch (name) {
      case 'gateway:paywall:get-pricing':
        return this.handleGetPricing();
        
      case 'gateway:paywall:authorize':
        return this.handleAuthorizePayment(args);
        
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown paywall tool: ${name}`
        );
    }
  }

  /**
   * Handle get-pricing tool
   */
  private handleGetPricing(): any {
    const pricing: Record<string, any> = {};
    
    for (const serverConfig of this.config.servers) {
      if (!PaywallGuard.isPaywallEnabled(serverConfig)) continue;
      
      const serverPricing: any = {
        enabled: true,
        maxValueMicroUSDC: PaywallGuard.getMaxValueMicroUSDC(serverConfig).toString(),
        network: serverConfig.paywall!.wallet.network,
        recipient: 'wallet-address-placeholder', // Would be derived from wallet in real implementation
        defaultPriceMicroUSDC: serverConfig.paywall!.pricing.defaultPriceMicroUSDC || '0',
        tools: {},
        resources: {},
        prompts: {}
      };

      // Add per-tool pricing
      if (serverConfig.paywall!.pricing.perTool) {
        serverPricing.tools = { ...serverConfig.paywall!.pricing.perTool };
      }

      // Add per-resource pricing
      if (serverConfig.paywall!.pricing.perResource) {
        serverPricing.resources = { ...serverConfig.paywall!.pricing.perResource };
      }

      // Add per-prompt pricing
      if (serverConfig.paywall!.pricing.perPrompt) {
        serverPricing.prompts = { ...serverConfig.paywall!.pricing.perPrompt };
      }

      pricing[serverConfig.name] = serverPricing;
    }

    return {
      content: [
        {
          type: 'text',
          text: `Paywall Pricing Information:\n\n${JSON.stringify(pricing, null, 2)}`
        }
      ]
    };
  }

  /**
   * Handle authorize payment tool
   */
  private async handleAuthorizePayment(args: Record<string, any>): Promise<any> {
    const { xPayment, token, sessionId } = args;
    const targetSessionId = sessionId || this.currentSessionId;

    if (!xPayment && !token) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Either xPayment or token must be provided'
      );
    }

    try {
      if (token) {
        // Handle JWT token from HTTP endpoint (placeholder implementation)
        throw new McpError(
          ErrorCode.InvalidParams,
          'Token-based authorization not yet implemented. Use xPayment instead.'
        );
      }

      if (xPayment) {
        // For now, use a simplified verification
        // In production, this would parse and verify the x402 payment properly
        const expectedAmount = 100000n; // 0.10 USDC as example
        const network = 'base-sepolia';
        const recipient = 'placeholder-recipient';

        const receipt = await this.paywallGuard.verifyX402Payment(
          xPayment,
          expectedAmount,
          network,
          recipient
        );

        await this.paywallGuard.recordAuthorization(targetSessionId, receipt, 0n);

        const remainingBalance = this.paywallGuard.getSessionBalance(targetSessionId);

        return {
          content: [
            {
              type: 'text',
              text: `Payment authorized successfully!\n\nSession: ${targetSessionId}\nAmount: ${receipt.amount} micro-USDC\nRemaining balance: ${remainingBalance} micro-USDC\n\nYou can now use paywall-protected tools, resources, and prompts.`
            }
          ]
        };
      }

    } catch (error) {
      this.logger.error(`Payment authorization failed: ${error}`);
      throw new McpError(
        ErrorCode.InternalError,
        `Payment authorization failed: ${error}`
      );
    }

    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid payment authorization request'
    );
  }

  /**
   * Create a payment required error with structured data
   */
  private createPaymentRequiredError(
    kind: 'tool' | 'resource' | 'prompt',
    id: string,
    requiredPrice: bigint,
    serverConfig: McpServerConfig
  ): McpError {
    const network = serverConfig.paywall!.wallet.network;
    const nonce = Date.now().toString();
    const howToPayUrl = `https://docs.x402.org/how-to-pay`; // Placeholder URL

    const errorData = {
      paymentRequired: true,
      kind,
      id,
      amountMicroUSDC: requiredPrice.toString(),
      network,
      token: 'USDC',
      recipient: 'wallet-address-placeholder', // Would be derived from wallet
      nonce,
      howToPay: howToPayUrl,
      instructions: `This ${kind} requires payment of ${requiredPrice} micro-USDC ($${(Number(requiredPrice) / 1_000_000).toFixed(6)}). Use the 'gateway:paywall:authorize' tool with an x402 payment, or visit ${howToPayUrl} for instructions.`,
      paywallTools: [
        'gateway:paywall:get-pricing - Get pricing information',
        'gateway:paywall:authorize - Authorize payment with x402 payment or token'
      ]
    };

    return new McpError(
      ErrorCode.InternalError, // Using InternalError as MCP doesn't have a PaymentRequired error code
      `Payment required for ${kind} '${id}': ${requiredPrice} micro-USDC`,
      errorData
    );
  }

  /**
   * Start the aggregator server
   */
  async start(): Promise<void> {
    try {
      this.logger.info(`Starting MCP Gateway Server: ${this.config.name} v${this.config.version}`);

      // Initialize all backend server connections
      await this.serverManager.initializeServers(this.config.servers);

      // Initial registry refresh
      const connectedServers = this.serverManager.getConnectedServers();
      await this.registry.refresh(connectedServers);

      // Setup health check interval if configured
      const healthCheckInterval = this.config.settings?.healthCheckInterval;
      if (healthCheckInterval && healthCheckInterval > 0) {
        this.healthCheckInterval = setInterval(async () => {
          await this.performHealthCheck();
        }, healthCheckInterval);
      }

      this.logger.info('MCP Gateway Server started successfully');
      
      // Log current status
      this.logStatus();

    } catch (error) {
      this.logger.error(`Failed to start MCP Gateway Server: ${error}`);
      throw error;
    }
  }

  /**
   * Connect to transport and start serving
   */
  async connect(transport: any): Promise<void> {
    await this.server.connect(transport);
  }

  /**
   * Perform health check and refresh registry if needed
   */
  private async performHealthCheck(): Promise<void> {
    try {
      this.logger.debug('Performing health check...');
      
      await this.serverManager.performHealthChecks();
      
      // Refresh registry after health check
      const connectedServers = this.serverManager.getConnectedServers();
      await this.registry.refresh(connectedServers);
      
      this.logger.debug('Health check completed');
    } catch (error) {
      this.logger.error(`Health check failed: ${error}`);
    }
  }

  /**
   * Log current server status
   */
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
    
    // Log x402 payment status
    const x402Servers = this.config.servers.filter(s => 
      s.enabled !== false && (
        typeof s.x402Middleware === 'boolean' ? s.x402Middleware : s.x402Middleware?.enabled
      )
    );
    
    if (x402Servers.length > 0) {
      this.logger.info(`x402 Payment Enabled Servers: ${x402Servers.length}`);
      for (const server of x402Servers) {
        const namespace = server.namespace ? `${server.namespace}.` : '';
        this.logger.info(`  - ${server.name}: Tools require payment (prefix: ${namespace}*)`);
      }
    }

    if (Object.keys(registryStats.toolsByServer).length > 0) {
      this.logger.info('Tools by Server:');
      for (const [serverId, count] of Object.entries(registryStats.toolsByServer)) {
        this.logger.info(`  - ${serverId}: ${count} tools`);
      }
    }
  }

  /**
   * Get current status for API/debugging
   */
  getStatus() {
    return {
      connections: this.serverManager.getConnectionStatus(),
      registry: this.registry.getStats(),
      config: this.config
    };
  }

  /**
   * Manually refresh the registry
   */
  async refreshRegistry(): Promise<void> {
    const connectedServers = this.serverManager.getConnectedServers();
    await this.registry.refresh(connectedServers);
    this.logger.info('Registry manually refreshed');
  }

  /**
   * Stop the aggregator server
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping MCP Gateway Server...');

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Close all server connections
    await this.serverManager.closeAll();

    // Clean up paywall guard
    this.paywallGuard.destroy();

    // Close the main server
    await this.server.close();

    this.logger.info('MCP Gateway Server stopped');
  }
}
