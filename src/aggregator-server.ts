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
import { type GatewayConfig } from './types.js';

export class GatewayServer {
  private server: Server;
  private serverManager: ServerManager;
  private registry: GatewayRegistry;
  private config: GatewayConfig;
  private logger: Console;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: GatewayConfig, logger: Console = console) {
    this.config = config;
    this.logger = logger;
    this.serverManager = new ServerManager(logger);
    this.registry = new GatewayRegistry(config, logger);

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

      return { tools };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
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

    // Close the main server
    await this.server.close();

    this.logger.info('MCP Gateway Server stopped');
  }
}
