// Transport factory for multiple MCP transport types
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { type TransportConfig, type McpServerConfig } from './types.js';
import { createX402Fetch, isX402Enabled } from './x402.js';

export class TransportFactory {
  /**
   * Create a transport instance based on configuration
   */
  static create(config: McpServerConfig): any {
    // Handle backward compatibility - convert legacy config to transport config
    const transportConfig = this.normalizeTransportConfig(config);

    switch (transportConfig.type) {
      case 'stdio':
        interface StdioClientOptions {
          command: string;
          args: string[];
          env: Record<string, string>;
          cwd?: string;
        }
        const stdioParams: StdioClientOptions = {
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
      
      case 'http': {
        const baseUrl = new URL(transportConfig.url);
        const requestInit: RequestInit = { headers: {} };
        // propagate headers/apiKey if present in transport config
        if ((transportConfig as any).headers) {
          requestInit.headers = { ...(transportConfig as any).headers } as HeadersInit;
        }
        if ((transportConfig as any).apiKey) {
          (requestInit.headers as Record<string, string>)['Authorization'] = `Bearer ${(transportConfig as any).apiKey}`;
        }

        if (isX402Enabled(config)) {
          return this.createHttpWithX402(config, baseUrl, requestInit);
        }

        return new StreamableHTTPClientTransport(baseUrl, { requestInit });
      }
        
      case 'sse': {
        const sseUrl = new URL(transportConfig.sseUrl);
        const requestInit: RequestInit = { headers: {} };
        if ((transportConfig as any).headers) {
          requestInit.headers = { ...(transportConfig as any).headers } as HeadersInit;
        }
        if ((transportConfig as any).apiKey) {
          (requestInit.headers as Record<string, string>)['Authorization'] = `Bearer ${(transportConfig as any).apiKey}`;
        }

        if (isX402Enabled(config)) {
          return this.createSseWithX402(config, sseUrl, requestInit);
        }

        return new SSEClientTransport(sseUrl, { requestInit });
      }

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

  private static createHttpWithX402(config: McpServerConfig, url: URL, requestInit: RequestInit) {
    // Create a fetch wrapper that loads x402 fetch on first use
    const fetchPromise = createX402Fetch(config);
    
    function fetchWrapper(input: URL | RequestInfo, init?: RequestInit): Promise<Response>;
    function fetchWrapper(input: string | URL | Request, init?: RequestInit): Promise<Response>;
    function fetchWrapper(input: string | URL | Request, init?: RequestInit): Promise<Response> {
      return fetchPromise.then(x402Fetch => x402Fetch(input as string | URL | Request, init));
    }
    
    return new StreamableHTTPClientTransport(url, { fetch: fetchWrapper, requestInit });
  }

  private static createSseWithX402(config: McpServerConfig, url: URL, requestInit: RequestInit) {
    const fetchPromise = createX402Fetch(config);
    
    function fetchWrapper(input: URL | RequestInfo, init?: RequestInit): Promise<Response>;
    function fetchWrapper(input: string | URL | Request, init?: RequestInit): Promise<Response>;
    function fetchWrapper(input: string | URL | Request, init?: RequestInit): Promise<Response> {
      return fetchPromise.then(x402Fetch => x402Fetch(input as string | URL | Request, init));
    }
    
    return new SSEClientTransport(url, { requestInit, fetch: fetchWrapper });
  }
}
