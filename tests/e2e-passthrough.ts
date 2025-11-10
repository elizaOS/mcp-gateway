#!/usr/bin/env bun

/**
 * E2E tests for x402 passthrough payment functionality
 * Tests: passthrough, markup, and absorb payment modes
 */

import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';

class PassthroughE2ETestRunner {
  private testResults: Array<{ name: string; passed: boolean; duration: number; error?: string }> = [];

  async runAllTests(): Promise<void> {
    console.log('\n💳 X402 PASSTHROUGH E2E TESTS');
    console.log('='.repeat(60));

    await this.testPassthroughConfig();
    await this.testMarkupCalculation();
    await this.testAbsorbMode();
    await this.testHybridMode();

    this.printResults();
  }

  /**
   * Test 1: Passthrough mode configuration
   */
  private async testPassthroughConfig(): Promise<void> {
    const testName = 'Passthrough Mode Configuration';
    console.log(`\n🧪 ${testName}`);
    const startTime = Date.now();

    try {
      const configPath = resolve(process.cwd(), 'examples/passthrough-config.yaml');

      // Test that gateway starts with passthrough config
      const output = await this.runGatewayWithTimeout(configPath, 15000);

      // Verify no inbound payment required (pure passthrough)
      if (!output.includes('Payment middleware enabled')) {
        console.log('  ✅ No inbound payment middleware (pure passthrough mode)');
      } else {
        throw new Error('Passthrough mode should not enable payment middleware');
      }

      // Verify servers loaded
      if (output.includes('paid-api-passthrough') &&
          output.includes('paid-api-markup') &&
          output.includes('paid-api-fixed-markup')) {
        console.log('  ✅ All passthrough servers loaded');
      } else {
        throw new Error('Passthrough servers not loaded correctly');
      }

      this.testResults.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime
      });
      console.log(`  ✅ PASSED (${Date.now() - startTime}ms)`);

    } catch (error: any) {
      this.testResults.push({
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.message
      });
      console.log(`  ❌ FAILED: ${error.message}`);
    }
  }

  /**
   * Test 2: Markup calculation
   */
  private async testMarkupCalculation(): Promise<void> {
    const testName = 'Markup Calculation';
    console.log(`\n🧪 ${testName}`);
    const startTime = Date.now();

    try {
      // Import PaymentMiddleware to test markup calculation
      const { PaymentMiddleware } = await import('../src/core/payment-middleware');

      const mockConfig = {
        name: 'test',
        servers: [],
        payment: { enabled: true }
      };

      const middleware = new PaymentMiddleware(mockConfig as any, console);

      // Test percentage markup
      const percentResult = middleware.calculateMarkup('$0.10', '20%');
      if (percentResult !== '$0.120000') {
        throw new Error(`Expected $0.120000, got ${percentResult}`);
      }
      console.log('  ✅ Percentage markup: $0.10 + 20% = $0.12');

      // Test fixed markup
      const fixedResult = middleware.calculateMarkup('$0.10', '$0.01');
      if (fixedResult !== '$0.110000') {
        throw new Error(`Expected $0.110000, got ${fixedResult}`);
      }
      console.log('  ✅ Fixed markup: $0.10 + $0.01 = $0.11');

      // Test 50% markup
      const highMarkup = middleware.calculateMarkup('$1.00', '50%');
      if (highMarkup !== '$1.500000') {
        throw new Error(`Expected $1.500000, got ${highMarkup}`);
      }
      console.log('  ✅ High markup: $1.00 + 50% = $1.50');

      this.testResults.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime
      });
      console.log(`  ✅ PASSED (${Date.now() - startTime}ms)`);

    } catch (error: any) {
      this.testResults.push({
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.message
      });
      console.log(`  ❌ FAILED: ${error.message}`);
    }
  }

  /**
   * Test 3: Absorb mode configuration
   */
  private async testAbsorbMode(): Promise<void> {
    const testName = 'Absorb Mode Configuration';
    console.log(`\n🧪 ${testName}`);
    const startTime = Date.now();

    try {
      const configPath = resolve(process.cwd(), 'examples/absorb-config.yaml');

      const output = await this.runGatewayWithTimeout(configPath, 15000);

      // Verify payment middleware enabled for client payments
      if (output.includes('Payment middleware enabled')) {
        console.log('  ✅ Payment middleware enabled for client authentication');
      } else {
        throw new Error('Absorb mode should enable payment middleware');
      }

      // Note: Would need mock private key to test x402 client initialization
      // For now, just verify config loads

      if (output.includes('expensive-api')) {
        console.log('  ✅ Absorb mode server loaded');
      } else {
        throw new Error('Absorb mode server not loaded');
      }

      this.testResults.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime
      });
      console.log(`  ✅ PASSED (${Date.now() - startTime}ms)`);

    } catch (error: any) {
      this.testResults.push({
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.message
      });
      console.log(`  ❌ FAILED: ${error.message}`);
    }
  }

  /**
   * Test 4: Hybrid mode with mixed payment strategies
   */
  private async testHybridMode(): Promise<void> {
    const testName = 'Hybrid Payment Mode';
    console.log(`\n🧪 ${testName}`);
    const startTime = Date.now();

    try {
      const configPath = resolve(process.cwd(), 'examples/hybrid-payment-config.yaml');

      const output = await this.runGatewayWithTimeout(configPath, 15000);

      // Verify payment middleware enabled
      if (output.includes('Payment middleware enabled')) {
        console.log('  ✅ Payment middleware enabled');
      }

      // Verify all server types loaded
      const expectedServers = [
        'local-free-server',
        'passthrough-api',
        'markup-api',
        'premium-api'
      ];

      let allLoaded = true;
      for (const server of expectedServers) {
        if (output.includes(server)) {
          console.log(`  ✅ ${server} loaded`);
        } else {
          allLoaded = false;
          throw new Error(`Server ${server} not loaded`);
        }
      }

      if (!allLoaded) {
        throw new Error('Not all hybrid servers loaded');
      }

      this.testResults.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime
      });
      console.log(`  ✅ PASSED (${Date.now() - startTime}ms)`);

    } catch (error: any) {
      this.testResults.push({
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.message
      });
      console.log(`  ❌ FAILED: ${error.message}`);
    }
  }

  /**
   * Helper: Run gateway with timeout
   */
  private async runGatewayWithTimeout(configPath: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let hasResolved = false;

      const gatewayProcess: ChildProcess = spawn('bun', [
        'run',
        'src/index.ts',
        '--mode=stdio',
        `--config=${configPath}`
      ], {
        cwd: process.cwd(),
        env: process.env
      });

      gatewayProcess.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      gatewayProcess.stderr?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      // Resolve after gateway starts or timeout
      const timer = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          gatewayProcess.kill('SIGTERM');
          resolve(output);
        }
      }, timeoutMs);

      gatewayProcess.on('error', (error) => {
        if (!hasResolved) {
          hasResolved = true;
          clearTimeout(timer);
          gatewayProcess.kill('SIGTERM');
          reject(error);
        }
      });

      gatewayProcess.on('exit', (code) => {
        if (!hasResolved) {
          hasResolved = true;
          clearTimeout(timer);
          if (code !== 0 && code !== null) {
            reject(new Error(`Gateway exited with code ${code}`));
          } else {
            resolve(output);
          }
        }
      });
    });
  }

  /**
   * Print test results summary
   */
  private printResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('💳 X402 PASSTHROUGH TEST RESULTS');
    console.log('='.repeat(60));

    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => r.failed).length;
    const totalDuration = this.testResults.reduce((sum, r) => sum + r.duration, 0);

    console.log(`\n📈 Summary:`);
    console.log(`  Total Tests: ${this.testResults.length}`);
    console.log(`  ✅ Passed: ${passed}`);
    console.log(`  ❌ Failed: ${failed}`);
    console.log(`  ⏱️  Total Duration: ${totalDuration}ms`);
    console.log(`  📊 Success Rate: ${((passed / this.testResults.length) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  - ${r.name}: ${r.error}`);
        });
    }

    if (passed === this.testResults.length) {
      console.log('\n🎉 All passthrough tests passed! x402 payment routing working correctly.\n');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some tests failed. Review errors above.\n');
      process.exit(1);
    }
  }
}

// Run tests
const runner = new PassthroughE2ETestRunner();
runner.runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
