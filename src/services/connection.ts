import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config/config.js';

/**
 * Initialize Solana connection
 */
export function getConnection(): Connection {
    return new Connection(config.rpcUrl, {
        commitment: 'confirmed',
        wsEndpoint: config.wsUrl,
    });
}

/**
 * Load wallet keypair from private key
 */
export function getWallet(): Keypair {
    if (!config.walletPrivateKey) {
        throw new Error('Wallet private key not configured');
    }

    try {
        const privateKey = bs58.decode(config.walletPrivateKey);
        return Keypair.fromSecretKey(privateKey);
    } catch (error) {
        throw new Error(`Failed to load wallet: ${(error as Error).message}`);
    }
}

/**
 * Get wallet balance
 */
export async function getWalletBalance(connection: Connection, wallet: Keypair): Promise<number> {
    const balance = await connection.getBalance(wallet.publicKey);
    return balance / 1e9; // Convert lamports to SOL
}

