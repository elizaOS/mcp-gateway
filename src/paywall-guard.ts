import { type McpServerConfig, type VerifiedPaymentReceipt, type PaywallSession, type PaywallStats } from './types.js';
import { createWalletClient, http, publicActions, type Chain, type Transport, type Account, type Client, type PublicActions, type WalletActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import crypto from 'crypto';

// SignerWallet type from x402 - a viem Client with PublicActions & WalletActions
type SignerWallet<chain extends Chain = Chain, transport extends Transport = Transport, account extends Account = Account> = 
  Client<transport, chain, account, any, PublicActions<transport, chain, account> & WalletActions<chain, account>>;

/**
 * PaywallGuard handles inbound payment enforcement for MCP Gateway
 * It manages pricing, session authorization, and payment verification
 */
export class PaywallGuard {
  private sessions: Map<string, PaywallSession> = new Map();
  private stats: PaywallStats = {
    totalPayments: 0,
    totalAmount: 0n,
    activeSessions: 0,
    paymentsToday: 0,
    averagePayment: 0n
  };
  private logger: Console;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(logger: Console = console) {
    this.logger = logger;
    
    // Clean up expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Check if paywall is enabled for a server
   */
  static isPaywallEnabled(config: McpServerConfig): boolean {
    return config.paywall?.enabled === true;
  }

  /**
   * Get the required price for a specific item
   * @param kind - Type of item (tool, resource, prompt)
   * @param id - Identifier for the item (tool name, resource URI, prompt name)
   * @param config - Server configuration
   * @returns Price in micro-USDC, or null if free
   */
  static getRequiredPriceMicroUSDC(
    kind: 'tool' | 'resource' | 'prompt',
    id: string,
    config: McpServerConfig
  ): bigint | null {
    if (!PaywallGuard.isPaywallEnabled(config)) {
      return null;
    }

    const paywall = config.paywall!;
    const pricing = paywall.pricing;

    // Check for specific pricing first
    let priceStr: string | undefined;
    switch (kind) {
      case 'tool':
        priceStr = pricing.perTool?.[id];
        break;
      case 'resource':
        priceStr = pricing.perResource?.[id];
        break;
      case 'prompt':
        priceStr = pricing.perPrompt?.[id];
        break;
    }

    // Fall back to default price
    if (!priceStr) {
      priceStr = pricing.defaultPriceMicroUSDC;
    }

    // If no price specified, it's free
    if (!priceStr) {
      return null;
    }

    try {
      const price = BigInt(priceStr);
      return price > 0n ? price : null;
    } catch {
      // Note: This is a static method, so we can't access instance logger
      // In a real implementation, you might want to pass a logger parameter
      console.warn(`Invalid price string "${priceStr}" for ${kind} ${id}, treating as free`);
      return null;
    }
  }

  /**
   * Get the maximum value per request for a server
   */
  static getMaxValueMicroUSDC(config: McpServerConfig): bigint {
    const DEFAULT_MAX = 100_000n; // 0.10 USDC
    
    if (!PaywallGuard.isPaywallEnabled(config)) {
      return DEFAULT_MAX;
    }

    const maxValueStr = config.paywall!.maxValueMicroUSDC;
    if (!maxValueStr) {
      return DEFAULT_MAX;
    }

    try {
      const parsed = BigInt(maxValueStr);
      return parsed > 0n ? parsed : DEFAULT_MAX;
    } catch {
      return DEFAULT_MAX;
    }
  }

  /**
   * Check if a session has sufficient authorization for a payment
   */
  async isSessionAuthorized(sessionId: string, price: bigint): Promise<boolean> {
    if (price <= 0n) {
      return true; // Free items are always authorized
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Check if session is expired
    if (session.expiresAt < new Date()) {
      this.sessions.delete(sessionId);
      this.updateStats();
      return false;
    }

    return session.remainingBalance >= price;
  }

  /**
   * Record a successful authorization and deduct the amount
   */
  async recordAuthorization(sessionId: string, receipt: VerifiedPaymentReceipt, amount: bigint): Promise<void> {
    let session = this.sessions.get(sessionId);
    
    if (!session) {
      // Create new session
      session = {
        sessionId,
        authorizedAmount: receipt.amount,
        remainingBalance: receipt.amount,
        receipts: [receipt],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      };
      this.sessions.set(sessionId, session);
    } else {
      // Update existing session
      session.authorizedAmount += receipt.amount;
      session.remainingBalance += receipt.amount;
      session.receipts.push(receipt);
      session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // Extend expiry
    }

    // Deduct the amount if specified
    if (amount > 0n) {
      session.remainingBalance -= amount;
    }

    // Update stats
    this.stats.totalPayments++;
    this.stats.totalAmount += receipt.amount;
    this.updateStats();

    this.logger.debug(`Recorded authorization for session ${sessionId}: +${receipt.amount} micro-USDC, used ${amount}, balance: ${session.remainingBalance}`);
  }

  /**
   * Deduct amount from session balance (for successful calls)
   */
  async deductFromSession(sessionId: string, amount: bigint): Promise<boolean> {
    if (amount <= 0n) {
      return true;
    }

    const session = this.sessions.get(sessionId);
    if (!session || session.remainingBalance < amount) {
      return false;
    }

    session.remainingBalance -= amount;
    this.logger.debug(`Deducted ${amount} micro-USDC from session ${sessionId}, remaining: ${session.remainingBalance}`);
    return true;
  }

  /**
   * Get current session balance
   */
  getSessionBalance(sessionId: string): bigint {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt < new Date()) {
      return 0n;
    }
    return session.remainingBalance;
  }

  /**
   * Verify x402 payment and return verified receipt
   * This is a simplified implementation - in production you'd want more robust verification
   */
  async verifyX402Payment(
    paymentData: string | object,
    expectedAmount: bigint,
    network: string,
    recipient: string
  ): Promise<VerifiedPaymentReceipt> {
    // This is a placeholder implementation
    // In a real implementation, you would:
    // 1. Parse the x402 payment envelope
    // 2. Verify the payment signature
    // 3. Check the blockchain for the actual transaction
    // 4. Validate the amount and recipient
    
    const paymentId = crypto.randomUUID();
    const now = new Date();
    
    // For now, we'll do basic validation and trust the payment data
    // This should be replaced with proper x402 verification using x402 libraries
    
    this.logger.debug(`Verifying x402 payment: ${JSON.stringify(paymentData)} for ${expectedAmount} micro-USDC`);
    
    // Simulate verification - in reality this would involve cryptographic verification
    const receipt: VerifiedPaymentReceipt = {
      paymentId,
      amount: expectedAmount, // In real implementation, extract from payment data
      network,
      recipient,
      timestamp: now,
      txHash: `0x${crypto.randomBytes(32).toString('hex')}` // Placeholder
    };

    return receipt;
  }

  /**
   * Create wallet for paywall enforcement
   */
  static async createPaywallWallet(config: McpServerConfig): Promise<SignerWallet> {
    if (!PaywallGuard.isPaywallEnabled(config)) {
      throw new Error('Paywall is not enabled for this server');
    }

    const walletConfig = config.paywall!.wallet;
    const privateKey = process.env[walletConfig.privateKeyEnv];
    
    if (!privateKey || privateKey.length === 0) {
      throw new Error(`Missing private key in environment variable ${walletConfig.privateKeyEnv} for server ${config.name}`);
    }

    const chain = PaywallGuard.getChainFromNetwork(walletConfig.network);
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    
    const wallet = createWalletClient({
      account,
      chain,
      transport: http(),
    }).extend(publicActions);
    
    return wallet as SignerWallet;
  }

  /**
   * Get viem chain from network string
   */
  private static getChainFromNetwork(network: string): Chain {
    switch (network) {
      case 'base':
        return base;
      case 'base-sepolia':
        return baseSepolia;
      default:
        throw new Error(`Unsupported network: ${network}`);
    }
  }

  /**
   * Get current paywall statistics
   */
  getStats(): PaywallStats {
    return { ...this.stats };
  }

  /**
   * Get all active sessions (for debugging)
   */
  getActiveSessions(): Array<{ sessionId: string; balance: bigint; expiresAt: Date }> {
    const now = new Date();
    return Array.from(this.sessions.values())
      .filter(session => session.expiresAt > now)
      .map(session => ({
        sessionId: session.sessionId,
        balance: session.remainingBalance,
        expiresAt: session.expiresAt
      }));
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = new Date();
    let cleaned = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.updateStats();
      this.logger.debug(`Cleaned up ${cleaned} expired paywall sessions`);
    }
  }

  /**
   * Update internal statistics
   */
  private updateStats(): void {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    this.stats.activeSessions = this.sessions.size;
    
    // Count payments made today
    this.stats.paymentsToday = 0;
    let totalAmountToday = 0n;
    
    for (const session of this.sessions.values()) {
      for (const receipt of session.receipts) {
        if (receipt.timestamp >= startOfDay) {
          this.stats.paymentsToday++;
          totalAmountToday += receipt.amount;
        }
      }
    }
    
    // Update average payment
    if (this.stats.totalPayments > 0) {
      this.stats.averagePayment = this.stats.totalAmount / BigInt(this.stats.totalPayments);
    }
  }

  /**
   * Generate a session ID for a client connection
   * In STDIO mode, this could be based on process info
   * In HTTP mode, this could be based on connection/auth info
   */
  static generateSessionId(clientInfo?: string): string {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(8).toString('hex');
    const info = clientInfo || 'unknown';
    return crypto.createHash('sha256').update(`${info}-${timestamp}-${random}`).digest('hex').substring(0, 16);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
  }
}
