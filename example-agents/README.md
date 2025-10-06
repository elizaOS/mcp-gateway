# Example Agents

This folder contains example AI agents that use the AI SDK to interact with the MCP Gateway.

## Setup

Install dependencies:

```bash
cd example-agents
bun install
```

## AI16Z Price Agent

An intelligent agent that fetches the current price of the AI16Z token using CoinGecko MCP tools through the gateway.

### Prerequisites

1. OpenAI API key (set in environment)
2. MCP Gateway with CoinGecko configuration (spawned automatically by the agent)

### Usage

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=your_openai_api_key_here

# Run the agent
bun run ai16z
```

### How it works

This example demonstrates the AI SDK's native MCP integration:

1. **MCP Client Initialization**: Uses `experimental_createMCPClient` with `StdioClientTransport` to connect to the MCP Gateway as a subprocess
2. **Automatic Tool Discovery**: Calls `mcpClient.tools()` which automatically discovers and converts all MCP tools to AI SDK-compatible tools
3. **Agent Creation**: Creates an `Agent` with GPT-4o, providing it with the discovered tools
4. **Autonomous Execution**: The agent uses loop control (`stopWhen`) to make multiple tool calls as needed to complete the task
5. **Cleanup**: Properly closes the MCP client connection when done

### Architecture

```
┌─────────────────────────────┐
│   AI Agent (AI SDK)         │
│   - GPT-4o Model            │
│   - System Prompt           │
│   - Auto Tool Calling       │
└──────────┬──────────────────┘
           │ experimental_createMCPClient
           │ (stdio transport)
┌──────────▼──────────────────┐
│  MCP Gateway (this project) │
│  - Tool Aggregation         │
│  - Payment Middleware       │
│  - Config: coingecko        │
└──────────┬──────────────────┘
           │ SSE Transport
           │
┌──────────▼──────────────────┐
│  CoinGecko MCP Server       │
│  https://mcp.api.coingecko  │
└─────────────────────────────┘
```

### Key Features

- **Native MCP Support**: Uses AI SDK's built-in MCP client ([docs](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools))
- **Automatic Tool Conversion**: No manual tool wrapping required
- **Agent Loop Control**: Uses `stepCountIs(10)` for multi-step reasoning
- **Type Safe**: Full TypeScript support with proper types
- **Clean Architecture**: Minimal boilerplate, follows AI SDK best practices

## Adding More Agents

To create additional example agents:

1. Create a new TypeScript file in this folder
2. Use the AI SDK's MCP client to connect to the gateway
3. Get tools via `mcpClient.tools()` for automatic discovery
4. Create an `Agent` with your model, system prompt, and tools
5. Add a script to `package.json`

### Example Structure

```typescript
import { 
  Experimental_Agent as Agent,
  experimental_createMCPClient as createMCPClient,
  stepCountIs 
} from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openai } from '@ai-sdk/openai';

// Initialize MCP client
const mcpClient = await createMCPClient({
  transport: new StdioClientTransport({
    command: 'bun',
    args: ['run', 'path/to/gateway', '--config=path/to/config.yaml']
  })
});

// Get tools automatically
const tools = await mcpClient.tools();

// Create agent
const agent = new Agent({
  model: openai('gpt-4o'),
  system: 'Your system prompt here',
  tools,
  stopWhen: stepCountIs(10)
});

// Run agent
const result = await agent.generate({
  prompt: 'Your query here'
});
```

## References

- [AI SDK Agent Class](https://ai-sdk.dev/docs/agents/agent-class)
- [AI SDK MCP Tools](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)
- [MCP Protocol](https://modelcontextprotocol.io)
- [MCP Gateway](../README.md)
