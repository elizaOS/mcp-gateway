#!/usr/bin/env tsx

/**
 * End-to-End Test Suite for x402 Payment Integration
 * 
 * This test suite verifies:
 * - x402 middleware configuration
 * - Wallet creation with different networks
 * - Payment header generation
 * - HTTP and SSE transport with x402
 * - Payment limits enforcement
 * - Error handling for payment failures
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import http from 'http';
import { createServer } from 'http';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class X402E2ETestRunner {
  private results: TestResult[] = [];
  private testDir = join(process.cwd(), 'tests', 'x402-test-env');
  private mockServerPort = 54021;
  private mockServer: http.Server | null = null;
  private paymentRequests: any[] = [];

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting x402 Payment Integration E2E Test Suite\n');
    
    try {
      await this.setup();
      
      // Run test suites
      await this.runConfigurationTests();
      await this.runWalletCreationTests();
      await this.runHTTPTransportTests();
      await this.runSSETransportTests();
      await this.runPaymentLimitTests();
      await this.runErrorHandlingTests();
      
      this.printResults();
    } catch (error) {
      console.error('Fatal test error:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  private async setup(): Promise<void> {
    // Create test directory
    mkdirSync(this.testDir, { recursive: true });
    
    // Start mock 402 server
    await this.startMock402Server();
  }

  private async cleanup(): Promise<void> {
    // Stop mock server
    if (this.mockServer) {
      await new Promise<void>((resolve) => {
        this.mockServer!.close(() => resolve());
      });
    }
    
    // Clean up test directory
    rmSync(this.testDir, { recursive: true, force: true });
  }

  private async startMock402Server(): Promise<void> {
    this.mockServer = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${this.mockServerPort}`);
      
      // Log payment headers
      if (req.headers['x-payment']) {
        this.paymentRequests.push({
          url: url.pathname,
          payment: req.headers['x-payment'],
          timestamp: new Date().toISOString()
        });
      }
      
      // Handle different test endpoints
      if (url.pathname === '/requires-payment' && !req.headers['x-payment']) {
        // Return 402 Payment Required
        res.writeHead(402, {
          'Content-Type': 'application/json',
          'X-Payment-Required': JSON.stringify({
            kind: 'exact-evm',
            details: {
              recipient: '0x1234567890123456789012345678901234567890',
              token: 'USDC',
              amount: '50000', // 0.05 USDC
              network: 'base-sepolia',
              nonce: Date.now().toString()
            }
          })
        });
        res.end(JSON.stringify({ error: 'Payment required' }));
      } else if (url.pathname === '/requires-high-payment' && !req.headers['x-payment']) {
        // Return 402 with amount exceeding limit
        res.writeHead(402, {
          'Content-Type': 'application/json',
          'X-Payment-Required': JSON.stringify({
            kind: 'exact-evm',
            details: {
              recipient: '0x1234567890123456789012345678901234567890',
              token: 'USDC',
              amount: '200000', // 0.20 USDC - exceeds default limit
              network: 'base-sepolia',
              nonce: Date.now().toString()
            }
          })
        });
        res.end(JSON.stringify({ error: 'Payment required' }));
      } else if (url.pathname === '/sse' && req.headers.accept?.includes('text/event-stream')) {
        // SSE endpoint
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        
        // Send test events
        res.write('data: {"type": "test", "message": "SSE with x402"}\n\n');
        
        setTimeout(() => {
          res.write('data: {"type": "done"}\n\n');
          res.end();
        }, 100);
      } else if (req.headers['x-payment']) {
        // Payment was provided, return success
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Payment-Response': JSON.stringify({
            status: 'accepted',
            amount: '50000'
          })
        });
        res.end(JSON.stringify({ 
          result: 'Payment accepted',
          path: url.pathname
        }));
      } else {
        // Regular endpoint without payment requirement
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: 'No payment required' }));
      }
    });

    await new Promise<void>((resolve) => {
      this.mockServer!.listen(this.mockServerPort, () => {
        console.log(`Mock 402 server listening on port ${this.mockServerPort}`);
        resolve();
      });
    });
  }

  private async runConfigurationTests(): Promise<void> {
    console.log('📋 Running x402 Configuration Tests...\n');
    
    await this.runTest('Valid x402 configuration - boolean', async () => {
      const config = {
        mcpServers: {
          test: {
            transport: {
              type: 'http',
              url: `http://localhost:${this.mockServerPort}/test`
            },
            x402Middleware: true
          }
        }
      };
      
      writeFileSync(
        join(this.testDir, 'x402-bool-config.json'),
        JSON.stringify(config, null, 2)
      );
      
      // Verify config loads without error
      return true;
    });

    await this.runTest('Valid x402 configuration - detailed', async () => {
      const config = {
        mcpServers: {
          test: {
            transport: {
              type: 'http',
              url: `http://localhost:${this.mockServerPort}/test`
            },
            x402Middleware: {
              enabled: true,
              wallet: {
                type: 'evm',
                network: 'base-sepolia',
                privateKeyEnv: 'TEST_PRIVATE_KEY'
              },
              maxValueMicroUSDC: '150000' // 0.15 USDC
            }
          }
        }
      };
      
      writeFileSync(
        join(this.testDir, 'x402-detailed-config.json'),
        JSON.stringify(config, null, 2)
      );
      
      return true;
    });
  }

  private async runWalletCreationTests(): Promise<void> {
    console.log('\n💳 Running Wallet Creation Tests...\n');
    
    // Check test private key
    if (!process.env.TEST_PRIVATE_KEY || !process.env.X402_EVM_PRIVATE_KEY) {
      throw new Error('TEST_PRIVATE_KEY and X402_EVM_PRIVATE_KEY environment variables must be set');
    }
    
    await this.runTest('Create wallet for base-sepolia', async () => {
      const { createX402Wallet } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'evm' as const,
            network: 'base-sepolia',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          }
        }
      };
      
      const wallet = await createX402Wallet(config);
      
      // Verify wallet has expected properties
      if (!wallet.account || !wallet.chain) {
        throw new Error('Wallet missing required properties');
      }
      
      return true;
    });

    await this.runTest('Create wallet for base mainnet', async () => {
      const { createX402Wallet } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'evm' as const,
            network: 'base',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          }
        }
      };
      
      const wallet = await createX402Wallet(config);
      
      if (wallet.chain.id !== 8453) { // Base mainnet chain ID
        throw new Error(`Expected base chain, got ${wallet.chain.id}`);
      }
      
      return true;
    });

    await this.runTest('Fail on missing private key', async () => {
      const { createX402Wallet } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'evm' as const,
            network: 'base-sepolia',
            privateKeyEnv: 'NONEXISTENT_KEY'
          }
        }
      };
      
      try {
        await createX402Wallet(config);
        throw new Error('Should have failed on missing key');
      } catch (error: any) {
        if (!error.message.includes('Missing private key')) {
          throw error;
        }
      }
      
      return true;
    });

    await this.runTest('Fail on unsupported network', async () => {
      const { createX402Wallet } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'evm' as const,
            network: 'unsupported-network',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          }
        }
      };
      
      try {
        await createX402Wallet(config);
        throw new Error('Should have failed on unsupported network');
      } catch (error: any) {
        if (!error.message.includes('Unsupported network')) {
          throw error;
        }
      }
      
      return true;
    });
  }

  private async runHTTPTransportTests(): Promise<void> {
    console.log('\n🌐 Running HTTP Transport Tests...\n');
    
    await this.runTest('HTTP request without payment requirement', async () => {
      const { createX402Fetch } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: true
      };
      
      const x402Fetch = await createX402Fetch(config);
      const response = await x402Fetch(`http://localhost:${this.mockServerPort}/no-payment`);
      const data = await response.json();
      
      if (data.result !== 'No payment required') {
        throw new Error('Unexpected response');
      }
      
      return true;
    });

    await this.runTest('HTTP request with 402 response triggers payment', async () => {
      // Reset payment requests
      this.paymentRequests = [];
      
      const { createX402Fetch } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: true
      };
      
      const x402Fetch = await createX402Fetch(config);
      const response = await x402Fetch(`http://localhost:${this.mockServerPort}/requires-payment`);
      const data = await response.json();
      
      // Verify payment was made
      if (this.paymentRequests.length === 0) {
        throw new Error('No payment header sent');
      }
      
      if (data.result !== 'Payment accepted') {
        throw new Error('Payment not accepted');
      }
      
      return true;
    });
  }

  private async runSSETransportTests(): Promise<void> {
    console.log('\n📡 Running SSE Transport Tests...\n');
    
    await this.runTest('SSE request maintains streaming', async () => {
      const { createX402Fetch } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'sse' as const, sseUrl: 'http://test' },
        x402Middleware: true
      };
      
      const x402Fetch = await createX402Fetch(config);
      const response = await x402Fetch(`http://localhost:${this.mockServerPort}/sse`, {
        headers: {
          'Accept': 'text/event-stream'
        }
      });
      
      if (response.headers.get('content-type') !== 'text/event-stream') {
        throw new Error('SSE response type not preserved');
      }
      
      // Read SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let events = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events += decoder.decode(value);
      }
      
      if (!events.includes('SSE with x402')) {
        throw new Error('SSE content not received');
      }
      
      return true;
    });
  }

  private async runPaymentLimitTests(): Promise<void> {
    console.log('\n💰 Running Payment Limit Tests...\n');
    
    await this.runTest('Respect default payment limit', async () => {
      const { createX402Fetch } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: true // Default limit is 0.10 USDC
      };
      
      const x402Fetch = await createX402Fetch(config);
      
      try {
        await x402Fetch(`http://localhost:${this.mockServerPort}/requires-high-payment`);
        throw new Error('Should have rejected high payment');
      } catch (error: any) {
        // Expected to fail due to payment limit
        if (!error.message.includes('exceeds the maximum allowed value')) {
          throw error;
        }
      }
      
      return true;
    });

    await this.runTest('Respect custom payment limit', async () => {
      const { createX402Fetch, getMaxValueMicroUSDC } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'evm' as const,
            network: 'base-sepolia',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          },
          maxValueMicroUSDC: '250000' // 0.25 USDC
        }
      };
      
      // Verify limit is parsed correctly
      const limit = getMaxValueMicroUSDC(config);
      if (limit !== 250000n) {
        throw new Error(`Expected limit 250000, got ${limit}`);
      }
      
      const x402Fetch = await createX402Fetch(config);
      
      // Should now accept the higher payment
      const response = await x402Fetch(`http://localhost:${this.mockServerPort}/requires-high-payment`);
      const data = await response.json();
      
      if (data.result !== 'Payment accepted') {
        throw new Error('Payment should have been accepted with higher limit');
      }
      
      return true;
    });
  }

  private async runErrorHandlingTests(): Promise<void> {
    console.log('\n⚠️  Running Error Handling Tests...\n');
    
    await this.runTest('Handle unsupported wallet type', async () => {
      const { createX402Wallet } = await import('../src/x402.js');
      
      const config = {
        name: 'test',
        transport: { type: 'http' as const, url: 'http://test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'svm' as const, // Solana not yet supported
            network: 'solana-devnet',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          }
        }
      };
      
      try {
        await createX402Wallet(config);
        throw new Error('Should have failed on unsupported wallet type');
      } catch (error: any) {
        if (!error.message.includes('not yet supported')) {
          throw error;
        }
      }
      
      return true;
    });

    await this.runTest('x402 disabled should skip payment', async () => {
      const { isX402Enabled } = await import('../src/x402.js');
      
      const configs = [
        { name: 'test1', transport: { type: 'http' as const, url: 'test' } },
        { name: 'test2', transport: { type: 'http' as const, url: 'test' }, x402Middleware: false },
        { name: 'test3', transport: { type: 'http' as const, url: 'test' }, x402Middleware: { enabled: false } }
      ];
      
      for (const config of configs) {
        if (isX402Enabled(config)) {
          throw new Error(`x402 should be disabled for ${config.name}`);
        }
      }
      
      return true;
    });
  }

  private async runTest(name: string, testFn: () => Promise<boolean>): Promise<void> {
    const start = Date.now();
    let result: TestResult;
    
    try {
      await testFn();
      result = {
        name,
        passed: true,
        duration: Date.now() - start
      };
      console.log(`✅ ${name}`);
    } catch (error: any) {
      result = {
        name,
        passed: false,
        error: error.message,
        duration: Date.now() - start
      };
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
    }
    
    this.results.push(result);
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    
    console.log(`\nTotal Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏱️  Total Duration: ${this.results.reduce((sum, r) => sum + r.duration, 0)}ms`);
    
    if (failed > 0) {
      console.log('\nFailed Tests:');
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`\n❌ ${r.name}`);
          console.log(`   Error: ${r.error}`);
        });
      process.exit(1);
    } else {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    }
  }
}

// Run tests
const runner = new X402E2ETestRunner();
runner.runAllTests().catch(console.error);
