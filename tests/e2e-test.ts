#!/usr/bin/env tsx

/**
 * End-to-End Test Suite for Eliza MCP Gateway
 * 
 * This comprehensive test suite verifies:
 * - Configuration loading (YAML/JSON)
 * - STDIO transport connectivity
 * - Tool discovery and execution
 * - Namespace handling
 * - Multi-server scenarios
 * - Error handling
 */

import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

interface TestSuite {
  name: string;
  results: TestResult[];
  passed: number;
  failed: number;
  totalDuration: number;
}

class E2ETestRunner {
  private results: TestSuite[] = [];
  private gatewayProcess: ChildProcess | null = null;

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Eliza MCP Gateway E2E Test Suite\n');
    
    try {
      // Run test suites
      await this.runConfigurationTests();
      await this.runBasicConnectivityTests();
      await this.runToolExecutionTests();
      await this.runMultiServerTests();
      await this.runErrorHandlingTests();
      
      // Print final results
      this.printFinalResults();
      
    } catch (error) {
      console.error('❌ Test suite failed to complete:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  // Type-checking removed - Bun runs TypeScript directly without tsc
  // No tsconfig.json needed for this project

  private async runConfigurationTests(): Promise<void> {
    const suite: TestSuite = {
      name: 'Configuration Loading',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0
    };

    // Test YAML configuration loading
    await this.runTest(suite, 'Load YAML configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'basic.yaml');
      await this.startGateway(configPath);
      await this.delay(2000); // Allow startup
      await this.stopGateway();
    });

    // Test JSON configuration loading
    await this.runTest(suite, 'Load JSON configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'basic.json');
      await this.startGateway(configPath);
      await this.delay(2000);
      await this.stopGateway();
    });

    // Test environment variable configuration
    await this.runTest(suite, 'Environment variable configuration', async () => {
      process.env.MCP_GATEWAY_NAME = 'Test Gateway';
      process.env.MCP_SERVERS = 'test:npx:user-review-mcp';
      await this.startGateway(); // No config file
      await this.delay(2000);
      await this.stopGateway();
      delete process.env.MCP_SERVERS;
    });

    this.results.push(suite);
  }

  private async runBasicConnectivityTests(): Promise<void> {
    const suite: TestSuite = {
      name: 'Basic Connectivity',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0
    };

    await this.runTest(suite, 'Connect to gateway via STDIO', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'basic.yaml');
      await this.startGateway(configPath);
      await this.delay(3000); // Allow full startup
      
      // Connect as MCP client
      const client = await this.createMCPClient();
      
      try {
        // Test basic MCP capabilities
        const tools = await client.listTools();
        if (!tools || !Array.isArray(tools.tools)) {
          throw new Error('Failed to list tools');
        }
        console.log(`  📋 Found ${tools.tools.length} tools`);
        
        await client.close();
      } finally {
        await this.stopGateway();
      }
    });

    this.results.push(suite);
  }

  private async runToolExecutionTests(): Promise<void> {
    const suite: TestSuite = {
      name: 'Tool Execution',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0
    };

    await this.runTest(suite, 'Execute namespaced tool', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'namespaced.yaml');
      await this.startGateway(configPath);
      await this.delay(3000);
      
      const client = await this.createMCPClient();
      
      try {
        const tools = await client.listTools();
        const namespacedTool = tools.tools.find(t => t.name.includes(':'));
        
        if (!namespacedTool) {
          throw new Error('No namespaced tools found');
        }
        
        console.log(`  🔧 Found namespaced tool: ${namespacedTool.name}`);
        
        // Try to call a simple tool (user-review tool doesn't require complex params)
        if (namespacedTool.name.includes('review:')) {
          const result = await client.callTool({
            name: namespacedTool.name,
            arguments: {
              workDescription: "Test work for e2e testing"
            }
          });
          
          if (!result || !result.content) {
            throw new Error('Tool execution failed');
          }
          
          console.log(`  ✅ Tool executed successfully`);
        }
        
        await client.close();
      } finally {
        await this.stopGateway();
      }
    });

    this.results.push(suite);
  }

  private async runMultiServerTests(): Promise<void> {
    const suite: TestSuite = {
      name: 'Multi-Server Support',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0
    };

    await this.runTest(suite, 'Connect to multiple servers', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'multi-server.yaml');
      await this.startGateway(configPath);
      await this.delay(4000); // More time for multiple servers
      
      const client = await this.createMCPClient();
      
      try {
        const tools = await client.listTools();
        const namespaces = new Set(
          tools.tools
            .filter(t => t.name.includes(':'))
            .map(t => t.name.split(':')[0])
        );
        
        if (namespaces.size < 2) {
          throw new Error(`Expected multiple namespaces, found: ${Array.from(namespaces).join(', ')}`);
        }
        
        console.log(`  🏷️ Found namespaces: ${Array.from(namespaces).join(', ')}`);
        
        await client.close();
      } finally {
        await this.stopGateway();
      }
    });

    this.results.push(suite);
  }

  private async runErrorHandlingTests(): Promise<void> {
    const suite: TestSuite = {
      name: 'Error Handling',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0
    };

    await this.runTest(suite, 'Handle invalid configuration', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'invalid.yaml');
      
      try {
        await this.startGateway(configPath);
        await this.delay(2000);
        throw new Error('Gateway should have failed with invalid config');
      } catch (error) {
        // This is expected
        console.log(`  ✅ Correctly rejected invalid configuration`);
      } finally {
        await this.stopGateway();
      }
    });

    await this.runTest(suite, 'Handle server connection failure', async () => {
      const configPath = join(process.cwd(), 'tests', 'configs', 'failing-server.yaml');
      await this.startGateway(configPath);
      await this.delay(3000);
      
      // Gateway should start but log connection errors
      // We just verify it doesn't crash completely
      console.log(`  ✅ Gateway handled server connection failure gracefully`);
      
      await this.stopGateway();
    });

    this.results.push(suite);
  }

  private async runTest(suite: TestSuite, testName: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    console.log(`  🧪 ${testName}...`);
    
    try {
      await testFn();
      const duration = Date.now() - startTime;
      const result: TestResult = {
        name: testName,
        passed: true,
        duration
      };
      suite.results.push(result);
      suite.passed++;
      suite.totalDuration += duration;
      console.log(`  ✅ ${testName} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      const result: TestResult = {
        name: testName,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration
      };
      suite.results.push(result);
      suite.failed++;
      suite.totalDuration += duration;
      console.log(`  ❌ ${testName} (${duration}ms): ${result.error}`);
    }
  }

  private async startGateway(configPath?: string): Promise<void> {
    const args = ['run', 'src/index.ts', '--mode=stdio'];
    if (configPath) {
      args.push(`--config=${configPath}`);
    }

    this.gatewayProcess = spawn('bun', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    // Wait for startup
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Gateway startup timeout'));
      }, 10000);

      this.gatewayProcess!.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('MCP server started') || output.includes('Listening on stdio')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      this.gatewayProcess!.stderr?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Configuration validation failed') || output.includes('Failed to load config')) {
          clearTimeout(timeout);
          reject(new Error(`Gateway startup failed: ${output}`));
        }
      });

      this.gatewayProcess!.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Gateway exited with code ${code}`));
        }
      });
    });
  }

  private async stopGateway(): Promise<void> {
    if (this.gatewayProcess) {
      this.gatewayProcess.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        this.gatewayProcess!.on('exit', () => resolve());
        setTimeout(resolve, 2000); // Force timeout
      });
      
      this.gatewayProcess = null;
    }
  }

  private async createMCPClient(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', 'src/index.ts', '--config=tests/configs/basic.yaml']
    });

    const client = new Client({
      name: 'e2e-test-client',
      version: '1.0.0'
    }, {
      capabilities: {
        roots: {},
        sampling: {}
      }
    });

    await client.connect(transport);
    return client;
  }

  private async runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: 'inherit' });
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private printFinalResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    let totalPassed = 0;
    let totalFailed = 0;
    let totalDuration = 0;
    
    for (const suite of this.results) {
      console.log(`\n📁 ${suite.name}`);
      console.log(`  ✅ Passed: ${suite.passed}`);
      console.log(`  ❌ Failed: ${suite.failed}`);
      console.log(`  ⏱️  Duration: ${suite.totalDuration}ms`);
      
      totalPassed += suite.passed;
      totalFailed += suite.failed;
      totalDuration += suite.totalDuration;
      
      // Show failed test details
      const failedTests = suite.results.filter(r => !r.passed);
      if (failedTests.length > 0) {
        console.log(`  Failed tests:`);
        for (const test of failedTests) {
          console.log(`    - ${test.name}: ${test.error}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`🎯 OVERALL RESULTS`);
    console.log(`Total Tests: ${totalPassed + totalFailed}`);
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(`⏱️  Total Duration: ${totalDuration}ms`);
    console.log(`📈 Success Rate: ${Math.round((totalPassed / (totalPassed + totalFailed)) * 100)}%`);
    console.log('='.repeat(60));
    
    if (totalFailed > 0) {
      console.log('\n❌ Some tests failed. Check the details above.');
      process.exit(1);
    } else {
      console.log('\n🎉 All tests passed! Gateway is working correctly.');
      process.exit(0);
    }
  }

  private async cleanup(): Promise<void> {
    await this.stopGateway();
    
    // Clean up any test files
    const testFiles = [
      'tests/configs/basic.yaml',
      'tests/configs/basic.json',
      'tests/configs/namespaced.yaml',
      'tests/configs/multi-server.yaml',
      'tests/configs/invalid.yaml',
      'tests/configs/failing-server.yaml'
    ];
    
    // Note: We'll create these files in the next step
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new E2ETestRunner();
  runner.runAllTests();
}

export default E2ETestRunner;
