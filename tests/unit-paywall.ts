#!/usr/bin/env node

/**
 * Unit tests for paywall enforcement functionality
 */

import { PaywallGuard } from '../src/paywall-guard.js';
import { type McpServerConfig, type VerifiedPaymentReceipt } from '../src/types.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class PaywallTestSuite {
  private results: TestResult[] = [];
  private logger: Console;

  constructor(logger: Console = console) {
    this.logger = logger;
  }

  async runAll(): Promise<void> {
    this.logger.info('🧪 Running Paywall Unit Tests...\n');

    // Test configuration validation
    await this.testPaywallConfigValidation();
    await this.testPricingResolution();
    await this.testMaxValueLimits();

    // Test session management
    await this.testSessionAuthorization();
    await this.testSessionExpiry();
    await this.testSessionBalanceTracking();

    // Test payment verification (mocked)
    await this.testPaymentVerification();
    await this.testPaymentRecording();

    // Test utility functions
    await this.testSessionIdGeneration();
    await this.testWalletCreation();

    this.printResults();
  }

  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await testFn();
      this.results.push({
        name,
        passed: true,
        duration: Date.now() - start
      });
      this.logger.info(`✅ ${name}`);
    } catch (error) {
      this.results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start
      });
      this.logger.error(`❌ ${name}: ${error}`);
    }
  }

  private async testPaywallConfigValidation(): Promise<void> {
    await this.runTest('Paywall configuration validation', async () => {
      const enabledConfig: McpServerConfig = {
        name: 'test-server',
        enabled: true,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        paywall: {
          enabled: true,
          wallet: {
            type: 'evm',
            network: 'base-sepolia',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          },
          pricing: {
            defaultPriceMicroUSDC: '1000',
            perTool: {
              'expensive-tool': '5000'
            }
          },
          policy: {
            freeList: true,
            requireForCalls: true
          }
        }
      };

      const disabledConfig: McpServerConfig = {
        name: 'free-server',
        enabled: true,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000
      };

      // Test enabled detection
      if (!PaywallGuard.isPaywallEnabled(enabledConfig)) {
        throw new Error('Should detect enabled paywall');
      }

      if (PaywallGuard.isPaywallEnabled(disabledConfig)) {
        throw new Error('Should detect disabled paywall');
      }

      // Test max value parsing
      const maxValue = PaywallGuard.getMaxValueMicroUSDC(enabledConfig);
      if (maxValue !== 100_000n) {
        throw new Error(`Expected default max value 100000, got ${maxValue}`);
      }
    });
  }

  private async testPricingResolution(): Promise<void> {
    await this.runTest('Pricing resolution logic', async () => {
      const config: McpServerConfig = {
        name: 'pricing-test',
        enabled: true,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        paywall: {
          enabled: true,
          wallet: {
            type: 'evm',
            network: 'base-sepolia',
            privateKeyEnv: 'TEST_KEY'
          },
          pricing: {
            defaultPriceMicroUSDC: '1000',
            perTool: {
              'expensive-tool': '5000',
              'free-tool': '0'
            },
            perResource: {
              'file:///expensive.txt': '2000'
            },
            perPrompt: {
              'premium-prompt': '3000'
            }
          },
          policy: {
            freeList: true,
            requireForCalls: true
          }
        }
      };

      // Test specific pricing
      const toolPrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', 'expensive-tool', config);
      if (toolPrice !== 5000n) {
        throw new Error(`Expected tool price 5000, got ${toolPrice}`);
      }

      const resourcePrice = PaywallGuard.getRequiredPriceMicroUSDC('resource', 'file:///expensive.txt', config);
      if (resourcePrice !== 2000n) {
        throw new Error(`Expected resource price 2000, got ${resourcePrice}`);
      }

      const promptPrice = PaywallGuard.getRequiredPriceMicroUSDC('prompt', 'premium-prompt', config);
      if (promptPrice !== 3000n) {
        throw new Error(`Expected prompt price 3000, got ${promptPrice}`);
      }

      // Test default pricing
      const defaultPrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', 'unknown-tool', config);
      if (defaultPrice !== 1000n) {
        throw new Error(`Expected default price 1000, got ${defaultPrice}`);
      }

      // Test free item
      const freePrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', 'free-tool', config);
      if (freePrice !== null) {
        throw new Error(`Expected free tool to return null, got ${freePrice}`);
      }

      // Test disabled paywall
      const disabledConfig: McpServerConfig = { 
        name: 'disabled',
        enabled: true,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000
      };
      const disabledPrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', 'any-tool', disabledConfig);
      if (disabledPrice !== null) {
        throw new Error(`Expected disabled paywall to return null, got ${disabledPrice}`);
      }
    });
  }

  private async testMaxValueLimits(): Promise<void> {
    await this.runTest('Maximum value limit validation', async () => {
      const customMaxConfig: McpServerConfig = {
        name: 'custom-max',
        enabled: true,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        paywall: {
          enabled: true,
          wallet: {
            type: 'evm',
            network: 'base',
            privateKeyEnv: 'TEST_KEY'
          },
          maxValueMicroUSDC: '500000', // 0.50 USDC
          pricing: {},
          policy: {
            freeList: true,
            requireForCalls: true
          }
        }
      };

      const maxValue = PaywallGuard.getMaxValueMicroUSDC(customMaxConfig);
      if (maxValue !== 500_000n) {
        throw new Error(`Expected max value 500000, got ${maxValue}`);
      }

      // Test invalid max value falls back to default
      const invalidMaxConfig: McpServerConfig = {
        name: 'invalid-max',
        enabled: true,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        paywall: {
          enabled: true,
          wallet: {
            type: 'evm',
            network: 'base',
            privateKeyEnv: 'TEST_KEY'
          },
          maxValueMicroUSDC: 'invalid',
          pricing: {},
          policy: {
            freeList: true,
            requireForCalls: true
          }
        }
      };

      const fallbackMax = PaywallGuard.getMaxValueMicroUSDC(invalidMaxConfig);
      if (fallbackMax !== 100_000n) {
        throw new Error(`Expected fallback max value 100000, got ${fallbackMax}`);
      }
    });
  }

  private async testSessionAuthorization(): Promise<void> {
    await this.runTest('Session authorization tracking', async () => {
      const guard = new PaywallGuard();
      const sessionId = PaywallGuard.generateSessionId('test');

      // Initially not authorized
      const initialAuth = await guard.isSessionAuthorized(sessionId, 1000n);
      if (initialAuth) {
        throw new Error('Session should not be initially authorized');
      }

      // Create a mock receipt
      const receipt: VerifiedPaymentReceipt = {
        paymentId: 'test-payment',
        amount: 5000n,
        network: 'base-sepolia',
        recipient: 'test-recipient',
        timestamp: new Date(),
        txHash: '0xtest'
      };

      // Record authorization
      await guard.recordAuthorization(sessionId, receipt, 0n);

      // Now should be authorized for amounts within balance
      const authorizedSmall = await guard.isSessionAuthorized(sessionId, 1000n);
      if (!authorizedSmall) {
        throw new Error('Session should be authorized for small amount');
      }

      const authorizedExact = await guard.isSessionAuthorized(sessionId, 5000n);
      if (!authorizedExact) {
        throw new Error('Session should be authorized for exact amount');
      }

      const authorizedLarge = await guard.isSessionAuthorized(sessionId, 6000n);
      if (authorizedLarge) {
        throw new Error('Session should not be authorized for amount exceeding balance');
      }

      guard.destroy();
    });
  }

  private async testSessionExpiry(): Promise<void> {
    await this.runTest('Session expiry handling', async () => {
      const guard = new PaywallGuard();
      const sessionId = PaywallGuard.generateSessionId('expiry-test');

      // Create an expired receipt (hack the timestamp)
      const expiredReceipt: VerifiedPaymentReceipt = {
        paymentId: 'expired-payment',
        amount: 1000n,
        network: 'base-sepolia',
        recipient: 'test-recipient',
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        txHash: '0xexpired'
      };

      await guard.recordAuthorization(sessionId, expiredReceipt, 0n);

      // Manually expire the session by modifying internal state (for testing)
      const sessions = (guard as any).sessions as Map<string, any>;
      const session = sessions.get(sessionId);
      if (session) {
        session.expiresAt = new Date(Date.now() - 1000); // 1 second ago
      }

      // Should not be authorized after expiry
      const authorized = await guard.isSessionAuthorized(sessionId, 500n);
      if (authorized) {
        throw new Error('Expired session should not be authorized');
      }

      guard.destroy();
    });
  }

  private async testSessionBalanceTracking(): Promise<void> {
    await this.runTest('Session balance tracking and deduction', async () => {
      const guard = new PaywallGuard();
      const sessionId = PaywallGuard.generateSessionId('balance-test');

      const receipt: VerifiedPaymentReceipt = {
        paymentId: 'balance-payment',
        amount: 10000n,
        network: 'base-sepolia',
        recipient: 'test-recipient',
        timestamp: new Date(),
        txHash: '0xbalance'
      };

      // Record initial authorization
      await guard.recordAuthorization(sessionId, receipt, 0n);

      // Check initial balance
      let balance = guard.getSessionBalance(sessionId);
      if (balance !== 10000n) {
        throw new Error(`Expected initial balance 10000, got ${balance}`);
      }

      // Deduct some amount
      const deducted = await guard.deductFromSession(sessionId, 3000n);
      if (!deducted) {
        throw new Error('Should be able to deduct within balance');
      }

      // Check remaining balance
      balance = guard.getSessionBalance(sessionId);
      if (balance !== 7000n) {
        throw new Error(`Expected remaining balance 7000, got ${balance}`);
      }

      // Try to deduct more than remaining
      const overDeducted = await guard.deductFromSession(sessionId, 8000n);
      if (overDeducted) {
        throw new Error('Should not be able to deduct more than balance');
      }

      // Balance should remain unchanged after failed deduction
      balance = guard.getSessionBalance(sessionId);
      if (balance !== 7000n) {
        throw new Error(`Balance should remain 7000 after failed deduction, got ${balance}`);
      }

      guard.destroy();
    });
  }

  private async testPaymentVerification(): Promise<void> {
    await this.runTest('Payment verification (mocked)', async () => {
      const guard = new PaywallGuard();

      // Test basic verification (this is mocked in our implementation)
      const receipt = await guard.verifyX402Payment(
        'mock-payment-data',
        1000n,
        'base-sepolia',
        'test-recipient'
      );

      if (!receipt.paymentId || receipt.amount !== 1000n) {
        throw new Error('Payment verification should return valid receipt');
      }

      if (receipt.network !== 'base-sepolia' || receipt.recipient !== 'test-recipient') {
        throw new Error('Receipt should contain correct network and recipient');
      }

      guard.destroy();
    });
  }

  private async testPaymentRecording(): Promise<void> {
    await this.runTest('Payment recording and statistics', async () => {
      const guard = new PaywallGuard();
      const sessionId = PaywallGuard.generateSessionId('recording-test');

      const receipt1: VerifiedPaymentReceipt = {
        paymentId: 'payment-1',
        amount: 5000n,
        network: 'base-sepolia',
        recipient: 'test-recipient',
        timestamp: new Date(),
        txHash: '0xtest1'
      };

      const receipt2: VerifiedPaymentReceipt = {
        paymentId: 'payment-2',
        amount: 3000n,
        network: 'base-sepolia',
        recipient: 'test-recipient',
        timestamp: new Date(),
        txHash: '0xtest2'
      };

      // Record multiple payments
      await guard.recordAuthorization(sessionId, receipt1, 1000n);
      await guard.recordAuthorization(sessionId, receipt2, 0n);

      // Check statistics
      const stats = guard.getStats();
      if (stats.totalPayments !== 2) {
        throw new Error(`Expected 2 total payments, got ${stats.totalPayments}`);
      }

      if (stats.totalAmount !== 8000n) {
        throw new Error(`Expected total amount 8000, got ${stats.totalAmount}`);
      }

      if (stats.activeSessions !== 1) {
        throw new Error(`Expected 1 active session, got ${stats.activeSessions}`);
      }

      // Check session balance (5000 + 3000 - 1000 = 7000)
      const balance = guard.getSessionBalance(sessionId);
      if (balance !== 7000n) {
        throw new Error(`Expected session balance 7000, got ${balance}`);
      }

      guard.destroy();
    });
  }

  private async testSessionIdGeneration(): Promise<void> {
    await this.runTest('Session ID generation', async () => {
      const id1 = PaywallGuard.generateSessionId('client1');
      const id2 = PaywallGuard.generateSessionId('client1');
      const id3 = PaywallGuard.generateSessionId('client2');

      if (id1 === id2) {
        throw new Error('Session IDs should be unique even for same client');
      }

      if (id1.length !== 16) {
        throw new Error(`Expected session ID length 16, got ${id1.length}`);
      }

      if (!/^[a-f0-9]+$/.test(id1)) {
        throw new Error('Session ID should be hexadecimal');
      }
    });
  }

  private async testWalletCreation(): Promise<void> {
    await this.runTest('Wallet creation validation', async () => {
      // Test invalid config
      const invalidConfig: McpServerConfig = {
        name: 'invalid-wallet',
        enabled: true,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000
      };

      try {
        await PaywallGuard.createPaywallWallet(invalidConfig);
        throw new Error('Should throw error for disabled paywall');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('not enabled')) {
          throw new Error(`Expected "not enabled" error, got: ${error}`);
        }
      }

      // Test missing private key
      const missingKeyConfig: McpServerConfig = {
        name: 'missing-key',
        enabled: true,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        paywall: {
          enabled: true,
          wallet: {
            type: 'evm',
            network: 'base-sepolia',
            privateKeyEnv: 'NONEXISTENT_KEY'
          },
          pricing: {},
          policy: {
            freeList: true,
            requireForCalls: true
          }
        }
      };

      try {
        await PaywallGuard.createPaywallWallet(missingKeyConfig);
        throw new Error('Should throw error for missing private key');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('Missing private key')) {
          throw new Error(`Expected "Missing private key" error, got: ${error}`);
        }
      }
    });
  }

  private printResults(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    this.logger.info(`\n📊 Test Results:`);
    this.logger.info(`✅ Passed: ${passed}`);
    this.logger.info(`❌ Failed: ${failed}`);
    this.logger.info(`⏱️  Total time: ${totalTime}ms`);

    if (failed > 0) {
      this.logger.info(`\n🔍 Failed tests:`);
      this.results.filter(r => !r.passed).forEach(result => {
        this.logger.error(`  • ${result.name}: ${result.error}`);
      });
      process.exit(1);
    } else {
      this.logger.info(`\n🎉 All tests passed!`);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testSuite = new PaywallTestSuite();
  testSuite.runAll().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

export { PaywallTestSuite };
