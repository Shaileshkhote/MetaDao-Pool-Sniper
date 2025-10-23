import dotenv from 'dotenv';
import { PublicKey } from '@solana/web3.js';

dotenv.config();

export interface Config {
    // Solana RPC Configuration
    rpcUrl: string;
    wsUrl: string;

    // Geyser Configuration (for fast transaction streaming)
    geyserRpcUrl?: string;
    geyserXToken?: string;

    // Wallet
    walletPrivateKey?: string;

    // Program IDs
    launchpadProgramId: PublicKey;  // Main MetaDAO launchpad program
    dammV2ProgramId: PublicKey;

    // Transaction Filtering
    filterAccounts: string[];

    // Pool Configuration
    launchPubkey?: string;
    tokenMint?: string; // Pre-configured token mint for instant fire mode
    tokenAmount?: string;
    solAmount?: string;
    keypairPath?: string;

    // Fee Scheduler Configuration
    initialFeeBps: number;
    minFeeBps: number;
    decayPerMinute: number;
    collectFeeMode: number;

    // DAMM v2 Pool Authority
    dammPoolAuthority: PublicKey;

    // Compute Budget
    computeUnitPrice: number;
}

export const config: Config = {
    // Solana RPC Configuration
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsUrl: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',

    // Geyser Configuration (for fast transaction streaming)
    geyserRpcUrl: process.env.GEYSER_RPC_URL,
    geyserXToken: process.env.GEYSER_X_TOKEN,

    // Wallet
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY,

    // Program IDs
    launchpadProgramId: new PublicKey(
        process.env.LAUNCHPAD_PROGRAM_ID || 'LPDkxWZBJy9ixu2P3p5P7TZrDfSfYCcqMxYqNwbMNWS'
    ),
    dammV2ProgramId: new PublicKey(
        process.env.DAMM_V2_PROGRAM_ID || 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'
    ),

    // Transaction Filtering
    filterAccounts: process.env.FILTER_ACCOUNTS?.split(',').filter(Boolean) || [],

    // Pool Configuration
    launchPubkey: process.env.LAUNCH_PUBKEY,
    tokenMint: process.env.TOKEN_MINT, // Pre-configured for instant fire mode
    tokenAmount: process.env.TOKEN_AMOUNT,
    solAmount: process.env.SOL_AMOUNT,
    keypairPath: process.env.KEYPAIR_PATH || process.env.WALLET_KEYPAIR_PATH,

    // Fee Scheduler Configuration
    initialFeeBps: parseInt(process.env.INITIAL_FEE_BPS || '5000'), // 50%
    minFeeBps: parseInt(process.env.MIN_FEE_BPS || '100'), // 1%
    decayPerMinute: parseInt(process.env.DECAY_PER_MINUTE || '100'), // 1% per minute
    collectFeeMode: parseInt(process.env.COLLECT_FEE_MODE || '2'), // 2 = quote token only

    // DAMM v2 Pool Authority
    dammPoolAuthority: new PublicKey(
        process.env.DAMM_POOL_AUTHORITY || 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
    ),

    // Compute Budget (HIGH priority for same-slot execution)
    computeUnitPrice: parseInt(process.env.COMPUTE_UNIT_PRICE || '2000000'), // 2M micro-lamports = 0.002 SOL priority fee
};

export function validateConfig(): boolean {
    const errors: string[] = [];

    if (!config.walletPrivateKey) {
        errors.push('WALLET_PRIVATE_KEY is required');
    }

    if (errors.length > 0) {
        console.warn('⚠️  Configuration warnings:', errors.join(', '));
    }

    return errors.length === 0;
}

