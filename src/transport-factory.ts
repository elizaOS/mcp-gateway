// Transport factory for multiple MCP transport types
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { type TransportConfig, type McpServerConfig } from './types.js';

export class TransportFactory {
  /**
   * Create a transport instance based on configuration
   */
  static create(config: McpServerConfig): any {
    // Handle backward compatibility - convert legacy config to transport config
    const transportConfig = this.normalizeTransportConfig(config);

    switch (transportConfig.type) {
      case 'stdio':
        const stdioParams: any = {
          command: transportConfig.command,
          args: transportConfig.args || [],
          env: {
            ...process.env,
            ...(transportConfig.env || {})
          } as Record<string, string>
        };
        if (transportConfig.cwd) {
          stdioParams.cwd = transportConfig.cwd;
        }
        return new StdioClientTransport(stdioParams);
      
      case 'http':
        return new StreamableHTTPClientTransport(
          new URL(transportConfig.url)
        );
        
      case 'sse':
        return new SSEClientTransport(
          new URL(transportConfig.sseUrl)
        );

      case 'websocket':
        return new WebSocketClientTransport(
          new URL(transportConfig.url)
        );
        
      default:
        throw new Error(`Unsupported transport type: ${(transportConfig as any).type}`);
    }
  }

  /**
   * Convert legacy config format to new transport config format
   */
  private static normalizeTransportConfig(config: McpServerConfig): TransportConfig {
    // If transport is explicitly configured, use it
    if (config.transport) {
      return config.transport;
    }

    // Backward compatibility: convert legacy fields to stdio transport
    if (config.command) {
      return {
        type: 'stdio' as const,
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd
      };
    }

    throw new Error(`Server ${config.name} has no transport configuration`);
  }

  /**
   * Validate transport configuration
   */
  static validateConfig(config: McpServerConfig): string[] {
    const errors: string[] = [];
    
    try {
      const transportConfig = this.normalizeTransportConfig(config);
      
      switch (transportConfig.type) {
        case 'stdio':
          if (!transportConfig.command) {
            errors.push(`STDIO transport requires 'command' field`);
          }
          break;
          
        case 'http':
          if (!transportConfig.url) {
            errors.push(`HTTP transport requires 'url' field`);
          }
          break;
          
        case 'sse':
          if (!transportConfig.sseUrl || !transportConfig.postUrl) {
            errors.push(`SSE transport requires both 'sseUrl' and 'postUrl' fields`);
          }
          break;
          
        case 'websocket':
          if (!transportConfig.url) {
            errors.push(`WebSocket transport requires 'url' field`);
          }
          break;
      }
      
    } catch (error) {
      errors.push(`Transport configuration error: ${error}`);
    }
    
    return errors;
  }

  /**
   * Get display name for transport type
   */
  static getTransportDisplayName(config: McpServerConfig): string {
    try {
      const transportConfig = this.normalizeTransportConfig(config);
      switch (transportConfig.type) {
        case 'stdio':
          return `STDIO (${transportConfig.command})`;
        case 'http':
          return `HTTP (${transportConfig.url})`;
        case 'sse':
          return `SSE (${transportConfig.sseUrl})`;
        case 'websocket':
          return `WebSocket (${transportConfig.url})`;
        default:
          return 'Unknown';
      }
    } catch {
      return 'Invalid';
    }
  }
}
