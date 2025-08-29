import { readFileSync } from 'fs';
import { parse as parseYAML } from 'yaml';
import { GatewayConfigSchema, type GatewayConfig } from './types.js';

export class ConfigManager {
  private config: GatewayConfig | null = null;

  /**
   * Load configuration from a file (JSON or YAML)
   */
  loadFromFile(filePath: string): GatewayConfig {
    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      
      let rawConfig: unknown;
      
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        rawConfig = parseYAML(fileContent);
      } else {
        rawConfig = JSON.parse(fileContent);
      }

      this.config = GatewayConfigSchema.parse(rawConfig);
      this.validateConfig(this.config);
      
      return this.config;
    } catch (error) {
      throw new Error(`Failed to load config from ${filePath}: ${error}`);
    }
  }

  /**
   * Load configuration from environment variables and defaults
   */
  loadFromEnv(): GatewayConfig {
    const rawConfig = {
      name: process.env.MCP_GATEWAY_NAME || 'Eliza MCP Gateway',
      version: process.env.MCP_GATEWAY_VERSION || '1.0.0',
      description: process.env.MCP_GATEWAY_DESCRIPTION,
      servers: this.parseServersFromEnv(),
      settings: {
        enableToolConflictResolution: process.env.MCP_ENABLE_TOOL_CONFLICT_RESOLUTION !== 'false',
        enableResourceConflictResolution: process.env.MCP_ENABLE_RESOURCE_CONFLICT_RESOLUTION !== 'false',
        enablePromptConflictResolution: process.env.MCP_ENABLE_PROMPT_CONFLICT_RESOLUTION !== 'false',
        logLevel: (process.env.MCP_LOG_LEVEL as any) || 'info',
        maxConcurrentConnections: parseInt(process.env.MCP_MAX_CONCURRENT_CONNECTIONS || '10'),
        healthCheckInterval: parseInt(process.env.MCP_HEALTH_CHECK_INTERVAL || '60000')
      }
    };

    this.config = GatewayConfigSchema.parse(rawConfig);
    this.validateConfig(this.config);
    
    return this.config;
  }

  /**
   * Get the current configuration
   */
  getConfig(): GatewayConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadFromFile() or loadFromEnv() first.');
    }
    return this.config;
  }

  /**
   * Parse servers configuration from environment variables
   * Format: MCP_SERVERS=server1:command1:arg1,arg2;server2:command2
   */
  private parseServersFromEnv(): Array<any> {
    const serversEnv = process.env.MCP_SERVERS;
    if (!serversEnv) {
      return [];
    }

    return serversEnv.split(';').map(serverSpec => {
      const parts = serverSpec.split(':');
      if (parts.length < 2) {
        throw new Error(`Invalid server specification: ${serverSpec}`);
      }

      const [name, command, ...args] = parts;
      return {
        name,
        command,
        args: args.length > 0 ? args[0]?.split(',') : []
      };
    });
  }

  /**
   * Validate the configuration for common issues
   */
  private validateConfig(config: GatewayConfig): void {
    const serverNames = new Set<string>();
    
    for (const server of config.servers) {
      // Check for duplicate server names
      if (serverNames.has(server.name)) {
        throw new Error(`Duplicate server name: ${server.name}`);
      }
      serverNames.add(server.name);

      // Validate namespace format if provided
      if (server.namespace && !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(server.namespace)) {
        throw new Error(`Invalid namespace format for server ${server.name}: ${server.namespace}`);
      }
    }

    // Check if at least one server is enabled
    const enabledServers = config.servers.filter(s => s.enabled);
    if (enabledServers.length === 0) {
      throw new Error('At least one server must be enabled');
    }
  }
}

export const configManager = new ConfigManager();
