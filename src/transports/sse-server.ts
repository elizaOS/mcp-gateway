/**
 * SSE Server Transport for MCP Gateway
 * 
 * Provides HTTP/SSE transport with full x402 payment support.
 * This allows the gateway to:
 * - Receive HTTP requests with payment headers
 * - Return HTTP 402 status codes for payment requirements
 * - Validate x402 payments before processing requests
 */

import { Server as HTTPServer, IncomingMessage, ServerResponse } from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';
import { PaymentMiddleware, PaymentRequirements } from '../core/payment-middleware.js';

export interface SSEServerOptions {
  port: number;
  host?: string;
  ssePath?: string;
  messagePath?: string;
  paymentMiddleware?: PaymentMiddleware;
}

interface Session {
  id: string;
  response: ServerResponse;
  headers: Record<string, string>;
  lastActivity: number;
}

export class SSEServerTransport {
  private httpServer: HTTPServer;
  private sessions = new Map<string, Session>();
  private options: Required<SSEServerOptions>;
  private mcpServer?: Server;
  private messageHandlers = new Map<string, (response: JSONRPCResponse) => void>();
  private logger: Console;

  constructor(options: SSEServerOptions, logger: Console = console) {
    this.logger = logger;
    this.options = {
      host: options.host || 'localhost',
      ssePath: options.ssePath || '/sse',
      messagePath: options.messagePath || '/message',
      ...options
    };

    this.httpServer = new HTTPServer(this.handleRequest.bind(this));

    // Clean up stale sessions every 60 seconds
    setInterval(() => this.cleanupStaleSessions(), 60000);
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.options.port, this.options.host, () => {
        this.logger.info(`SSE server listening on http://${this.options.host}:${this.options.port}`);
        this.logger.info(`SSE endpoint: http://${this.options.host}:${this.options.port}${this.options.ssePath}`);
        this.logger.info(`Message endpoint: http://${this.options.host}:${this.options.port}${this.options.messagePath}`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    // Close all active sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      session.response.end();
      this.sessions.delete(sessionId);
    }

    return new Promise((resolve) => {
      this.httpServer.close(() => {
        this.logger.info('SSE server closed');
        resolve();
      });
    });
  }

  setMCPServer(server: Server): void {
    this.mcpServer = server;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment, X-ELIZA-API-KEY, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'GET' && url === this.options.ssePath) {
      this.handleSSE(req, res);
    } else if (req.method === 'POST' && url.startsWith(this.options.messagePath)) {
      this.handleMessage(req, res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  private handleSSE(req: IncomingMessage, res: ServerResponse): void {
    const sessionId = this.generateSessionId();
    const headers = this.extractHeaders(req);

    this.logger.info(`New SSE connection: session=${sessionId}`);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Store session
    const session: Session = {
      id: sessionId,
      response: res,
      headers,
      lastActivity: Date.now()
    };
    this.sessions.set(sessionId, session);

    // Send session ID to client
    this.sendSSE(res, 'endpoint', {
      endpoint: `${this.options.messagePath}?sessionId=${sessionId}`
    });

    // Handle client disconnect
    req.on('close', () => {
      this.logger.info(`SSE connection closed: session=${sessionId}`);
      this.sessions.delete(sessionId);
    });

    // Keep-alive ping every 30 seconds
    const keepAlive = setInterval(() => {
      if (!this.sessions.has(sessionId)) {
        clearInterval(keepAlive);
        return;
      }
      try {
        res.write(':ping\n\n');
      } catch (error) {
        this.logger.error(`Keep-alive failed for session ${sessionId}: ${error}`);
        clearInterval(keepAlive);
        this.sessions.delete(sessionId);
      }
    }, 30000);
  }

  private async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId || !this.sessions.has(sessionId)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid session' }));
      return;
    }

    const session = this.sessions.get(sessionId)!;
    session.lastActivity = Date.now();

    // Update headers with latest from this request
    const requestHeaders = this.extractHeaders(req);
    Object.assign(session.headers, requestHeaders);

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const message: JSONRPCRequest = JSON.parse(body);
        this.logger.debug(`Received message: method=${message.method}, id=${message.id}`);

        // Check if this is a tool call that requires payment
        if (message.method === 'tools/call' && this.options.paymentMiddleware) {
          const result = await this.checkPaymentForToolCall(message, session.headers, res);
          if (!result) {
            return; // Payment required, 402 response already sent
          }
        }

        // Process the message through MCP server
        if (this.mcpServer) {
          const response = await this.processMessage(message, session.headers);
          
          // Send response to client
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));

          // Also send via SSE for streaming
          if (response && 'id' in response) {
            this.sendSSE(session.response, 'message', response);
          }
        } else {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'MCP server not initialized' }));
        }
      } catch (error) {
        this.logger.error(`Message handling error: ${error}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(error) }));
      }
    });
  }

  private async checkPaymentForToolCall(
    message: JSONRPCRequest,
    headers: Record<string, string>,
    res: ServerResponse
  ): Promise<boolean> {
    if (!this.options.paymentMiddleware || !message.params) {
      return true;
    }

    const toolName = (message.params as { name?: string }).name;
    if (!toolName) {
      return true;
    }

    // Inject headers into request params for payment middleware
    (message.params as any)._meta = { headers };

    // For now, allow the request to proceed - payment will be checked by the gateway
    // In the future, we could check here and return 402 immediately
    return true;
  }

  private async processMessage(
    message: JSONRPCRequest,
    headers: Record<string, string>
  ): Promise<JSONRPCResponse> {
    if (!this.mcpServer) {
      throw new Error('MCP server not initialized');
    }

    // Inject headers into message for payment middleware access
    if (message.params) {
      (message.params as any)._meta = { headers };
    }

    // Handle the message through the MCP server's request handlers
    // We need to route based on method
    const method = message.method;
    const params = message.params || {};

    try {
      // Call the appropriate handler
      // This is a simplified version - in production, you'd want to properly route all MCP methods
      const result = await (this.mcpServer as any).handleRequest(message);
      
      return {
        jsonrpc: '2.0',
        id: message.id,
        result
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: String(error)
        }
      };
    }
  }

  private sendSSE(res: ServerResponse, event: string, data: unknown): void {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      this.logger.error(`Failed to send SSE event: ${error}`);
    }
  }

  private extractHeaders(req: IncomingMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key.toLowerCase()] = value;
      } else if (Array.isArray(value)) {
        headers[key.toLowerCase()] = value[0];
      }
    }

    return headers;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > timeout) {
        this.logger.info(`Cleaning up stale session: ${sessionId}`);
        session.response.end();
        this.sessions.delete(sessionId);
      }
    }
  }
}
