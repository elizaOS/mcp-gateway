import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { TransportFactory } from '../transports/factory';
import { 
  type McpServerConfig, 
  type ServerConnection
} from '../types/index';

export class ServerManager {
  private connections = new Map<string, ServerConnection>();
  private logger: Console;

  constructor(logger: Console = console) {
    this.logger = logger;
  }

  /**
   * Initialize connections to all configured servers
   */
  async initializeServers(serverConfigs: McpServerConfig[]): Promise<void> {
    const enabledServers = serverConfigs.filter(config => config.enabled);
    
    this.logger.info(`Initializing ${enabledServers.length} servers...`);

    // Initialize connections in parallel with limited concurrency
    const initPromises = enabledServers.map(config => this.initializeServer(config));
    const results = await Promise.allSettled(initPromises);

    // Log results
    results.forEach((result, index) => {
      const serverName = enabledServers[index]?.name;
      if (result.status === 'rejected') {
        this.logger.error(`Failed to initialize server ${serverName}: ${result.reason}`);
      } else {
        this.logger.info(`Successfully initialized server ${serverName}`);
      }
    });

    const successfulConnections = results.filter(r => r.status === 'fulfilled').length;
    this.logger.info(`Initialized ${successfulConnections}/${enabledServers.length} servers successfully`);
  }

  /**
   * Initialize a single server connection
   */
  private async initializeServer(config: McpServerConfig): Promise<void> {
    const connection: ServerConnection = {
      config,
      client: null,
      status: 'connecting'
    };

    this.connections.set(config.name, connection);

    try {
      // Validate transport configuration
      const configErrors = TransportFactory.validateConfig(config);
      if (configErrors.length > 0) {
        throw new Error(`Configuration validation failed: ${configErrors.join(', ')}`);
      }

      // Create transport using factory
      const transport = TransportFactory.create(config);
      const transportName = TransportFactory.getTransportDisplayName(config);
      
      this.logger.debug(`Creating ${transportName} transport for server: ${config.name}`);

      // Create client
      const client = new Client({
        name: `mcp-aggregator-client-${config.name}`,
        version: '1.0.0'
      }, {
        capabilities: {
          roots: {},
          sampling: {}
        }
      });

      // Connect
      await client.connect(transport);
      
      connection.client = client;
      connection.status = 'connected';
      connection.lastHealthCheck = new Date();

      // Get server capabilities
      try {
        const capabilities = await this.getServerCapabilities(client);
        connection.capabilities = capabilities;
      } catch (error) {
        this.logger.warn(`Failed to get capabilities for server ${config.name}: ${error}`);
      }

      this.logger.debug(`Connected to server: ${config.name} via ${TransportFactory.getTransportDisplayName(config)}`);
      
    } catch (error) {
      connection.status = 'error';
      connection.lastError = error as Error;
      this.logger.error(`Failed to connect to server ${config.name}: ${error}`);
      throw error;
    }
  }

  /**
   * Get capabilities of a connected server
   */
  private async getServerCapabilities(client: Client): Promise<{
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  }> {
    const capabilities: { tools?: boolean; resources?: boolean; prompts?: boolean } = {};

    try {
      const tools = await client.listTools();
      capabilities.tools = !!(tools.tools && tools.tools.length > 0);
    } catch {
      capabilities.tools = false;
    }

    try {
      const resources = await client.listResources();
      capabilities.resources = !!(resources.resources && resources.resources.length > 0);
    } catch {
      capabilities.resources = false;
    }

    try {
      const prompts = await client.listPrompts();
      capabilities.prompts = !!(prompts.prompts && prompts.prompts.length > 0);
    } catch {
      capabilities.prompts = false;
    }

    return capabilities;
    }

  /**
   * Get all connected servers
   */
  getConnectedServers(): Map<string, ServerConnection> {
    return new Map(Array.from(this.connections.entries()).filter(
      ([, connection]) => connection.status === 'connected'
    ));
  }

  /**
   * Get a specific server connection
   */
  getConnection(serverId: string): ServerConnection | undefined {
    return this.connections.get(serverId);
  }

  /**
   * Close all server connections
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.connections.values())
      .filter(conn => conn.client && conn.status === 'connected')
      .map(async conn => {
        try {
          await conn.client!.close();
          conn.status = 'disconnected';
        } catch (error) {
          this.logger.error(`Error closing connection to ${conn.config.name}: ${error}`);
        }
      });

    await Promise.allSettled(closePromises);
    this.connections.clear();
  }

  /**
   * Perform health checks on all connected servers
   */
  async performHealthChecks(): Promise<void> {
    const connectedServers = this.getConnectedServers();
    
    for (const [serverId, connection] of connectedServers) {
      try {
        // Simple health check by listing tools
        await connection.client!.listTools();
        connection.lastHealthCheck = new Date();
        connection.status = 'connected';
        delete connection.lastError;
      } catch (error) {
        this.logger.warn(`Health check failed for server ${serverId}: ${error}`);
        connection.status = 'error';
        connection.lastError = error as Error;
      }
    }
  }

  /**
   * Get connection status summary
   */
  getConnectionStatus(): {
    total: number;
    connected: number;
    connecting: number;
    disconnected: number;
    error: number;
  } {
    const status = {
      total: this.connections.size,
      connected: 0,
      connecting: 0,
      disconnected: 0,
      error: 0
    } as { total: number; connected: number; connecting: number; disconnected: number; error: number };

    for (const connection of this.connections.values()) {
      status[connection.status]++;
    }

    return status;
  }
}


