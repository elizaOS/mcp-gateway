import axios, { type AxiosInstance } from 'axios';
import { withPaymentInterceptor } from 'x402-axios';
import { privateKeyToAccount } from 'viem/accounts';
import type { GatewayConfig } from '../types/index';

/**
 * Client for making outbound x402 payments to downstream APIs
 * Uses x402-axios to automatically handle 402 Payment Required responses
 */
export class X402PaymentClient {
  private axiosInstance: AxiosInstance;
  private config: GatewayConfig;
  private logger: Console;
  private walletAddress?: string;

  constructor(config: GatewayConfig, logger: Console = console) {
    this.config = config;
    this.logger = logger;

    // Create base axios instance
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // If outbound wallet is configured, wrap with payment interceptor
    if (config.payment?.outboundWallet) {
      try {
        const account = privateKeyToAccount(config.payment.outboundWallet as `0x${string}`);
        this.walletAddress = account.address;
        this.axiosInstance = withPaymentInterceptor(this.axiosInstance, account);
        this.logger.info(`X402 payment client initialized with wallet: ${this.walletAddress}`);
      } catch (error) {
        this.logger.error(`Failed to initialize x402 payment client: ${error}`);
        throw error;
      }
    }
  }

  /**
   * Create a payment-enabled HTTP client for a specific server
   * Supports server-specific wallet override
   */
  createServerClient(serverId: string, serverWallet?: string): AxiosInstance {
    // If server has its own wallet, create a new client
    if (serverWallet) {
      try {
        const account = privateKeyToAccount(serverWallet as `0x${string}`);
        const serverAxios = axios.create({
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const paymentClient = withPaymentInterceptor(serverAxios, account);
        this.logger.info(`Created server-specific payment client for ${serverId}: ${account.address}`);
        return paymentClient;
      } catch (error) {
        this.logger.error(`Failed to create server-specific payment client for ${serverId}: ${error}`);
        return this.axiosInstance;
      }
    }

    // Otherwise, use the global payment client
    return this.axiosInstance;
  }

  /**
   * Make an HTTP request with automatic x402 payment handling
   */
  async request<T = any>(config: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    data?: any;
    headers?: Record<string, string>;
    serverId?: string;
    serverWallet?: string;
  }): Promise<T> {
    const client = config.serverId && config.serverWallet
      ? this.createServerClient(config.serverId, config.serverWallet)
      : this.axiosInstance;

    try {
      const response = await client.request({
        url: config.url,
        method: config.method,
        data: config.data,
        headers: config.headers || {}
      });

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 402) {
        this.logger.warn(`Payment required for ${config.url}, x402 interceptor should handle automatically`);
      }
      throw error;
    }
  }

  /**
   * Forward a request with payment headers (passthrough mode)
   * Inbound payment headers are forwarded to downstream API
   */
  async forwardWithPayment<T = any>(config: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    data?: any;
    headers?: Record<string, string>;
    inboundPaymentHeaders?: Record<string, string>;
  }): Promise<T> {
    // Merge inbound payment headers with request headers
    const headers = {
      ...config.headers,
      ...config.inboundPaymentHeaders
    };

    try {
      const response = await axios.request({
        url: config.url,
        method: config.method,
        data: config.data,
        headers,
        timeout: 30000
      });

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 402) {
        this.logger.error(`Payment required for ${config.url} but passthrough mode failed`);
      }
      throw error;
    }
  }

  /**
   * Get wallet address being used for payments
   */
  getWalletAddress(): string | undefined {
    return this.walletAddress;
  }

  /**
   * Check if payment client is enabled
   */
  isEnabled(): boolean {
    return !!this.config.payment?.outboundWallet;
  }
}
