#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GatewayServer } from './aggregator-server.js';
import { configManager } from './config.js';

/**
 * Main entry point for the MCP Gateway Server
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Setup logging based on config (will be overridden by config later)
  const logLevel = process.env.MCP_LOG_LEVEL || 'info';
  const logger = createLogger(logLevel);

  try {
    // Load configuration
    let config;
    const configFile = args.find(arg => arg.startsWith('--config='))?.replace('--config=', '');
    
    if (configFile) {
      logger.info(`Loading configuration from file: ${configFile}`);
      config = configManager.loadFromFile(configFile);
    } else {
      logger.info('Loading configuration from environment variables');
      config = configManager.loadFromEnv();
    }

    // Update logger with config log level
    const configLogger = createLogger(config.settings?.logLevel || 'info');
    
    // Create and start the gateway server
    const gateway = new GatewayServer(config, configLogger);
    await gateway.start();

    // Create transport and connect
    const transport = new StdioServerTransport();
    await gateway.connect(transport);

    configLogger.info('MCP Gateway is now serving on stdio');

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      configLogger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await gateway.stop();
        process.exit(0);
      } catch (error) {
        configLogger.error(`Error during shutdown: ${error}`);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
      configLogger.error(`Uncaught exception: ${error}`);
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      configLogger.error(`Unhandled rejection: ${reason}`);
      shutdown('unhandledRejection');
    });

  } catch (error) {
    logger.error(`Failed to start MCP Gateway: ${error}`);
    process.exit(1);
  }
}

/**
 * Create a logger with the specified log level
 */
function createLogger(logLevel: string): Console {
  const levels = ['error', 'warn', 'info', 'debug'];
  const levelIndex = levels.indexOf(logLevel.toLowerCase());
  
  return {
    error: (...args: unknown[]) => {
      if (levelIndex >= 0) console.error('[ERROR]', ...args);
    },
    warn: (...args: unknown[]) => {
      if (levelIndex >= 1) console.warn('[WARN]', ...args);
    },
    info: (...args: unknown[]) => {
      if (levelIndex >= 2) console.info('[INFO]', ...args);
    },
    log: (...args: unknown[]) => {
      if (levelIndex >= 2) console.log('[INFO]', ...args);
    },
    debug: (...args: unknown[]) => {
      if (levelIndex >= 3) console.debug('[DEBUG]', ...args);
    },
    trace: (...args: unknown[]) => {
      if (levelIndex >= 3) console.trace('[TRACE]', ...args);
    },
    // Add other console methods to satisfy the Console interface
    assert: console.assert,
    clear: console.clear,
    count: console.count,
    countReset: console.countReset,
    dir: console.dir,
    dirxml: console.dirxml,
    group: console.group,
    groupCollapsed: console.groupCollapsed,
    groupEnd: console.groupEnd,
    table: console.table,
    time: console.time,
    timeEnd: console.timeEnd,
    timeLog: console.timeLog,
    timeStamp: console.timeStamp,
    profile: console.profile,
    profileEnd: console.profileEnd
  } as Console;
}

/**
 * Display help information
 */
function showHelp(): void {
  console.log(`
MCP Gateway Server

USAGE:
  mcp-gateway [OPTIONS]

OPTIONS:
  --config=<path>    Path to configuration file (JSON or YAML)
  --help            Show this help message

ENVIRONMENT VARIABLES:
  MCP_GATEWAY_NAME                       Name of the gateway (default: "MCP Gateway")
  MCP_GATEWAY_VERSION                    Version of the gateway (default: "1.0.0")
  MCP_GATEWAY_DESCRIPTION                Description of the gateway
  MCP_SERVERS                           Semicolon-separated server specs (name:command:args)
  MCP_LOG_LEVEL                         Log level: error, warn, info, debug (default: info)
  MCP_ENABLE_TOOL_CONFLICT_RESOLUTION   Enable tool name conflict resolution (default: true)
  MCP_ENABLE_RESOURCE_CONFLICT_RESOLUTION Enable resource conflict resolution (default: true)
  MCP_ENABLE_PROMPT_CONFLICT_RESOLUTION Enable prompt conflict resolution (default: true)
  MCP_MAX_CONCURRENT_CONNECTIONS        Maximum concurrent connections (default: 10)
  MCP_HEALTH_CHECK_INTERVAL             Health check interval in ms (default: 60000)

EXAMPLES:
  # Run with configuration file
  mcp-gateway --config=config.yaml

  # Run with environment variables
  MCP_SERVERS="weather:node:weather.js;filesystem:python:fs_server.py" mcp-gateway

For more information, visit: https://github.com/studio/mcp-gateway
`);
}

// Handle help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
  process.exit(0);
}

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
