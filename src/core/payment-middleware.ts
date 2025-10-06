import type { GatewayConfig, ToolPricing, ApiKeyConfig } from '../types/index';
import { getAddress } from 'viem';
import { useFacilitator } from 'x402/verify';
import { exact } from 'x402/schemes';
import { processPriceToAtomicAmount } from 'x402/shared';
import type { PaymentPayload } from 'x402/types';

export interface PaymentVerificationResult {
  authorized: boolean;
  error?: string;
  pricing?: {
    amount: string;
    method: 'x402' | 'apiKey' | 'free';
  };
}

export interface PaymentRequirements {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType?: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra?: {
      name: string;
      version: string;
    };
  }>;
  error?: string;
}

/**
 * Middleware for handling payment verification for MCP tools
 * Supports both x402 blockchain payments and ELIZA_API_KEY authentication
 */
export class PaymentMiddleware {
  private config: GatewayConfig;
  private apiKeyCache = new Map<string, ApiKeyConfig>();
  private logger: Console;
  private verifyPaymentFunc: (payment: PaymentPayload, requirements: any) => Promise<any>;
  private settlePaymentFunc: (payment: PaymentPayload, requirements: any) => Promise<any>;

  // USDC contract addresses by network
  private static readonly USDC_ADDRESSES: Record<string, string> = {
    'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'ethereum': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'optimism': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    'polygon': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
  };

  constructor(config: GatewayConfig, logger: Console = console) {
    this.config = config;
    this.logger = logger;

    // Initialize x402 facilitator client
    const facilitatorUrl = config.payment?.facilitator || 'https://x402.org/facilitator';
    const facilitator = useFacilitator({ url: facilitatorUrl } as any);
    this.verifyPaymentFunc = facilitator.verify;
    this.settlePaymentFunc = facilitator.settle;
    
    this.logger.info(`x402 facilitator initialized: ${facilitatorUrl}`);

    // Build API key lookup cache
    if (config.payment?.apiKeys) {
      for (const keyConfig of config.payment.apiKeys) {
        this.apiKeyCache.set(keyConfig.key, keyConfig);
      }
      this.logger.info(`Loaded ${this.apiKeyCache.size} API keys for payment verification`);
    }
  }

  /**
   * Verify if a payment is valid for accessing a tool
   */
  async verifyPayment(
    toolName: string,
    serverId: string,
    headers?: Record<string, string>
  ): Promise<PaymentVerificationResult> {
    if (!this.config.payment?.enabled) {
      return {
        authorized: true,
        pricing: { amount: '0', method: 'free' }
      };
    }

    // Get tool pricing configuration
    const pricing = this.getToolPricing(toolName, serverId);

    // If no pricing is configured, tool is free
    if (!pricing) {
      return {
        authorized: true,
        pricing: { amount: '0', method: 'free' }
      };
    }

    // Check if tool is explicitly marked as free
    if (pricing.free) {
      return {
        authorized: true,
        pricing: { amount: '0', method: 'free' }
      };
    }

    // Try API key authentication first (faster than x402)
    const apiKeyResult = this.verifyApiKey(headers, pricing);
    if (apiKeyResult.authorized) {
      return apiKeyResult;
    }

    // Try x402 payment verification
    const x402Result = await this.verifyX402Payment(headers, pricing, toolName);
    if (x402Result.authorized) {
      return x402Result;
    }

    // No valid payment found
    const amount = pricing.x402 || '$0.01';
    return {
      authorized: false,
      error: `Payment required: ${amount}. Provide X-PAYMENT header (x402) or X-ELIZA-API-KEY.`,
      pricing: { amount, method: 'x402' }
    };
  }

  /**
   * Verify API key authentication
   */
  private verifyApiKey(
    headers?: Record<string, string>,
    pricing?: ToolPricing
  ): PaymentVerificationResult {
    if (!headers || !pricing) {
      return { authorized: false };
    }

    // Check for API key in multiple header formats
    const apiKey =
      headers['x-eliza-api-key'] ||
      headers['X-ELIZA-API-KEY'] ||
      headers['authorization']?.replace('Bearer ', '') ||
      headers['Authorization']?.replace('Bearer ', '');

    if (!apiKey) {
      return { authorized: false };
    }

    const keyConfig = this.apiKeyCache.get(apiKey);
    if (!keyConfig) {
      this.logger.warn('Invalid API key provided');
      return {
        authorized: false,
        error: 'Invalid API key'
      };
    }

    // Check if this tier gets free or discounted access
    const tierPrice = pricing.apiKeyTiers?.[keyConfig.tier];

    if (tierPrice === 'free' || tierPrice === '$0.00' || tierPrice === '$0') {
      this.logger.info(`API key tier '${keyConfig.tier}' grants free access`);
      return {
        authorized: true,
        pricing: { amount: '0', method: 'apiKey' }
      };
    }

    if (tierPrice) {
      this.logger.info(`API key tier '${keyConfig.tier}' pays ${tierPrice}`);
      return {
        authorized: true,
        pricing: { amount: tierPrice, method: 'apiKey' }
      };
    }

    // API key valid but no tier pricing configured
    return { authorized: false };
  }

  /**
   * Verify x402 blockchain payment
   */
  private async verifyX402Payment(
    headers?: Record<string, string>,
    pricing?: ToolPricing,
    toolName?: string,
    requestUrl?: string
  ): Promise<PaymentVerificationResult> {
    if (!headers || !pricing?.x402) {
      return { authorized: false };
    }

    const paymentHeader =
      headers['x-payment'] ||
      headers['X-PAYMENT'];

    if (!paymentHeader) {
      return { authorized: false };
    }

    try {
      // Decode payment using x402 SDK
      let decodedPayment: PaymentPayload;
      try {
        decodedPayment = exact.evm.decodePayment(paymentHeader);
        const payerAddress = 'authorization' in decodedPayment.payload 
          ? decodedPayment.payload.authorization.from 
          : 'unknown';
        this.logger.info(`Payment decoded from: ${payerAddress}`);
      } catch (decodeError) {
        this.logger.error(`Failed to decode X-PAYMENT header: ${decodeError}`);
        return {
          authorized: false,
          error: 'Invalid or malformed X-PAYMENT header'
        };
      }

      // Build payment requirements using x402 SDK
      const network = this.config.payment?.network || 'base-sepolia';
      const recipientAddress = this.config.payment?.recipient || '';
      const checksummedAddress = getAddress(recipientAddress);
      const resourceUrl = requestUrl || `http://localhost:8000/message`;
      
      // Use x402 SDK to process price to atomic amount
      const atomicAmountResult = processPriceToAtomicAmount(pricing.x402, network as any);
      if ('error' in atomicAmountResult) {
        this.logger.error(`Error processing price: ${atomicAmountResult.error}`);
        return {
          authorized: false,
          error: `Invalid price format: ${atomicAmountResult.error}`
        };
      }

      const { maxAmountRequired, asset } = atomicAmountResult;

      // Construct requirements exactly as x402 SDK expects
      const requirements: any = {
        scheme: 'exact' as const,
        network: network as any,
        maxAmountRequired,
        resource: resourceUrl,
        description: `Payment for MCP tool: ${toolName || 'unknown'}`,
        mimeType: 'application/json',
        payTo: checksummedAddress,
        maxTimeoutSeconds: 30,
        asset: asset.address
      };

      // Add EIP-712 info if available
      if ('eip712' in asset) {
        requirements.extra = {
          name: asset.eip712.name,
          version: asset.eip712.version
        };
      }

      this.logger.info(`Verifying payment for ${toolName}...`);
      this.logger.debug(`Requirements: ${JSON.stringify(requirements, null, 2)}`);

      // Verify with facilitator using x402 SDK
      const verificationResult = await this.verifyPaymentFunc(decodedPayment, requirements);

      if (!verificationResult.isValid) {
        this.logger.warn(`❌ Payment verification failed: ${verificationResult.invalidReason}`);
        this.logger.warn(`Payer: ${verificationResult.payer}`);
        return {
          authorized: false,
          error: `Payment verification failed: ${verificationResult.invalidReason}`
        };
      }

      this.logger.info(`✅ x402 payment verified: ${pricing.x402} from ${verificationResult.payer}`);
      
      // Optionally settle the payment
      try {
        const settlementResult = await this.settlePaymentFunc(decodedPayment, requirements);
        this.logger.info(`Payment settled: txHash=${settlementResult.txHash || 'pending'}`);
      } catch (settleError) {
        this.logger.warn(`Payment settlement queued (will process async): ${settleError}`);
        // Continue anyway - payment was verified even if settlement is delayed
      }

      return {
        authorized: true,
        pricing: { amount: pricing.x402, method: 'x402' }
      };

    } catch (error) {
      this.logger.error(`x402 payment verification error: ${error}`);
      return {
        authorized: false,
        error: `Payment verification error: ${error}`
      };
    }
  }

  /**
   * Get pricing configuration for a specific tool
   */
  private getToolPricing(toolName: string, serverId: string): ToolPricing | undefined {
    const serverConfig = this.config.servers.find(s => s.name === serverId);
    if (!serverConfig) {
      return undefined;
    }

    // Check for tool-specific pricing
    const toolConfig = serverConfig.tools?.find(t => t.name === toolName);
    if (toolConfig?.pricing) {
      return toolConfig.pricing;
    }

    // Fall back to server default pricing
    return serverConfig.defaultPricing;
  }

  /**
   * Generate 402 Payment Required response
   */
  generatePaymentRequiredResponse(
    toolName: string,
    serverId: string,
    requestUrl?: string
  ): PaymentRequirements {
    const pricing = this.getToolPricing(toolName, serverId);
    const amount = pricing?.x402 || '$0.01';
    const network = this.config.payment?.network || 'base-sepolia';
    
    // x402 requires a full URL for the resource field
    const resourceUrl = requestUrl || `http://localhost:8000/tools/${toolName}`;
    
    // Get checksummed address (required by x402)
    const recipientAddress = this.config.payment?.recipient || '';
    const checksummedAddress = getAddress(recipientAddress);

    // Use x402 SDK to process price to atomic amount
    const atomicAmountResult = processPriceToAtomicAmount(amount, network as any);
    if ('error' in atomicAmountResult) {
      this.logger.error(`Error processing price: ${atomicAmountResult.error}`);
      throw new Error(`Invalid price format: ${atomicAmountResult.error}`);
    }

    const { maxAmountRequired, asset } = atomicAmountResult;

    const requirement: any = {
      scheme: 'exact',
      network: network,
      maxAmountRequired,
      resource: resourceUrl,
      description: `Payment for MCP tool: ${toolName}`,
      mimeType: 'application/json',
      payTo: checksummedAddress,
      maxTimeoutSeconds: 30,
      asset: asset.address
    };

    // Add EIP-712 info if available
    if ('eip712' in asset) {
      requirement.extra = {
        name: asset.eip712.name,
        version: asset.eip712.version
      };
    }

    return {
      x402Version: 1,
      accepts: [requirement],
      error: `Payment required for tool '${toolName}'. Amount: ${amount}. Use X-PAYMENT header (x402) or X-ELIZA-API-KEY.`
    };
  }

  /**
   * Convert dollar amount to atomic units (USDC has 6 decimals)
   */
  private parseAmountToAtomicUnits(amount: string): string {
    const cleanAmount = amount.replace(/[^0-9.]/g, '');
    const value = parseFloat(cleanAmount);

    if (isNaN(value)) {
      return '10000'; // Default to $0.01
    }

    // USDC has 6 decimals
    const atomicUnits = Math.floor(value * 1_000_000);
    return atomicUnits.toString();
  }

  /**
   * Get USDC contract address for network
   */
  private getUsdcAddress(network: string): string {
    return PaymentMiddleware.USDC_ADDRESSES[network] ||
           PaymentMiddleware.USDC_ADDRESSES['base-sepolia']!;
  }

  /**
   * Get payment mode for a server
   */
  getServerPaymentMode(serverId: string): 'passthrough' | 'markup' | 'absorb' | undefined {
    const serverConfig = this.config.servers.find(s => s.name === serverId);
    return serverConfig?.paymentMode;
  }

  /**
   * Calculate markup amount based on downstream price
   * @param downstreamPrice - Price from downstream API (e.g., "$0.01")
   * @param markup - Markup configuration (e.g., "20%" or "$0.005")
   * @returns Final price with markup applied
   */
  calculateMarkup(downstreamPrice: string, markup: string): string {
    const downstreamValue = parseFloat(downstreamPrice.replace(/[^0-9.]/g, ''));

    if (markup.includes('%')) {
      // Percentage markup
      const percentage = parseFloat(markup.replace('%', ''));
      const markupValue = downstreamValue * (percentage / 100);
      return `$${(downstreamValue + markupValue).toFixed(6)}`;
    } else {
      // Fixed amount markup
      const markupValue = parseFloat(markup.replace(/[^0-9.]/g, ''));
      return `$${(downstreamValue + markupValue).toFixed(6)}`;
    }
  }

  /**
   * Extract payment headers for forwarding (passthrough mode)
   */
  extractPaymentHeaders(headers?: Record<string, string>): Record<string, string> {
    if (!headers) return {};

    const paymentHeaders: Record<string, string> = {};

    // Forward x402 payment headers
    if (headers['x-payment']) {
      paymentHeaders['x-payment'] = headers['x-payment'];
    }
    if (headers['X-Payment']) {
      paymentHeaders['X-Payment'] = headers['X-Payment'];
    }

    // Forward API key headers
    if (headers['x-eliza-api-key']) {
      paymentHeaders['x-eliza-api-key'] = headers['x-eliza-api-key'];
    }
    if (headers['X-ELIZA-API-KEY']) {
      paymentHeaders['X-ELIZA-API-KEY'] = headers['X-ELIZA-API-KEY'];
    }
    if (headers['authorization']) {
      paymentHeaders['authorization'] = headers['authorization'];
    }
    if (headers['Authorization']) {
      paymentHeaders['Authorization'] = headers['Authorization'];
    }

    return paymentHeaders;
  }

  /**
   * Get payment statistics
   */
  getStats() {
    return {
      enabled: this.config.payment?.enabled || false,
      apiKeys: this.apiKeyCache.size,
      network: this.config.payment?.network,
      recipient: this.config.payment?.recipient,
      outboundWallet: this.config.payment?.outboundWallet ? 'configured' : 'not configured'
    };
  }
}