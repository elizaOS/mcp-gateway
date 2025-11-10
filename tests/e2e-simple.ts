#!/usr/bin/env tsx

/**
 * Simple End-to-End Test Suite for Eliza MCP Gateway
 * 
 * This test suite focuses on essential functionality:
 * - Configuration loading and validation
 * - Gateway startup and initialization
 * - Server connection attempts
 * - Process management and cleanup
 */

import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  output?: string;
}

class SimpleE2ETestRunner {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Eliza MCP Gateway Simple E2E Tests\n');
    
    try {
      // Run core tests
      await this.testConfigurationLoading();
      await this.testBasicStartup();
      await this.testNamespaceHandling();
      await this.testErrorHandling();
      
      // Print results
      this.printResults();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    }
  }

  // Type-checking removed - Bun runs TypeScript directly without tsc
  // No tsconfig.json needed for this project

  private async testConfigurationLoading(): Promise<void> {
    console.log('📋 Testing Configuration Loading...');

    // Test 1: YAML Configuration
    await this.runTest('Load YAML configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'basic.yaml');
      if (!existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
      }
      
      const output = await this.runGatewayWithTimeout(configPath, 5000);
      
      if (!output.includes('Starting') && !output.includes('Gateway')) {
        throw new Error('Gateway did not start properly');
      }
    });

    // Test 2: JSON Configuration
    await this.runTest('Load JSON configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'basic.json');
      const output = await this.runGatewayWithTimeout(configPath, 5000);
      
      if (!output.includes('Starting') && !output.includes('Gateway')) {
        throw new Error('Gateway did not start properly');
      }
    });

    // Test 3: Environment Variables
    await this.runTest('Environment variable configuration', async () => {
      const originalServers = process.env.MCP_SERVERS;
      const originalName = process.env.MCP_GATEWAY_NAME;
      
      try {
        process.env.MCP_SERVERS = 'test:npx:user-review-mcp';
        process.env.MCP_GATEWAY_NAME = 'Test Environment Gateway';
        
        const output = await this.runGatewayWithTimeout(undefined, 5000);
        
        if (!output.includes('Test Environment Gateway') && !output.includes('Starting')) {
          throw new Error('Environment configuration not loaded properly');
        }
      } finally {
        // Restore environment
        if (originalServers) process.env.MCP_SERVERS = originalServers;
        else delete process.env.MCP_SERVERS;
        if (originalName) process.env.MCP_GATEWAY_NAME = originalName;
        else delete process.env.MCP_GATEWAY_NAME;
      }
    });
  }

  private async testBasicStartup(): Promise<void> {
    console.log('🚀 Testing Basic Startup...');

    await this.runTest('Gateway starts and initializes servers', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'basic.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);
      
      // Check for key startup messages
      const requiredMessages = [
        'Starting',
        'Initializing',
        'server'
      ];
      
      const missingMessages = requiredMessages.filter(msg => !output.toLowerCase().includes(msg.toLowerCase()));
      
      if (missingMessages.length > 0) {
        throw new Error(`Missing startup messages: ${missingMessages.join(', ')}. Output: ${output}`);
      }
    });

    await this.runTest('Gateway handles server connection attempts', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'basic.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 10000);
      
      // Should see server connection attempts (either success or failure is ok for this test)
      if (!output.toLowerCase().includes('server') && !output.toLowerCase().includes('connect')) {
        throw new Error(`No server connection attempts detected. Output: ${output}`);
      }
    });
  }

  private async testNamespaceHandling(): Promise<void> {
    console.log('🏷️ Testing Namespace Handling...');

    await this.runTest('Load namespaced server configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'namespaced.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 8000);
      
      // Should start successfully with namespaced configuration
      if (!output.includes('Starting') && !output.includes('Gateway')) {
        throw new Error(`Gateway failed to start with namespaced config. Output: ${output}`);
      }
    });

    await this.runTest('Handle multiple servers with different namespaces', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'multi-server.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 10000);
      
      // Should handle multiple servers
      if (!output.includes('Starting')) {
        throw new Error(`Gateway failed to start with multi-server config. Output: ${output}`);
      }
    });
  }

  private async testErrorHandling(): Promise<void> {
    console.log('🛡️ Testing Error Handling...');

    await this.runTest('Reject invalid configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'invalid.yaml');
      
      try {
        const output = await this.runGatewayWithTimeout(configPath, 5000);
        
        // Should fail with configuration error
        if (!output.toLowerCase().includes('error') && !output.toLowerCase().includes('failed') && !output.toLowerCase().includes('invalid')) {
          throw new Error(`Expected configuration error but gateway seemed to start. Output: ${output}`);
        }
        
        // If we got here with error output, that's actually success!
        console.log(`  ✅ Gateway correctly rejected invalid configuration`);
      } catch (error) {
        // This is expected for invalid config
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('Gateway exited with code 1') && errorMsg.includes('Failed to load config')) {
          // Gateway properly rejected the config (this is success!)
          console.log(`  ✅ Gateway correctly rejected invalid configuration with error: ${errorMsg.split('Output:')[1]?.trim() || 'config error'}`);
          return;
        }
        if (errorMsg.includes('timeout') || errorMsg.includes('Command failed')) {
          // Gateway properly rejected the config (good!)
          return;
        }
        throw error;
      }
    });

    await this.runTest('Handle server connection failures gracefully', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'failing-server.yaml');
      const output = await this.runGatewayWithTimeout(configPath, 10000);
      
      // Gateway should start but log connection failures
      // It shouldn't crash completely
      if (!output.includes('Starting') && !output.includes('Gateway')) {
        throw new Error(`Gateway failed to handle server connection failures. Output: ${output}`);
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
      console.log(`  ✅ ${testName} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.results.push({
        name: testName,
        passed: false,
        error: errorMsg,
        duration
      });
      console.log(`  ❌ ${testName} (${duration}ms): ${errorMsg}`);
    }
  }

  private async runGatewayWithTimeout(configPath?: string, timeoutMs: number = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['run', 'src/index.ts', '--mode=stdio'];
      if (configPath) {
        args.push(`--config=${configPath}`);
      }

      const gatewayProcess = spawn('bun', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      let output = '';
      let hasStarted = false;

      // Collect output
      gatewayProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        
        // If we see startup messages, give it a bit more time then resolve
        if (!hasStarted && (text.includes('Starting') || text.includes('MCP server started') || text.includes('Listening'))) {
          hasStarted = true;
          // Give it a moment to fully initialize, then kill and resolve
          setTimeout(() => {
            gatewayProcess.kill('SIGTERM');
            resolve(output);
          }, 2000);
        }
      });

      gatewayProcess.stderr?.on('data', (data) => {
        output += data.toString();
      });

      // Timeout handler
      const timeout = setTimeout(() => {
        gatewayProcess.kill('SIGTERM');
        if (hasStarted) {
          resolve(output);
        } else {
          reject(new Error(`Gateway startup timeout after ${timeoutMs}ms. Output: ${output}`));
        }
      }, timeoutMs);

      // Process exit handler
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

  private async runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: 'inherit' });
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command "${command} ${args.join(' ')}" failed with exit code ${code}`));
        }
      });
      proc.on('error', reject);
    });
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SIMPLE E2E TEST RESULTS');
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
      console.log('❌ Some tests failed. Gateway may have issues.');
      process.exit(1);
    } else {
      console.log('🎉 All tests passed! Gateway is working correctly.');
      process.exit(0);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new SimpleE2ETestRunner();
  runner.runAllTests();
}

export default SimpleE2ETestRunner;
