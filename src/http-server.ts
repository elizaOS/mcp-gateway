import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { PaywallGuard } from './paywall-guard.js';
import { GatewayServer } from './aggregator-server.js';

interface HttpServerConfig {
  port: number;
  host?: string;
  corsEnabled?: boolean;
  jwtSecret?: string;
}

/**
 * Optional HTTP/SSE front-end server for MCP Gateway
 * Provides REST endpoints for payment and exposes MCP functionality over HTTP
 */
export class GatewayHttpServer {
  private server?: ReturnType<typeof createServer>;
  private config: HttpServerConfig;
  private gatewayServer: GatewayServer;
  private paywallGuard: PaywallGuard;
  private logger: Console;

  constructor(
    gatewayServer: GatewayServer,
    config: HttpServerConfig,
    logger: Console = console
  ) {
    this.gatewayServer = gatewayServer;
    this.config = config;
    this.logger = logger;
    this.paywallGuard = new PaywallGuard(logger);
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    const { port, host = 'localhost' } = this.config;

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch(error => {
        this.logger.error(`HTTP request error: ${error}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        this.logger.info(`MCP Gateway HTTP server listening on http://${host}:${port}`);
        resolve();
      });

      this.server!.on('error', reject);
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('MCP Gateway HTTP server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Handle CORS if enabled
    if (this.config.corsEnabled) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Payment');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
    }

    const url = new URL(req.url!, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method!;

    this.logger.debug(`HTTP ${method} ${path}`);

    try {
      switch (true) {
        case path === '/pay' && method === 'POST':
          await this.handlePayEndpoint(req, res);
          break;
          
        case path === '/pricing' && method === 'GET':
          await this.handlePricingEndpoint(req, res);
          break;
          
        case path === '/health' && method === 'GET':
          await this.handleHealthEndpoint(req, res);
          break;
          
        case path.startsWith('/mcp/') && method === 'POST':
          await this.handleMcpEndpoint(req, res, path.substring(5));
          break;
          
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      this.logger.error(`Error handling ${method} ${path}: ${error}`);
      
      if (error instanceof PaymentRequiredError) {
        res.writeHead(402, { 
          'Content-Type': 'application/json',
          'X-Payment-Required': 'true',
          'X-Payment-Network': error.network,
          'X-Payment-Token': error.token,
          'X-Payment-Amount': error.amountMicroUSDC,
          'X-Payment-Recipient': error.recipient
        });
        res.end(JSON.stringify({
          error: 'Payment Required',
          paymentRequired: true,
          network: error.network,
          token: error.token,
          amountMicroUSDC: error.amountMicroUSDC,
          recipient: error.recipient,
          nonce: error.nonce,
          howToPay: error.howToPayUrl
        }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  }

  /**
   * Handle POST /pay endpoint
   */
  private async handlePayEndpoint(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const xPaymentHeader = req.headers['x-payment'] as string;
    const body = await this.readBody(req);
    
    let paymentData: string;
    if (xPaymentHeader) {
      paymentData = xPaymentHeader;
    } else if (body) {
      const parsed = JSON.parse(body);
      paymentData = parsed.xPayment || parsed.payment;
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No payment data provided' }));
      return;
    }

    if (!paymentData) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid payment data' }));
      return;
    }

    try {
      // Verify the payment (simplified implementation)
      const expectedAmount = 100000n; // 0.10 USDC as example
      const network = 'base-sepolia';
      const recipient = 'placeholder-recipient';

      const receipt = await this.paywallGuard.verifyX402Payment(
        paymentData,
        expectedAmount,
        network,
        recipient
      );

      // Generate a session token (simplified JWT-like token)
      const sessionId = PaywallGuard.generateSessionId('http-session');
      const token = this.generateSessionToken(sessionId, receipt.amount);
      
      // Record the authorization
      await this.paywallGuard.recordAuthorization(sessionId, receipt, 0n);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        token,
        sessionId,
        amount: receipt.amount.toString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }));

    } catch (error) {
      this.logger.error(`Payment verification failed: ${error}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payment verification failed' }));
    }
  }

  /**
   * Handle GET /pricing endpoint
   */
  private async handlePricingEndpoint(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const gatewayStatus = this.gatewayServer.getStatus();
    const pricing: Record<string, any> = {};
    
    for (const serverConfig of gatewayStatus.config.servers) {
      if (!PaywallGuard.isPaywallEnabled(serverConfig)) continue;
      
      const serverPricing = {
        enabled: true,
        maxValueMicroUSDC: PaywallGuard.getMaxValueMicroUSDC(serverConfig).toString(),
        network: serverConfig.paywall!.wallet.network,
        recipient: 'wallet-address-placeholder', // Would be derived from wallet
        defaultPriceMicroUSDC: serverConfig.paywall!.pricing.defaultPriceMicroUSDC || '0',
        tools: serverConfig.paywall!.pricing.perTool || {},
        resources: serverConfig.paywall!.pricing.perResource || {},
        prompts: serverConfig.paywall!.pricing.perPrompt || {}
      };

      pricing[serverConfig.name] = serverPricing;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pricing }));
  }

  /**
   * Handle GET /health endpoint
   */
  private async handleHealthEndpoint(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const status = this.gatewayServer.getStatus();
    const paywallStats = this.paywallGuard.getStats();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      gateway: status,
      paywall: paywallStats,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Handle MCP endpoints (simplified implementation)
   */
  private async handleMcpEndpoint(req: IncomingMessage, res: ServerResponse, _endpoint: string): Promise<void> {
    // This is a simplified implementation
    // In a full implementation, you'd map HTTP requests to MCP protocol calls
    
    const authHeader = req.headers.authorization;
    const sessionId = this.extractSessionFromAuth(authHeader);
    
    if (!sessionId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Authorization required' }));
      return;
    }

    // For now, just return a placeholder response
    res.writeHead(501, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MCP over HTTP not yet fully implemented' }));
  }

  /**
   * Generate a session token (simplified implementation)
   */
  private generateSessionToken(sessionId: string, amount: bigint): string {
    // In a real implementation, this would be a proper JWT
    const payload = {
      sessionId,
      amount: amount.toString(),
      iat: Date.now(),
      exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    };

    // Simple base64 encoding (not secure, just for demo)
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Extract session ID from authorization header
   */
  private extractSessionFromAuth(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    try {
      const token = authHeader.substring(7);
      const payload = JSON.parse(Buffer.from(token, 'base64').toString());
      return payload.sessionId;
    } catch {
      return null;
    }
  }

  /**
   * Read request body
   */
  private async readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
      req.on('error', reject);
    });
  }
}

/**
 * Custom error for payment required responses
 */
class PaymentRequiredError extends Error {
  constructor(
    public network: string,
    public token: string,
    public amountMicroUSDC: string,
    public recipient: string,
    public nonce: string,
    public howToPayUrl: string
  ) {
    super('Payment Required');
    this.name = 'PaymentRequiredError';
  }
}

export { PaymentRequiredError };
