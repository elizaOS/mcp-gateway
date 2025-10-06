#!/bin/bash

# Run MCP Gateway in SSE mode with x402 payment support
# This creates an HTTP/SSE server with proper 402 status code handling
#
# Usage:
#   ./run-gateway-sse.sh

PORT=8000
CONFIG_PATH="examples/coingecko-config.yaml"

echo "🚀 Starting MCP Gateway in SSE mode with x402 support..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Port:         $PORT"
echo "SSE Path:     http://localhost:$PORT/sse"
echo "Message Path: http://localhost:$PORT/message"
echo "Config:       $CONFIG_PATH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$(dirname "$0")/.."

bun run src/transports/http-wrapper.ts \
    --config=$CONFIG_PATH \
    --port=$PORT
