#!/bin/bash

# x402 E2E Test Runner Script

set -e

echo "🧪 x402 Payment Integration Test Suite"
echo "====================================="
echo

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from project root directory${NC}"
    exit 1
fi

# Build the project first
echo -e "${YELLOW}Building project...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed${NC}"
    exit 1
fi

# Set test environment variables
export NODE_ENV=test

# Ensure required environment variables are set
if [ -z "$X402_EVM_PRIVATE_KEY" ]; then
    echo -e "${RED}Error: X402_EVM_PRIVATE_KEY environment variable not set${NC}"
    echo "Please set the following environment variables:"
    echo "  export X402_EVM_PRIVATE_KEY=<your-private-key>"
    echo "  export X402_TEST_PRIVATE_KEY=<your-private-key>"
    exit 1
fi

if [ -z "$X402_TEST_PRIVATE_KEY" ]; then
    echo -e "${RED}Error: X402_TEST_PRIVATE_KEY environment variable not set${NC}"
    echo "Please set the following environment variables:"
    echo "  export X402_EVM_PRIVATE_KEY=<your-private-key>"
    echo "  export X402_TEST_PRIVATE_KEY=<your-private-key>"
    exit 1
fi

echo
echo -e "${YELLOW}Running x402 E2E tests...${NC}"
echo

# Run the x402 e2e test
tsx tests/e2e-x402.ts

TEST_RESULT=$?

if [ $TEST_RESULT -eq 0 ]; then
    echo
    echo -e "${GREEN}✅ All x402 tests passed!${NC}"
else
    echo
    echo -e "${RED}❌ Some x402 tests failed${NC}"
    exit $TEST_RESULT
fi

# Optional: Run integration test with real configs
if [ "$1" == "--integration" ]; then
    echo
    echo -e "${YELLOW}Running integration tests with x402 configs...${NC}"
    echo
    
    # Test loading x402 configs
    for config in tests/configs/x402-*.yaml; do
        echo -e "Testing config: $config"
        timeout 5s node build/index.js --config "$config" list 2>&1 | grep -q "Available MCP servers" && \
            echo -e "${GREEN}✅ Config loaded successfully${NC}" || \
            echo -e "${RED}❌ Failed to load config${NC}"
    done
fi

echo
echo -e "${GREEN}x402 test suite completed!${NC}"
