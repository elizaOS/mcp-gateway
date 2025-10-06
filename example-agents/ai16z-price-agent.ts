#!/usr/bin/env node

/**
 * AI16Z Price Agent
 * 
 * This agent uses the Anthropic SDK to interact with the MCP Gateway
 * and fetch the current price of AI16Z token using CoinGecko MCP tools.
 * 
 * This version uses stdio transport with a free gateway configuration.
 * For paid x402 integration, see ai16z-price-agent-sse.ts
 * 
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/mcp
 * 
 * Usage:
 *   ANTHROPIC_API_KEY=your_key bun run ai16z-price-agent.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from 'x402-fetch';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default wallet for testing (DO NOT use in production with real funds)
const DEFAULT_WALLET_KEY = 'default-key';

/**
 * Main agent function
 */
async function main(): Promise<void> {
  let mcpClient: Client | undefined;

  try {
    // Setup wallet for payments
    const walletKey = (process.env.WALLET_PRIVATE_KEY || DEFAULT_WALLET_KEY) as Hex;
    const account = privateKeyToAccount(walletKey);
    
    console.log('[Agent] Wallet configured (for testing):');
    console.log(`[Agent] Address: ${account.address}`);
    console.log('[Agent] Using FREE gateway configuration (no payment required)\n');

    // Path to the gateway config and entry point
    const gatewayRoot = join(__dirname, '..');
    const gatewayEntry = join(gatewayRoot, 'src', 'index.ts');
    const configPath = join(gatewayRoot, 'examples', 'coingecko-free-config.yaml');

    console.log('[Agent] Initializing MCP Gateway connection...');
    console.log(`[Agent] Gateway: ${gatewayEntry}`);
    console.log(`[Agent] Config: ${configPath}`);

    // Create MCP client using stdio transport
    mcpClient = new Client({
      name: 'ai16z-price-agent',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', gatewayEntry, `--config=${configPath}`]
    });

    await mcpClient.connect(transport);

    console.log('[Agent] Connected to MCP Gateway');

    // List available tools from the MCP server
    const toolsResult = await mcpClient.listTools();
    const availableTools = toolsResult.tools;

    console.log('[Agent] Available MCP tools:', availableTools.map((t: { name: string }) => t.name));

    // Initialize Anthropic client with x402 payment support
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || 'required',
      fetch: wrapFetchWithPayment(fetch, account)
    });

    // Convert MCP tools to Anthropic tool format
    // Note: Anthropic requires tool names to match ^[a-zA-Z0-9_-]{1,128}$
    // So we transform "crypto:get_price" to "crypto_get_price"
    const tools: Array<Anthropic.Tool> = availableTools.map((tool: { name: string; description?: string; inputSchema: Record<string, unknown> }) => ({
      name: tool.name.replace(/:/g, '_'),
      description: tool.description || '',
      input_schema: {
        type: 'object' as const,
        ...tool.inputSchema
      }
    }));

    // Create a mapping from transformed names back to original MCP tool names
    const toolNameMap = new Map<string, string>();
    for (const tool of availableTools) {
      toolNameMap.set(tool.name.replace(/:/g, '_'), tool.name);
    }

    console.log('\n[Agent] Starting AI16Z price query...\n');

    // Initial message to Claude
    const messages: Array<Anthropic.MessageParam> = [
      {
        role: 'user',
        content: 'What is the current price of AI16Z token in USD?'
      }
    ];

    // Run agent loop with tool calling
    let continueLoop = true;
    let iterations = 0;
    const maxIterations = 10;

    while (continueLoop && iterations < maxIterations) {
      iterations++;

      const response = await anthropic.messages.create({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 4096,
        system: `You are a cryptocurrency price assistant with access to CoinGecko data.

Your task is to fetch the current price of the AI16Z token (also known as ai16z).

Available tools provide access to cryptocurrency information through CoinGecko.

Steps to follow:
1. Search for the AI16Z token using available tools
2. Get its current price in USD
3. Provide a clear, concise response with the price

Be specific and accurate. The token might be listed as "ai16z", "AI16Z", or similar variations.`,
        messages,
        tools
      });

      // Check if we should stop
      if (response.stop_reason === 'end_turn') {
        // Extract final text response
        const textContent = response.content.find((c: { type: string; text?: string }) => c.type === 'text');
        if (textContent && 'text' in textContent) {
          console.log('\n[Agent] Result:\n');
          console.log(textContent.text);
        }
        continueLoop = false;
        break;
      }

      // Process tool calls
      if (response.stop_reason === 'tool_use') {
        const toolResults: Array<Anthropic.ToolResultBlockParam> = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`[Agent] Calling tool: ${block.name}`);
            
            try {
              // Translate transformed tool name back to original MCP tool name
              const originalToolName = toolNameMap.get(block.name) || block.name;
              
              // Call the MCP tool
              const result = await mcpClient.callTool({
                name: originalToolName,
                arguments: block.input as Record<string, unknown>
              });

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result.content)
              });
            } catch (toolError) {
              console.error(`[Agent] Tool error:`, toolError);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Error: ${toolError instanceof Error ? toolError.message : String(toolError)}`
              });
            }
          }
        }

        // Add assistant message with tool use and user message with tool results
        messages.push({
          role: 'assistant',
          content: response.content
        });
        messages.push({
          role: 'user',
          content: toolResults
        });
      } else {
        continueLoop = false;
      }
    }

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