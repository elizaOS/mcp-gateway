import { type McpServerConfig } from './types.js';
import { wrapFetchWithPayment } from 'x402-fetch';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, publicActions, type Chain, type Transport, type Account, type Client, type PublicActions, type WalletActions } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import type { Wallet } from 'x402/types';

// SignerWallet type from x402 - a viem Client with PublicActions & WalletActions
type SignerWallet<chain extends Chain = Chain, transport extends Transport = Transport, account extends Account = Account> = 
  Client<transport, chain, account, any, PublicActions<transport, chain, account> & WalletActions<chain, account>>;

export type X402Wallet = Wallet;

export function isX402Enabled(config: McpServerConfig): boolean {
  if (config.x402Middleware === undefined) return false;
  if (typeof config.x402Middleware === 'boolean') return config.x402Middleware;
  return config.x402Middleware.enabled !== false;
}

function getChainFromNetwork(network: string) {
  switch (network) {
    case 'base':
      return base;
    case 'base-sepolia':
      return baseSepolia;
    // Add more chains as needed
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
}

export async function createX402Wallet(config: McpServerConfig): Promise<X402Wallet> {
  // Support both boolean and object config. Default env var if boolean
  const cfg = typeof config.x402Middleware === 'object' ? config.x402Middleware : undefined;
  const walletConfig = cfg?.wallet;
  
  // Determine wallet type and network
  const walletType = walletConfig?.type || 'evm';
  const network = walletConfig?.network || 'base-sepolia';
  const privateKeyEnv = walletConfig?.privateKeyEnv || 'X402_EVM_PRIVATE_KEY';
  
  const privateKey = process.env[privateKeyEnv];
  if (!privateKey || privateKey.length === 0) {
    throw new Error(`Missing private key in environment variable ${privateKeyEnv} for server ${config.name}`);
  }
  
  // Only EVM wallets supported for now
  if (walletType !== 'evm') {
    throw new Error(`Wallet type ${walletType} not yet supported`);
  }
  
  const chain = getChainFromNetwork(network);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(),
  }).extend(publicActions);
  
  // The wallet we created matches the SignerWallet type expected by x402
  return wallet as SignerWallet;
} 

export function getMaxValueMicroUSDC(config: McpServerConfig): bigint {
  // default 0.10 USDC in micro USDC = 100000
  const DEFAULT_MAX = 100_000n;
  if (!config.x402Middleware || typeof config.x402Middleware === 'boolean') {
    return DEFAULT_MAX;
  }
  const raw = config.x402Middleware.maxValueMicroUSDC;
  if (!raw) return DEFAULT_MAX;
  try {
    const parsed = BigInt(raw);
    return parsed;
  } catch {
    return DEFAULT_MAX;
  }
}

export async function createX402Fetch(config: McpServerConfig): Promise<typeof fetch> {
  const wallet = await createX402Wallet(config);
  const maxValue = getMaxValueMicroUSDC(config);
  
  // wrapFetchWithPayment returns a fetch function that handles x402 payments
  return wrapFetchWithPayment(fetch, wallet, maxValue) as typeof fetch;
}


