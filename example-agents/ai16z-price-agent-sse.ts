#!/usr/bin/env node

/**
 * AI16Z Price Agent (SSE Mode with x402 Payments)
 * 
 * This agent connects to the MCP Gateway via SSE transport and pays
 * $0.01 per tool call using x402 payments.
 * 
 * Architecture:
 *   Agent (x402 wallet) → Gateway (SSE) → CoinGecko (free)
 * 
 * Prerequisites:
 *   1. Start gateway in SSE mode: ./run-gateway-sse.sh
 *   2. Fund wallet with testnet USDC on Base Sepolia
 * 
 * Usage:
 *   ANTHROPIC_API_KEY=your_key bun run ai16z-price-agent-sse.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from 'x402-fetch';

// Default wallet for testing (DO NOT use in production with real funds)
const DEFAULT_WALLET_KEY = 'default-key';

// Gateway SSE endpoints (must match run-gateway-sse.sh)
const GATEWAY_SSE_URL = 'http://localhost:8000/sse';
const GATEWAY_MESSAGE_URL = 'http://localhost:8000/message';

/**
 * Main agent function
 */
async function main(): Promise<void> {
  let mcpClient: Client | undefined;

  try {
    // Setup wallet for x402 payments
    const walletKey = (process.env.WALLET_PRIVATE_KEY || DEFAULT_WALLET_KEY) as Hex;
    const account = privateKeyToAccount(walletKey);
    
    console.log('[Agent] Payment wallet configured:');
    console.log(`[Agent] Address: ${account.address}`);
    console.log('[Agent] This wallet will pay the gateway $0.01 per tool call via x402\n');

    console.log('[Agent] Connecting to MCP Gateway via SSE...');
    console.log(`[Agent] SSE URL: ${GATEWAY_SSE_URL}`);
    console.log(`[Agent] Message URL: ${GATEWAY_MESSAGE_URL}\n`);

    // Create a custom fetch with x402 payment support
    // This wraps fetch to automatically handle 402 responses and make payments
    const baseFetch = wrapFetchWithPayment(fetch, account);
    
    // Create an additional wrapper that ensures 402 responses are handled transparently
    // The MCP SDK throws errors on non-2xx responses, so we need to handle 402 before it sees them
    const mcpCompatibleFetch: typeof fetch = async (input, init) => {
      try {
        const response = await baseFetch(input, init);
        return response;
      } catch (error) {
        // If x402-fetch fails to make payment, log it and rethrow
        console.error('[Agent] Payment error:', error);
        throw error;
      }
    };

    // Create MCP client using SSE transport with custom fetch
    mcpClient = new Client({
      name: 'ai16z-price-agent-sse',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    // SSEClientTransport with custom fetch to support x402 payments
    const transport = new SSEClientTransport(
      new URL(GATEWAY_SSE_URL),
      {
        fetch: mcpCompatibleFetch
      }
    );

    await mcpClient.connect(transport);

    console.log('[Agent] Connected to MCP Gateway via SSE');

    // List available tools from the MCP server
    const toolsResult = await mcpClient.listTools();
    const availableTools = toolsResult.tools;

    console.log(`[Agent] Available MCP tools: ${availableTools.length} tools discovered`);

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

    console.log('[Agent] Tools ready for AI agent\n');
    console.log('[Agent] Starting AI16Z price query...\n');

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
