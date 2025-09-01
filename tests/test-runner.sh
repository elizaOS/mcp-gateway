#!/bin/bash

# Eliza MCP Gateway Test Runner
# Usage: ./test-runner.sh [quick|full|config|manual]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Go to project root (parent directory)
cd "$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    print_success "Node.js found: $(node --version)"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    print_success "npm found: $(npm --version)"
    
    # Check if dependencies are installed
    if [ ! -d "node_modules" ]; then
        print_warning "node_modules not found, installing dependencies..."
        npm install
    fi
    print_success "Dependencies ready"
    
    echo ""
}

# Function to build project
build_project() {
    print_header "Building Project"
    npm run build
    print_success "Build completed"
    echo ""
}

# Function to run quick tests
run_quick_tests() {
    print_header "Running Quick E2E Tests"
    npm run test:quick
}

# Function to run full tests
run_full_tests() {
    print_header "Running Full E2E Tests"
    npm run test
    
    print_header "Running Paywall Unit Tests"
    npm run test:paywall:unit
    
    print_header "Running Paywall E2E Tests"
    npm run test:paywall:e2e
}

# Function to test specific configuration
test_config() {
    local config_file="$1"
    if [ -z "$config_file" ]; then
        print_error "No configuration file specified"
        echo "Available configurations:"
        ls -1 tests/configs/*.yaml tests/configs/*.json 2>/dev/null | sed 's|tests/configs/||'
        exit 1
    fi
    
    if [ ! -f "tests/configs/$config_file" ]; then
        print_error "Configuration file not found: tests/configs/$config_file"
        exit 1
    fi
    
    print_header "Testing Configuration: $config_file"
    echo "Starting gateway with config: tests/configs/$config_file"
    echo "Press Ctrl+C to stop..."
    echo ""
    
    node build/index.js --config="tests/configs/$config_file"
}

# Function to run manual testing with inspector
run_manual_test() {
    local config_file="$1"
    if [ -z "$config_file" ]; then
        config_file="basic.yaml"
    fi
    
    if [ ! -f "tests/configs/$config_file" ]; then
        print_error "Configuration file not found: tests/configs/$config_file"
        exit 1
    fi
    
    print_header "Manual Testing with MCP Inspector"
    echo "Using configuration: tests/configs/$config_file"
    echo "This will open the MCP Inspector for interactive testing..."
    echo ""
    
    npx @modelcontextprotocol/inspector node build/index.js --config="tests/configs/$config_file"
}

# Function to show usage
show_usage() {
    echo "Eliza MCP Gateway Test Runner"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  quick                 Run quick E2E tests (default)"
    echo "  full                  Run comprehensive E2E tests"
    echo "  config <file>         Test specific configuration file"
    echo "  manual [file]         Run manual testing with MCP Inspector"
    echo "  build                 Build project only"
    echo "  clean                 Clean build artifacts"
    echo "  help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                    # Run quick tests"
    echo "  $0 quick              # Run quick tests"
    echo "  $0 full               # Run full test suite"
    echo "  $0 config basic.yaml  # Test basic.yaml configuration"
    echo "  $0 manual             # Interactive testing with basic.yaml"
    echo "  $0 manual multi-server.yaml  # Interactive testing with multi-server setup"
    echo ""
    echo "Available test configurations:"
    if [ -d "tests/configs" ]; then
        ls -1 tests/configs/*.yaml tests/configs/*.json 2>/dev/null | sed 's|tests/configs/|  - |' || echo "  (none found)"
    else
        echo "  (tests/configs directory not found)"
    fi
}

# Function to clean build artifacts
clean_build() {
    print_header "Cleaning Build Artifacts"
    if [ -d "build" ]; then
        rm -rf build
        print_success "Removed build directory"
    fi
    print_success "Clean completed"
    echo ""
}

# Main execution
main() {
    local command="${1:-quick}"
    
    case "$command" in
        "quick")
            check_prerequisites
            build_project
            run_quick_tests
            ;;
        "full")
            check_prerequisites
            build_project
            run_full_tests
            ;;
        "config")
            check_prerequisites
            build_project
            test_config "$2"
            ;;
        "manual")
            check_prerequisites
            build_project
            run_manual_test "$2"
            ;;
        "build")
            check_prerequisites
            build_project
            ;;
        "clean")
            clean_build
            ;;
        "help"|"--help"|"-h")
            show_usage
            ;;
        *)
            print_error "Unknown command: $command"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
