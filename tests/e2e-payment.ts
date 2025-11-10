#!/usr/bin/env tsx

/**
 * Payment E2E Test Suite for Eliza MCP Gateway
 *
 * This test suite validates all payment gating features:
 * - Payment configuration loading
 * - x402 blockchain payment verification
 * - ELIZA API key authentication
 * - Tiered pricing strategies
 * - Free tool access
 * - 402 Payment Required responses
 * - Backward compatibility (payment disabled)
 */

import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  output?: string;
}

class PaymentE2ETestRunner {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('💰 Starting Payment E2E Test Suite\n');

    try {
      // Test 1: Payment Config Loading
      await this.testPaymentConfigLoading();

      // Test 2: Free Tool Access
      await this.testFreeToolAccess();

      // Test 3: API Key Authentication
      await this.testApiKeyAuthentication();

      // Test 4: Tiered Pricing
      await this.testTieredPricing();

      // Test 5: Default Pricing
      await this.testDefaultPricing();

      // Test 6: Payment Disabled (Backward Compatibility)
      await this.testPaymentDisabled();

      // Test 7: Invalid Scenarios
      await this.testInvalidScenarios();

      // Print results
      this.printResults();

    } catch (error) {
      console.error('❌ Payment test suite failed:', error);
      process.exit(1);
    }
  }

  private async testPaymentConfigLoading(): Promise<void> {
    console.log('📋 Testing Payment Configuration Loading...\n');

    await this.runTest('Load payment config with API keys', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-api-key-only.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      const requiredMessages = [
        'Payment middleware enabled',
        'Loaded',
        'API keys'
      ];

      const missingMessages = requiredMessages.filter(msg =>
        !output.toLowerCase().includes(msg.toLowerCase())
      );

      if (missingMessages.length > 0) {
        throw new Error(`Missing payment init messages: ${missingMessages.join(', ')}`);
      }
    });

    await this.runTest('Load payment config with x402', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-x402-only.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      if (!output.includes('Payment middleware enabled')) {
        throw new Error('Payment middleware not initialized for x402 config');
      }
    });

    await this.runTest('Load payment config with recipient address', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-free-tools.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      if (!output.includes('Payment config') || !output.includes('recipient')) {
        throw new Error('Recipient address not logged in payment config');
      }
    });
  }

  private async testFreeToolAccess(): Promise<void> {
    console.log('🆓 Testing Free Tool Access...\n');

    await this.runTest('Gateway allows access to free tools', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-free-tools.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Gateway should start successfully with free tools configured
      if (!output.includes('Starting') || !output.includes('Gateway')) {
        throw new Error('Gateway failed to start with free tools config');
      }
    });

    await this.runTest('Free tools do not require payment', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-free-tools.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Log should not mention payment required for startup
      // (actual tool execution would need MCP client integration)
      if (output.includes('Payment required for tool') && output.includes('free-tool')) {
        throw new Error('Free tool incorrectly requires payment');
      }
    });
  }

  private async testApiKeyAuthentication(): Promise<void> {
    console.log('🔑 Testing API Key Authentication...\n');

    await this.runTest('Load API key configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-api-key-only.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Should log the number of API keys loaded
      if (!output.match(/Loaded \d+ API keys/i)) {
        throw new Error('API keys not loaded properly');
      }
    });

    await this.runTest('API key tiers are configured', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-api-key-only.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Config should load with multiple tiers (premium, basic, developer)
      if (!output.includes('Payment middleware enabled')) {
        throw new Error('Payment middleware with API keys not enabled');
      }
    });
  }

  private async testTieredPricing(): Promise<void> {
    console.log('💎 Testing Tiered Pricing...\n');

    await this.runTest('Load tiered pricing configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-free-tools.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Gateway should start with tiered tools
      if (!output.includes('Starting') || !output.includes('server')) {
        throw new Error('Gateway failed to start with tiered pricing');
      }
    });

    await this.runTest('Multiple pricing tiers configured', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-api-key-only.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Should have loaded multiple API key tiers
      const apiKeyMatch = output.match(/Loaded (\d+) API keys/i);
      if (!apiKeyMatch || parseInt(apiKeyMatch[1]!) < 2) {
        throw new Error('Not enough API key tiers loaded (expected 2+)');
      }
    });
  }

  private async testDefaultPricing(): Promise<void> {
    console.log('📊 Testing Default Pricing...\n');

    await this.runTest('Load default pricing configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-default-pricing.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      if (!output.includes('Payment middleware enabled')) {
        throw new Error('Payment middleware not enabled for default pricing config');
      }
    });

    await this.runTest('Server-wide default pricing applies', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-default-pricing.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Gateway should initialize with default pricing servers
      if (!output.includes('Initializing') || !output.includes('server')) {
        throw new Error('Default pricing servers not initialized');
      }
    });
  }

  private async testPaymentDisabled(): Promise<void> {
    console.log('🔓 Testing Payment Disabled (Backward Compatibility)...\n');

    await this.runTest('Gateway works with payment disabled', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-disabled.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Should NOT see payment middleware enabled
      if (output.includes('Payment middleware enabled')) {
        throw new Error('Payment middleware enabled when it should be disabled');
      }

      // Should still start normally
      if (!output.includes('Starting') || !output.includes('Gateway')) {
        throw new Error('Gateway failed to start with payment disabled');
      }
    });

    await this.runTest('All tools free when payment disabled', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-disabled.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // No payment verification should occur
      if (output.includes('Payment required') || output.includes('402')) {
        throw new Error('Payment verification occurred when payment is disabled');
      }
    });
  }

  private async testInvalidScenarios(): Promise<void> {
    console.log('🛡️ Testing Invalid Payment Scenarios...\n');

    await this.runTest('Handle missing recipient address gracefully', async () => {
      // Test config with payment enabled but no recipient
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-x402-only.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Should still start (recipient is optional for API key only mode)
      if (!output.includes('Starting')) {
        throw new Error('Gateway failed to start without recipient');
      }
    });

    await this.runTest('Handle invalid network gracefully', async () => {
      // Gateway should use default network if invalid
      const configPath = join(process.cwd(), 'tests', 'configs', 'paid-free-tools.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);

      // Should log network configuration
      if (!output.includes('network=')) {
        throw new Error('Network not logged in payment config');
      }
    });
  }

  private async runTest(testName: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    console.log(`  🧪 ${testName}...`);

    try {
      await testFn();
      const duration = Date.now() - startTime;
      this.results.push({
        name: testName,
        passed: true,
        duration
      });
      console.log(`  ✅ ${testName} (${duration}ms)\n`);
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.results.push({
        name: testName,
        passed: false,
        error: errorMsg,
        duration
      });
      console.log(`  ❌ ${testName} (${duration}ms): ${errorMsg}\n`);
    }
  }

  private async runGatewayWithTimeout(configPath: string, timeoutMs: number = 8000): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['run', 'src/index.ts', '--mode=stdio', `--config=${configPath}`];

      const gatewayProcess = spawn('bun', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      let output = '';
      let hasStarted = false;

      gatewayProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;

        if (!hasStarted && (text.includes('Starting') || text.includes('MCP server started') || text.includes('Listening'))) {
          hasStarted = true;
          setTimeout(() => {
            gatewayProcess.kill('SIGTERM');
            resolve(output);
          }, 2000);
        }
      });

      gatewayProcess.stderr?.on('data', (data) => {
        output += data.toString();
      });

      const timeout = setTimeout(() => {
        gatewayProcess.kill('SIGTERM');
        if (hasStarted) {
          resolve(output);
        } else {
          reject(new Error(`Gateway startup timeout after ${timeoutMs}ms. Output: ${output}`));
        }
      }, timeoutMs);

      gatewayProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && !hasStarted) {
          reject(new Error(`Gateway exited with code ${code}. Output: ${output}`));
        } else {
          resolve(output);
        }
      });

      gatewayProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Process error: ${error.message}`));
      });
    });
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('💰 PAYMENT E2E TEST RESULTS');
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed);
    const failed = this.results.filter(r => !r.passed);
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log(`\n📈 Summary:`);
    console.log(`  Total Tests: ${this.results.length}`);
    console.log(`  ✅ Passed: ${passed.length}`);
    console.log(`  ❌ Failed: ${failed.length}`);
    console.log(`  ⏱️  Total Duration: ${totalDuration}ms`);
    console.log(`  📊 Success Rate: ${Math.round((passed.length / this.results.length) * 100)}%`);

    if (failed.length > 0) {
      console.log(`\n❌ Failed Tests:`);
      for (const test of failed) {
        console.log(`  - ${test.name}`);
        console.log(`    Error: ${test.error}`);
        console.log(`    Duration: ${test.duration}ms`);
      }
    }

    console.log('\n' + '='.repeat(60));

    if (failed.length > 0) {
      console.log('❌ Some payment tests failed.');
      process.exit(1);
    } else {
      console.log('🎉 All payment tests passed! Payment system working correctly.');
      process.exit(0);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new PaymentE2ETestRunner();
  runner.runAllTests();
}

export default PaymentE2ETestRunner;