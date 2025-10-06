#!/usr/bin/env node

/**
 * AI16Z Price Agent
 * 
 * This agent uses the AI SDK to interact with the MCP Gateway
 * and fetch the current price of AI16Z token using CoinGecko MCP tools.
 * 
 * Reference: https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
 * 
 * Usage:
 *   OPENAI_API_KEY=your_key bun run ai16z-price-agent.ts
 */

import { 
  Experimental_Agent as Agent, 
  experimental_createMCPClient as createMCPClient,
  stepCountIs 
} from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openai } from '@ai-sdk/openai';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main agent function
 */
async function main(): Promise<void> {
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;

  try {
    // Path to the gateway config and entry point
    const gatewayRoot = join(__dirname, '..');
    const gatewayEntry = join(gatewayRoot, 'src', 'index.ts');
    const configPath = join(gatewayRoot, 'examples', 'coingecko-config.yaml');

    console.log('[Agent] Initializing MCP Gateway connection...');
    console.log(`[Agent] Gateway: ${gatewayEntry}`);
    console.log(`[Agent] Config: ${configPath}`);

    // Create MCP client using AI SDK's built-in support
    // This uses stdio transport to connect to the gateway as a subprocess
    // Reference: https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
    mcpClient = await createMCPClient({
      transport: new StdioClientTransport({
        command: 'bun',
        args: ['run', gatewayEntry, `--config=${configPath}`]
      })
    });

    console.log('[Agent] Connected to MCP Gateway');

    // Get all tools from the MCP server (with schema discovery)
    // The AI SDK automatically converts MCP tools to AI SDK tools
    const mcpTools = await mcpClient.tools();

    console.log('[Agent] Available MCP tools:', Object.keys(mcpTools));

    // Transform tool names to replace colons with underscores (OpenAI requirement)
    // OpenAI tool names must match: ^[a-zA-Z0-9_-]+$
    const tools: Record<string, typeof mcpTools[keyof typeof mcpTools]> = {};
    for (const [name, tool] of Object.entries(mcpTools)) {
      const transformedName = name.replace(/:/g, '_');
      tools[transformedName] = tool;
    }

    console.log('[Agent] Transformed tool names:', Object.keys(tools));

    // Create the AI agent with MCP tools
    const agent = new Agent({
      model: openai('gpt-4o'),
      system: `You are a cryptocurrency price assistant with access to CoinGecko data.

Your task is to fetch the current price of the AI16Z token (also known as ai16z).

Available tools provide access to cryptocurrency information through CoinGecko.

Steps to follow:
1. Search for the AI16Z token using available tools
2. Get its current price in USD
3. Provide a clear, concise response with the price

Be specific and accurate. The token might be listed as "ai16z", "AI16Z", or similar variations.`,
      tools,
      stopWhen: stepCountIs(10) // Allow up to 10 steps for tool calls
    });

    console.log('\n[Agent] Starting AI16Z price query...\n');

    // Run the agent
    const result = await agent.generate({
      prompt: 'What is the current price of AI16Z token in USD?'
    });

    console.log('\n[Agent] Result:\n');
    console.log(result.text);
    console.log('\n[Agent] Done!');

  } catch (error) {
    console.error('[Agent] Error:', error);
    process.exit(1);
  } finally {
    // Ensure cleanup
    if (mcpClient) {
      try {
        await mcpClient.close();
        console.log('[Agent] MCP client closed');
      } catch (closeError) {
        console.error('[Agent] Error closing MCP client:', closeError);
      }
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Agent] Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Agent] Received SIGTERM, shutting down...');
  process.exit(0);
});

// Run the agent
main().catch(async (error) => {
  console.error('[Agent] Fatal error:', error);
  process.exit(1);
});