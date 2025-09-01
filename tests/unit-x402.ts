#!/usr/bin/env tsx

/**
 * Unit tests for x402 integration
 * Tests the configuration and wallet creation without network calls
 */

import { isX402Enabled, createX402Wallet, getMaxValueMicroUSDC } from '../src/x402.js';
import type { McpServerConfig } from '../src/types.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class X402UnitTests {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('🧪 x402 Unit Test Suite\n');
    
    // Check test environment
    if (!process.env.TEST_PRIVATE_KEY || !process.env.X402_EVM_PRIVATE_KEY) {
      console.error('❌ Error: Required environment variables not set');
      console.error('Please set the following environment variables:');
      console.error('  TEST_PRIVATE_KEY=<your-test-private-key>');
      console.error('  X402_EVM_PRIVATE_KEY=<your-test-private-key>');
      process.exit(1);
    }
    
    await this.testIsX402Enabled();
    await this.testGetMaxValueMicroUSDC();
    await this.testCreateX402Wallet();
    
    this.printResults();
  }

  private async testIsX402Enabled(): Promise<void> {
    console.log('📋 Testing isX402Enabled...\n');
    
    const testCases: Array<[string, Partial<McpServerConfig>, boolean]> = [
      ['undefined x402Middleware', 
        { name: 'test', transport: { type: 'http', url: 'test' } }, 
        false],
      ['x402Middleware: true', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: true }, 
        true],
      ['x402Middleware: false', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: false }, 
        false],
      ['x402Middleware.enabled: true', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: { enabled: true, wallet: { type: 'evm', network: 'base-sepolia', privateKeyEnv: 'KEY' } } }, 
        true],
      ['x402Middleware.enabled: false', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: { enabled: false, wallet: { type: 'evm', network: 'base-sepolia', privateKeyEnv: 'KEY' } } }, 
        false],
      ['x402Middleware object without enabled', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: { enabled: true, wallet: { type: 'evm', network: 'base', privateKeyEnv: 'KEY' } } }, 
        true],
    ];
    
    for (const [description, config, expected] of testCases) {
      await this.runTest(`isX402Enabled: ${description}`, async () => {
        const result = isX402Enabled(config as McpServerConfig);
        if (result !== expected) {
          throw new Error(`Expected ${expected}, got ${result}`);
        }
        return true;
      });
    }
  }

  private async testGetMaxValueMicroUSDC(): Promise<void> {
    console.log('\n💰 Testing getMaxValueMicroUSDC...\n');
    
    const testCases: Array<[string, Partial<McpServerConfig>, bigint]> = [
      ['no x402Middleware', 
        { name: 'test', transport: { type: 'http', url: 'test' } }, 
        100_000n],
      ['boolean x402Middleware', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: true }, 
        100_000n],
      ['custom limit as string', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: { enabled: true, wallet: { type: 'evm', network: 'base-sepolia', privateKeyEnv: 'KEY' }, maxValueMicroUSDC: '250000' } }, 
        250_000n],
      ['invalid limit string', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: { enabled: true, wallet: { type: 'evm', network: 'base-sepolia', privateKeyEnv: 'KEY' }, maxValueMicroUSDC: 'invalid' } }, 
        100_000n],
      ['zero limit', 
        { name: 'test', transport: { type: 'http', url: 'test' }, x402Middleware: { enabled: true, wallet: { type: 'evm', network: 'base-sepolia', privateKeyEnv: 'KEY' }, maxValueMicroUSDC: '0' } }, 
        0n],
    ];
    
    for (const [description, config, expected] of testCases) {
      await this.runTest(`getMaxValueMicroUSDC: ${description}`, async () => {
        const result = getMaxValueMicroUSDC(config as McpServerConfig);
        if (result !== expected) {
          throw new Error(`Expected ${expected}, got ${result}`);
        }
        return true;
      });
    }
  }

  private async testCreateX402Wallet(): Promise<void> {
    console.log('\n💳 Testing createX402Wallet...\n');
    
    await this.runTest('Create wallet with default config', async () => {
      const config: Partial<McpServerConfig> = {
        name: 'test',
        transport: { type: 'http', url: 'test' },
        x402Middleware: true
      };
      
      const wallet = await createX402Wallet(config as McpServerConfig);
      
      // Check wallet is a SignerWallet (not LocalAccount)
      if ('type' in wallet && wallet.type === 'local') {
        throw new Error('Expected SignerWallet, got LocalAccount');
      }
      
      // SignerWallet will have these properties
      const signerWallet = wallet as any; // We know it's a SignerWallet
      if (!signerWallet.account) throw new Error('Wallet missing account');
      if (!signerWallet.chain) throw new Error('Wallet missing chain');
      if (signerWallet.chain.id !== 84532) throw new Error('Default should be base-sepolia');
      
      return true;
    });
    
    await this.runTest('Create wallet with base mainnet', async () => {
      const config: Partial<McpServerConfig> = {
        name: 'test',
        transport: { type: 'http', url: 'test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'evm',
            network: 'base',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          }
        }
      };
      
      const wallet = await createX402Wallet(config as McpServerConfig);
      
      // Check wallet is a SignerWallet
      if ('type' in wallet && wallet.type === 'local') {
        throw new Error('Expected SignerWallet, got LocalAccount');
      }
      
      const signerWallet = wallet as any;
      if (signerWallet.chain.id !== 8453) {
        throw new Error(`Expected base mainnet (8453), got ${signerWallet.chain.id}`);
      }
      
      return true;
    });
    
    await this.runTest('Fail on missing private key', async () => {
      const config: Partial<McpServerConfig> = {
        name: 'test',
        transport: { type: 'http', url: 'test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'evm',
            network: 'base',
            privateKeyEnv: 'NONEXISTENT_KEY'
          }
        }
      };
      
      try {
        await createX402Wallet(config as McpServerConfig);
        throw new Error('Should have failed');
      } catch (error: any) {
        if (!error.message.includes('Missing private key')) {
          throw error;
        }
        return true;
      }
    });
    
    await this.runTest('Fail on unsupported network', async () => {
      const config: Partial<McpServerConfig> = {
        name: 'test',
        transport: { type: 'http', url: 'test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'evm',
            network: 'polygon',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          }
        }
      };
      
      try {
        await createX402Wallet(config as McpServerConfig);
        throw new Error('Should have failed');
      } catch (error: any) {
        if (!error.message.includes('Unsupported network')) {
          throw error;
        }
        return true;
      }
    });
    
    await this.runTest('Fail on unsupported wallet type', async () => {
      const config: Partial<McpServerConfig> = {
        name: 'test',
        transport: { type: 'http', url: 'test' },
        x402Middleware: {
          enabled: true,
          wallet: {
            type: 'svm',
            network: 'solana-devnet',
            privateKeyEnv: 'TEST_PRIVATE_KEY'
          }
        }
      };
      
      try {
        await createX402Wallet(config as McpServerConfig);
        throw new Error('Should have failed');
      } catch (error: any) {
        if (!error.message.includes('not yet supported')) {
          throw error;
        }
        return true;
      }
    });
  }

  private async runTest(name: string, testFn: () => Promise<boolean>): Promise<void> {
    try {
      await testFn();
      this.results.push({ name, passed: true });
      console.log(`✅ ${name}`);
    } catch (error: any) {
      this.results.push({ name, passed: false, error: error.message });
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
    }
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    
    console.log(`\nTotal Tests: ${this.results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    
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
const runner = new X402UnitTests();
runner.runAllTests().catch(console.error);
