import { readFileSync } from 'fs';
import { parse as parseYAML } from 'yaml';
import { GatewayConfigSchema, type GatewayConfig } from '../types/index';

export class ConfigManager {
  private config: GatewayConfig | null = null;

  loadFromFile(filePath: string): GatewayConfig {
    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      
      // Substitute environment variables in the content
      const processedContent = this.substituteEnvVars(fileContent);
      
      let rawConfig: unknown;
      
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        rawConfig = parseYAML(processedContent);
      } else {
        rawConfig = JSON.parse(processedContent);
      }

      this.config = GatewayConfigSchema.parse(rawConfig);
      this.validateConfig(this.config);
      
      return this.config;
    } catch (error) {
      throw new Error(`Failed to load config from ${filePath}: ${error}`);
    }
  }

  /**
   * Substitute environment variables in config content
   * Supports ${VAR_NAME} and ${VAR_NAME:-default} syntax
   */
  private substituteEnvVars(content: string): string {
    return content.replace(/\$\{([^}:]+)(?::(-)?([^}]*))?\}/g, (match, varName, hasDefault, defaultValue) => {
      const envValue = process.env[varName.trim()];
      
      if (envValue !== undefined) {
        return envValue;
      }
      
      if (hasDefault !== undefined) {
        return defaultValue || '';
      }
      
      // If no value and no default, return empty string or keep original
      return '';
    });
  }

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
        logLevel: (process.env.MCP_LOG_LEVEL as 'error'|'warn'|'info'|'debug') || 'info',
        maxConcurrentConnections: parseInt(process.env.MCP_MAX_CONCURRENT_CONNECTIONS || '10'),
        healthCheckInterval: parseInt(process.env.MCP_HEALTH_CHECK_INTERVAL || '60000')
      }
    };

    this.config = GatewayConfigSchema.parse(rawConfig);
    this.validateConfig(this.config);
    
    return this.config;
  }

  getConfig(): GatewayConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadFromFile() or loadFromEnv() first.');
    }
    return this.config;
  }

  private parseServersFromEnv(): Array<{ name: string; command: string; args: string[] }> {
    const serversEnv = process.env.MCP_SERVERS;
    if (!serversEnv) {
      return [];
    }

    return serversEnv.split(';').map(serverSpec => {
      const parts = serverSpec.split(':');
      if (parts.length < 2) {
        throw new Error(`Invalid server specification: ${serverSpec}`);
      }

      const [nameRaw, commandRaw, ...args] = parts;
      const name = nameRaw ?? '';
      const command = commandRaw ?? '';
      if (!name || !command) {
        throw new Error(`Invalid server specification: ${serverSpec}`);
      }
      return {
        name,
        command,
        args: args.length > 0 ? (args[0] ? args[0].split(',') : []) : []
      };
    });
  }

  private validateConfig(config: GatewayConfig): void {
    const serverNames = new Set<string>();
    
    for (const server of config.servers) {
      if (serverNames.has(server.name)) {
        throw new Error(`Duplicate server name: ${server.name}`);
      }
      serverNames.add(server.name);

      if (server.namespace && !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(server.namespace)) {
        throw new Error(`Invalid namespace format for server ${server.name}: ${server.namespace}`);
      }
    }

    const enabledServers = config.servers.filter(s => s.enabled);
    if (enabledServers.length === 0) {
      throw new Error('At least one server must be enabled');
    }
  }
}

export const configManager = new ConfigManager();


