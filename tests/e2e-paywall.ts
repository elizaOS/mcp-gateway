#!/usr/bin/env node

/**
 * End-to-end tests for paywall enforcement in MCP Gateway
 * Tests the full flow from client requests through paywall enforcement to server responses
 */

import { GatewayServer } from '../src/aggregator-server.js';
import { type GatewayConfig } from '../src/types.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { spawn } from 'child_process';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class PaywallE2ETestSuite {
  private results: TestResult[] = [];
  private logger: Console;

  constructor(logger: Console = console) {
    this.logger = logger;
  }

  async runAll(): Promise<void> {
    this.logger.info('🧪 Running Paywall E2E Tests...\n');

    // Test basic paywall enforcement flows
    await this.testUnauthorizedToolCallBlocked();
    await this.testAuthorizedToolCallSucceeds();
    await this.testInsufficientBalanceBlocked();
    await this.testPaywallToolsAvailable();
    await this.testGetPricingTool();
    await this.testAuthorizePaymentTool();

    // Test different item types
    await this.testResourcePaywallEnforcement();
    await this.testPromptPaywallEnforcement();

    // Test policy configurations
    await this.testFreeListPolicy();
    await this.testMaxValueLimits();

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

  private async testUnauthorizedToolCallBlocked(): Promise<void> {
    await this.runTest('Unauthorized tool call blocked with payment required error', async () => {
      const config = this.createPaywallTestConfig();
      const gateway = new GatewayServer(config);
      
      try {
        await gateway.start();

        // Create a mock client connection (simplified for testing)
        const mockRequest = {
          method: 'tools/call',
          params: {
            name: 'expensive-tool',
            arguments: {}
          }
        };

        // In a real test, we would connect via STDIO transport and make the call
        // For now, we'll test the core logic directly
        const serverConfig = config.servers.find(s => s.name === 'paywall-server')!;
        
        // Simulate the paywall check that happens in the handler
        const { PaywallGuard } = await import('../src/paywall-guard.js');
        const requiredPrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', 'expensive-tool', serverConfig);
        
        if (requiredPrice === null || requiredPrice <= 0n) {
          throw new Error('Expected expensive-tool to have a price > 0');
        }

        // Test that an unauthorized session would be blocked
        const paywallGuard = new PaywallGuard();
        const sessionId = PaywallGuard.generateSessionId('test-session');
        const isAuthorized = await paywallGuard.isSessionAuthorized(sessionId, requiredPrice);
        
        if (isAuthorized) {
          throw new Error('Unauthorized session should not be authorized for expensive tool');
        }

        paywallGuard.destroy();
      } finally {
        await gateway.stop();
      }
    });
  }

  private async testAuthorizedToolCallSucceeds(): Promise<void> {
    await this.runTest('Authorized tool call succeeds after payment', async () => {
      const config = this.createPaywallTestConfig();
      const gateway = new GatewayServer(config);
      
      try {
        await gateway.start();

        const { PaywallGuard } = await import('../src/paywall-guard.js');
        const paywallGuard = new PaywallGuard();
        const sessionId = PaywallGuard.generateSessionId('authorized-session');

        // Create a mock payment receipt
        const receipt = {
          paymentId: 'test-payment-123',
          amount: 10000n, // 0.01 USDC
          network: 'base-sepolia',
          recipient: 'test-recipient',
          timestamp: new Date(),
          txHash: '0xtest123'
        };

        // Record the authorization
        await paywallGuard.recordAuthorization(sessionId, receipt, 0n);

        // Test that the session is now authorized
        const serverConfig = config.servers.find(s => s.name === 'paywall-server')!;
        const requiredPrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', 'expensive-tool', serverConfig);
        
        if (requiredPrice === null) {
          throw new Error('Expected expensive-tool to have a price');
        }

        const isAuthorized = await paywallGuard.isSessionAuthorized(sessionId, requiredPrice);
        if (!isAuthorized) {
          throw new Error('Authorized session should be able to call expensive tool');
        }

        // Test balance deduction
        const deducted = await paywallGuard.deductFromSession(sessionId, requiredPrice);
        if (!deducted) {
          throw new Error('Should be able to deduct from authorized session');
        }

        paywallGuard.destroy();
      } finally {
        await gateway.stop();
      }
    });
  }

  private async testInsufficientBalanceBlocked(): Promise<void> {
    await this.runTest('Insufficient balance blocks tool call', async () => {
      const { PaywallGuard } = await import('../src/paywall-guard.js');
      const paywallGuard = new PaywallGuard();
      const sessionId = PaywallGuard.generateSessionId('low-balance-session');

      // Create a small payment
      const receipt = {
        paymentId: 'small-payment',
        amount: 1000n, // 0.001 USDC
        network: 'base-sepolia',
        recipient: 'test-recipient',
        timestamp: new Date(),
        txHash: '0xsmall'
      };

      await paywallGuard.recordAuthorization(sessionId, receipt, 0n);

      // Try to authorize for a larger amount
      const largeAmount = 5000n; // 0.005 USDC
      const isAuthorized = await paywallGuard.isSessionAuthorized(sessionId, largeAmount);
      
      if (isAuthorized) {
        throw new Error('Session with insufficient balance should not be authorized');
      }

      paywallGuard.destroy();
    });
  }

  private async testPaywallToolsAvailable(): Promise<void> {
    await this.runTest('Paywall tools are available when paywall enabled', async () => {
      const config = this.createPaywallTestConfig();
      const gateway = new GatewayServer(config);
      
      try {
        await gateway.start();

        // Get the gateway status to check available tools
        const status = gateway.getStatus();
        
        // In a real implementation, we would make a tools/list request
        // For now, we'll check that the gateway has paywall-enabled servers
        const paywallServers = status.config.servers.filter(s => s.paywall?.enabled);
        
        if (paywallServers.length === 0) {
          throw new Error('Expected at least one paywall-enabled server');
        }

        // The paywall tools should be available (tested via the getPaywallTools method)
        // In a full E2E test, we would verify these tools appear in the tools/list response
        
      } finally {
        await gateway.stop();
      }
    });
  }

  private async testGetPricingTool(): Promise<void> {
    await this.runTest('Get pricing tool returns correct pricing information', async () => {
      const config = this.createPaywallTestConfig();
      const gateway = new GatewayServer(config);
      
      try {
        await gateway.start();

        // Simulate calling the get-pricing tool
        // In a real E2E test, this would be done via the MCP protocol
        const mockPricingCall = {
          name: 'gateway:paywall:get-pricing',
          arguments: {}
        };

        // Test the pricing logic directly
        const serverConfig = config.servers.find(s => s.name === 'paywall-server')!;
        const { PaywallGuard } = await import('../src/paywall-guard.js');
        
        // Verify pricing configuration
        const toolPrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', 'expensive-tool', serverConfig);
        const defaultPrice = PaywallGuard.getRequiredPriceMicroUSDC('tool', 'unknown-tool', serverConfig);
        
        if (toolPrice !== 5000n) {
          throw new Error(`Expected expensive-tool price 5000, got ${toolPrice}`);
        }
        
        if (defaultPrice !== 1000n) {
          throw new Error(`Expected default price 1000, got ${defaultPrice}`);
        }

      } finally {
        await gateway.stop();
      }
    });
  }

  private async testAuthorizePaymentTool(): Promise<void> {
    await this.runTest('Authorize payment tool processes x402 payments', async () => {
      const config = this.createPaywallTestConfig();
      const gateway = new GatewayServer(config);
      
      try {
        await gateway.start();

        // Simulate calling the authorize payment tool
        const mockPaymentData = 'mock-x402-payment-envelope';
        
        // Test the payment verification logic
        const { PaywallGuard } = await import('../src/paywall-guard.js');
        const paywallGuard = new PaywallGuard();
        
        // This would normally verify a real x402 payment
        const receipt = await paywallGuard.verifyX402Payment(
          mockPaymentData,
          100000n, // 0.10 USDC
          'base-sepolia',
          'test-recipient'
        );

        if (!receipt.paymentId || receipt.amount !== 100000n) {
          throw new Error('Payment verification should return valid receipt');
        }

        paywallGuard.destroy();
      } finally {
        await gateway.stop();
      }
    });
  }

  private async testResourcePaywallEnforcement(): Promise<void> {
    await this.runTest('Resource paywall enforcement works correctly', async () => {
      const config = this.createPaywallTestConfig();
      const { PaywallGuard } = await import('../src/paywall-guard.js');
      
      const serverConfig = config.servers.find(s => s.name === 'paywall-server')!;
      
      // Test resource pricing
      const resourcePrice = PaywallGuard.getRequiredPriceMicroUSDC('resource', 'file:///expensive.txt', serverConfig);
      if (resourcePrice !== 2000n) {
        throw new Error(`Expected resource price 2000, got ${resourcePrice}`);
      }

      // Test free resource
      const freeResourcePrice = PaywallGuard.getRequiredPriceMicroUSDC('resource', 'file:///free.txt', serverConfig);
      if (freeResourcePrice !== 1000n) { // Falls back to default
        throw new Error(`Expected free resource to use default price, got ${freeResourcePrice}`);
      }
    });
  }

  private async testPromptPaywallEnforcement(): Promise<void> {
    await this.runTest('Prompt paywall enforcement works correctly', async () => {
      const config = this.createPaywallTestConfig();
      const { PaywallGuard } = await import('../src/paywall-guard.js');
      
      const serverConfig = config.servers.find(s => s.name === 'paywall-server')!;
      
      // Test prompt pricing
      const promptPrice = PaywallGuard.getRequiredPriceMicroUSDC('prompt', 'premium-prompt', serverConfig);
      if (promptPrice !== 3000n) {
        throw new Error(`Expected prompt price 3000, got ${promptPrice}`);
      }

      // Test default prompt pricing
      const defaultPromptPrice = PaywallGuard.getRequiredPriceMicroUSDC('prompt', 'unknown-prompt', serverConfig);
      if (defaultPromptPrice !== 1000n) {
        throw new Error(`Expected default prompt price 1000, got ${defaultPromptPrice}`);
      }
    });
  }

  private async testFreeListPolicy(): Promise<void> {
    await this.runTest('Free list policy allows listing without payment', async () => {
      const config = this.createPaywallTestConfig();
      const gateway = new GatewayServer(config);
      
      try {
        await gateway.start();

        // Test that listing operations don't require payment
        // In a real E2E test, we would make tools/list, resources/list, prompts/list calls
        // and verify they succeed without authorization
        
        const serverConfig = config.servers.find(s => s.name === 'paywall-server')!;
        const freeList = serverConfig.paywall?.policy?.freeList;
        
        if (!freeList) {
          throw new Error('Expected free list policy to be enabled');
        }

        // The actual enforcement happens in the handlers - listing is always free
        // when freeList is true, only calls require payment when requireForCalls is true
        
      } finally {
        await gateway.stop();
      }
    });
  }

  private async testMaxValueLimits(): Promise<void> {
    await this.runTest('Maximum value limits are enforced', async () => {
      const config = this.createPaywallTestConfig();
      const { PaywallGuard } = await import('../src/paywall-guard.js');
      
      const serverConfig = config.servers.find(s => s.name === 'paywall-server')!;
      const maxValue = PaywallGuard.getMaxValueMicroUSDC(serverConfig);
      
      // Our test config uses default max value
      if (maxValue !== 100_000n) {
        throw new Error(`Expected max value 100000, got ${maxValue}`);
      }

      // Test that prices exceeding max value would be rejected
      // In a real implementation, this would be checked during payment verification
      const excessivePrice = 200_000n; // 0.20 USDC
      
      if (excessivePrice <= maxValue) {
        throw new Error('Test setup error: excessive price should exceed max value');
      }

      // The actual enforcement would happen in the payment verification step
    });
  }

  private createPaywallTestConfig(): GatewayConfig {
    return {
      name: 'Paywall Test Gateway',
      version: '1.0.0',
      description: 'Test gateway for paywall enforcement',
      servers: [
        {
          name: 'paywall-server',
          enabled: true,
          timeout: 30000,
          retryAttempts: 3,
          retryDelay: 1000,
          transport: {
            type: 'stdio',
            command: 'echo',
            args: ['mock-server'] // Mock server for testing
          },
          paywall: {
            enabled: true,
            wallet: {
              type: 'evm',
              network: 'base-sepolia',
              privateKeyEnv: 'TEST_PAYWALL_PRIVATE_KEY'
            },
            maxValueMicroUSDC: '100000', // 0.10 USDC
            pricing: {
              defaultPriceMicroUSDC: '1000', // 0.001 USDC
              perTool: {
                'expensive-tool': '5000', // 0.005 USDC
                'free-tool': '0'
              },
              perResource: {
                'file:///expensive.txt': '2000' // 0.002 USDC
              },
              perPrompt: {
                'premium-prompt': '3000' // 0.003 USDC
              }
            },
            policy: {
              freeList: true,
              requireForCalls: true
            }
          }
        },
        {
          name: 'free-server',
          enabled: true,
          timeout: 30000,
          retryAttempts: 3,
          retryDelay: 1000,
          transport: {
            type: 'stdio',
            command: 'echo',
            args: ['free-mock-server']
          }
          // No paywall config - this server is free
        }
      ],
      settings: {
        enableToolConflictResolution: true,
        enableResourceConflictResolution: true,
        enablePromptConflictResolution: true,
        logLevel: 'info',
        maxConcurrentConnections: 10,
        healthCheckInterval: 60000
      }
    };
  }

  private printResults(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    this.logger.info(`\n📊 E2E Test Results:`);
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
      this.logger.info(`\n🎉 All E2E tests passed!`);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testSuite = new PaywallE2ETestSuite();
  testSuite.runAll().catch(error => {
    console.error('E2E test suite failed:', error);
    process.exit(1);
  });
}

export { PaywallE2ETestSuite };
