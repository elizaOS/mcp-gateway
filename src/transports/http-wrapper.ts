#!/usr/bin/env node

/**
 * HTTP Wrapper for MCP Gateway with x402 Support
 * 
 * This creates an HTTP/SSE server that wraps the gateway's stdio interface
 * and adds proper x402 payment support by returning HTTP 402 status codes.
 * 
 * Usage:
 *   bun run src/transports/http-wrapper.ts --config=examples/coingecko-config.yaml --port=8000
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { spawn, ChildProcess } from 'child_process';
import { PaymentMiddleware } from '../core/payment-middleware.js';
import { configManager } from '../config/manager.js';

interface Session {
  id: string;
  response: ServerResponse;
  process: ChildProcess;
  buffer: string;
}

class HTTPGatewayWrapper {
  private sessions = new Map<string, Session>();
  private paymentMiddleware?: PaymentMiddleware;
  private config: any;
  private logger: Console;
  private port: number;
  private gatewayCommand: string[];

  constructor(configPath: string, port: number, logger: Console = console) {
    this.logger = logger;
    this.port = port;

    // Load gateway config for payment middleware
    this.config = configManager.loadFromFile(configPath);
    
    // Initialize payment middleware (HTTP layer handles payments)
    if (this.config.payment?.enabled) {
      this.paymentMiddleware = new PaymentMiddleware(this.config, logger);
      logger.info('Payment middleware enabled for HTTP wrapper');
    }

    // Gateway subprocess command - use wrapper config (no payment checking in subprocess)
    // The HTTP layer handles all payment verification
    // IMPORTANT: Subprocess must run in STDIO mode, not SSE mode
    
    // Just re-run the same script we're currently running, but in STDIO mode
    // process.argv[1] is the path to the currently executing script (works for both src and build)
    // Use 'bun' directly (not 'bun run') to execute the script without package.json interference
    const currentScript = process.argv[1]!;
    const wrapperConfigPath = configPath.replace('.yaml', '-wrapper.yaml').replace('.json', '-wrapper.json');
    this.gatewayCommand = ['bun', currentScript, '--mode=stdio', `--config=${wrapperConfigPath}`];
    
    logger.info(`Gateway subprocess will use config: ${wrapperConfigPath}`);
    logger.info(`Gateway subprocess command: ${this.gatewayCommand.join(' ')}`);
  }

  start(): void {
    const server = createServer((req, res) => this.handleRequest(req, res));
    
    server.listen(this.port, () => {
      this.logger.info(`HTTP Gateway Wrapper listening on http://localhost:${this.port}`);
      this.logger.info(`SSE endpoint: http://localhost:${this.port}/sse`);
      this.logger.info(`Message endpoint: http://localhost:${this.port}/message`);
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    this.logger.info(`Request: ${req.method} ${req.url}`);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment, X-ELIZA-API-KEY, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'X-Accept-Payment');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url || '/';

    if (req.method === 'GET' && url === '/sse') {
      this.handleSSE(req, res);
    } else if (req.method === 'POST' && url.startsWith('/message')) {
      this.handleMessage(req, res);
    } else {
      this.logger.warn(`404 Not Found: ${req.method} ${url}`);
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  private handleSSE(req: IncomingMessage, res: ServerResponse): void {
    const sessionId = this.generateSessionId();
    this.logger.info(`New SSE connection: session=${sessionId}`);

    // Start gateway process for this session
    const gatewayProcess = spawn(this.gatewayCommand[0]!, this.gatewayCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const session: Session = {
      id: sessionId,
      response: res,
      process: gatewayProcess,
      buffer: ''
    };

    this.sessions.set(sessionId, session);

    // Send endpoint URL (send as plain text, not JSON-stringified)
    try {
      res.write(`event: endpoint\n`);
      res.write(`data: /message?sessionId=${sessionId}\n\n`);
    } catch (error) {
      this.logger.error(`Failed to send endpoint: ${error}`);
    }

    // Handle process output
    if (gatewayProcess.stdout) {
      gatewayProcess.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        this.logger.debug(`Gateway stdout: ${output.substring(0, 200)}`);
        session.buffer += output;
        this.processGatewayOutput(session);
      });
    }

    if (gatewayProcess.stderr) {
      gatewayProcess.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        this.logger.info(`Gateway stderr: ${message}`);
      });
    }

    gatewayProcess.on('error', (error) => {
      this.logger.error(`Gateway process error: ${error}`);
    });

    gatewayProcess.on('exit', (code, signal) => {
      this.logger.warn(`Gateway process exited: code=${code}, signal=${signal}`);
    });

    // Handle client disconnect
    req.on('close', () => {
      this.logger.info(`SSE connection closed: session=${sessionId}`);
      gatewayProcess.kill();
      this.sessions.delete(sessionId);
    });

    // Keep-alive
    const keepAlive = setInterval(() => {
      if (!this.sessions.has(sessionId)) {
        clearInterval(keepAlive);
        return;
      }
      try {
        res.write(':ping\n\n');
      } catch (error) {
        clearInterval(keepAlive);
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
    const headers = this.extractHeaders(req);

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const message = JSON.parse(body);

        // Check for payment requirement on tool calls
        if (message.method === 'tools/call' && this.paymentMiddleware) {
          const paymentCheck = await this.checkPayment(message, headers);
          
          if (paymentCheck.status === 402) {
            // Return HTTP 402 with x402 headers
            res.writeHead(402, {
              'Content-Type': 'application/json',
              'X-Accept-Payment': JSON.stringify(paymentCheck.requirements)
            });
            res.end(JSON.stringify(paymentCheck.requirements));
            return;
          }
        }

        // Forward to gateway
        if (session.process.stdin) {
          const messageStr = JSON.stringify(message) + '\n';
          this.logger.info(`Forwarding to gateway: ${messageStr.substring(0, 150)}`);
          session.process.stdin.write(messageStr);
        } else {
          throw new Error('Gateway stdin not available');
        }

        // In SSE mode, responses come via the SSE stream, not via HTTP responses
        // Just acknowledge receipt of the message
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted' }));

      } catch (error) {
        this.logger.error(`Message handling error: ${error}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(error) }));
      }
    });
  }

  private async checkPayment(message: any, headers: Record<string, string>): Promise<{
    status: 200 | 402;
    requirements?: any;
  }> {
    if (!this.paymentMiddleware || !message.params?.name) {
      return { status: 200 };
    }

    const toolName = message.params.name;
    
    // Extract server ID from tool name (format: namespace:toolname or just toolname)
    let serverId = 'unknown';
    for (const server of this.config.servers) {
      const namespace = server.namespace;
      if (namespace && toolName.startsWith(`${namespace}:`)) {
        serverId = server.name;
        break;
      }
    }

    const verification = await this.paymentMiddleware.verifyPayment(
      toolName,
      serverId,
      headers
    );

    if (!verification.authorized) {
      // Generate x402 requirements with full URL for resource field
      const requestUrl = `http://localhost:${this.port}/message`;
      const requirements = this.paymentMiddleware.generatePaymentRequiredResponse(
        toolName,
        serverId,
        requestUrl
      );

      this.logger.warn(`Payment required for ${toolName}: ${verification.error}`);

      return {
        status: 402,
        requirements
      };
    }

    this.logger.info(`Payment verified for ${toolName}: ${verification.pricing?.method}`);
    return { status: 200 };
  }

  private processGatewayOutput(session: Session): void {
    const lines = session.buffer.split('\n');
    session.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line);
        
        // Send all responses via SSE
        this.sendSSE(session.response, 'message', response);
      } catch (error) {
        // Not JSON, ignore (could be log output)
        this.logger.debug(`Non-JSON output from gateway: ${line.substring(0, 100)}`);
      }
    }
  }

  private sendSSE(res: ServerResponse, event: string, data: any): void {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      // Connection closed
    }
  }

  private extractHeaders(req: IncomingMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key.toLowerCase()] = value;
      } else if (Array.isArray(value) && value.length > 0 && value[0]) {
        headers[key.toLowerCase()] = value[0];
      }
    }

    return headers;
  }

  private generateSessionId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const configPath = args.find(arg => arg.startsWith('--config='))?.replace('--config=', '');
  const port = parseInt(args.find(arg => arg.startsWith('--port='))?.replace('--port=', '') || '8000');

  if (!configPath) {
    console.error('Error: --config argument is required');
    console.log('\nUsage: bun run src/transports/http-wrapper.ts --config=path/to/config.yaml --port=8000');
    process.exit(1);
  }

  try {
    const wrapper = new HTTPGatewayWrapper(configPath, port);
    wrapper.start();
  } catch (error) {
    console.error(`Failed to start HTTP Gateway Wrapper: ${error}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { HTTPGatewayWrapper };
