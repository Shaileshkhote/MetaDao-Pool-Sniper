import { Connection, PublicKey, AccountInfo, Context, KeyedAccountInfo } from '@solana/web3.js';
import { config } from '../config/config.js';

export interface AccountUpdateData {
    account: string;
    slot: number;
    lamports: number;
    owner: string;
    executable: boolean;
    rentEpoch: number;
    data: Buffer;
    timestamp: string;
}

export interface ProgramAccountUpdateData {
    account: string;
    program: string;
    slot: number;
    lamports: number;
    owner: string;
    data: Buffer;
    timestamp: string;
}

export interface LogData {
    signature: string;
    slot: number;
    err: any;
    logs: string[];
    timestamp: string;
}

export interface SignatureData {
    signature: string;
    slot: number;
    err: any;
    timestamp: string;
}

export interface ParsedTransactionData {
    isMetaDAOTx: boolean;
    isDAMMTx: boolean;
    logs: string[];
    parsed: Record<string, any>;
}

/**
 * Geyser Transaction Streaming Client
 * 
 * Note: This implementation uses WebSocket subscriptions as a fallback.
 * For production Geyser gRPC streaming, you'll need to:
 * 1. Install @solana/geyser-grpc-client or similar package
 * 2. Obtain Geyser endpoint credentials from providers like:
 *    - Triton (triton.one)
 *    - Yellowstone (yellowstone.io)
 *    - Helius
 */
export class GeyserClient {
    private connection: Connection;
    private subscriptions: Map<string, number>;

    constructor(connection: Connection) {
        this.connection = connection;
        this.subscriptions = new Map();
    }

    /**
     * Subscribe to account updates using WebSocket
     * For production, replace with gRPC streaming
     */
    async subscribeToAccount(
        accountPubkey: string | PublicKey,
        callback: (data: AccountUpdateData) => void
    ): Promise<number> {
        const pubkey = typeof accountPubkey === 'string'
            ? new PublicKey(accountPubkey)
            : accountPubkey;

        console.log(`📡 Subscribing to account: ${pubkey.toBase58()}`);

        const subscriptionId = this.connection.onAccountChange(
            pubkey,
            (accountInfo: AccountInfo<Buffer>, context: Context) => {
                const data: AccountUpdateData = {
                    account: pubkey.toBase58(),
                    slot: context.slot,
                    lamports: accountInfo.lamports,
                    owner: accountInfo.owner.toBase58(),
                    executable: accountInfo.executable,
                    rentEpoch: accountInfo.rentEpoch ?? 0,
                    data: accountInfo.data,
                    timestamp: new Date().toISOString(),
                };
                callback(data);
            },
            'confirmed'
        );

        this.subscriptions.set(pubkey.toBase58(), subscriptionId);
        return subscriptionId;
    }

    /**
     * Subscribe to program account updates
     */
    async subscribeToProgramAccounts(
        programId: string | PublicKey,
        callback: (data: ProgramAccountUpdateData) => void,
        filters: any[] = []
    ): Promise<number> {
        const pubkey = typeof programId === 'string'
            ? new PublicKey(programId)
            : programId;

        console.log(`📡 Subscribing to program: ${pubkey.toBase58()}`);

        const subscriptionId = this.connection.onProgramAccountChange(
            pubkey,
            (keyedAccountInfo: KeyedAccountInfo, context: Context) => {
                const data: ProgramAccountUpdateData = {
                    account: keyedAccountInfo.accountId.toBase58(),
                    program: pubkey.toBase58(),
                    slot: context.slot,
                    lamports: keyedAccountInfo.accountInfo.lamports,
                    owner: keyedAccountInfo.accountInfo.owner.toBase58(),
                    data: keyedAccountInfo.accountInfo.data,
                    timestamp: new Date().toISOString(),
                };
                callback(data);
            },
            'confirmed',
            filters
        );

        this.subscriptions.set(`program:${pubkey.toBase58()}`, subscriptionId);
        return subscriptionId;
    }

    /**
     * Subscribe to transaction logs for a specific address
     */
    async subscribeToLogs(
        address: string | PublicKey,
        callback: (data: LogData) => void
    ): Promise<number> {
        const addressStr = typeof address === 'string' ? address : address.toBase58();
        const pubkey = typeof address === 'string' ? new PublicKey(address) : address;

        console.log(`📡 Subscribing to logs for: ${addressStr}`);

        const subscriptionId = this.connection.onLogs(
            pubkey,
            (logs, context: Context) => {
                const data: LogData = {
                    signature: logs.signature,
                    slot: context.slot,
                    err: logs.err,
                    logs: logs.logs,
                    timestamp: new Date().toISOString(),
                };
                callback(data);
            },
            'confirmed'
        );

        this.subscriptions.set(`logs:${addressStr}`, subscriptionId);
        return subscriptionId;
    }

    /**
     * Subscribe to signature status changes
     */
    async subscribeToSignature(
        signature: string,
        callback: (data: SignatureData) => void
    ): Promise<number> {
        console.log(`📡 Subscribing to signature: ${signature}`);

        const subscriptionId = this.connection.onSignature(
            signature,
            (result, context: Context) => {
                const data: SignatureData = {
                    signature,
                    slot: context.slot,
                    err: result.err,
                    timestamp: new Date().toISOString(),
                };
                callback(data);
            },
            'confirmed'
        );

        this.subscriptions.set(`signature:${signature}`, subscriptionId);
        return subscriptionId;
    }

    /**
     * Unsubscribe from a specific subscription
     */
    async unsubscribe(key: string): Promise<boolean> {
        const subscriptionId = this.subscriptions.get(key);
        if (subscriptionId !== undefined) {
            await this.connection.removeAccountChangeListener(subscriptionId);
            this.subscriptions.delete(key);
            console.log(`❌ Unsubscribed from: ${key}`);
            return true;
        }
        return false;
    }

    /**
     * Unsubscribe from all subscriptions
     */
    async unsubscribeAll(): Promise<void> {
        console.log('❌ Unsubscribing from all streams...');
        const promises = Array.from(this.subscriptions.entries()).map(
            async ([key, id]) => {
                try {
                    await this.connection.removeAccountChangeListener(id);
                } catch (error) {
                    console.error(`Error unsubscribing from ${key}:`, (error as Error).message);
                }
            }
        );
        await Promise.all(promises);
        this.subscriptions.clear();
    }

    /**
     * Get active subscriptions count
     */
    getActiveSubscriptionsCount(): number {
        return this.subscriptions.size;
    }
}

/**
 * Parse MetaDAO transaction data
 */
export function parseMetaDAOTransaction(logs: string[]): ParsedTransactionData {
    const metadaoLogs = logs.filter(log =>
        log.includes('Program meta') ||
        log.includes('MetaDAO') ||
        log.includes('Conditional')
    );

    // Check for completeLaunch instruction
    const isCompleteLaunch = logs.some(log =>
        log.includes('Instruction: CompleteLaunch') ||
        log.includes('complete_launch') ||
        log.includes('CompleteLaunch')
    );

    // Extract launch pubkey from logs if available
    let launchPubkey: string | null = null;
    if (isCompleteLaunch) {
        for (const log of logs) {
            // Look for account references in the logs
            const match = log.match(/Launch:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i);
            if (match) {
                launchPubkey = match[1];
                break;
            }
        }
    }

    return {
        isMetaDAOTx: metadaoLogs.length > 0,
        isDAMMTx: false,
        logs: metadaoLogs,
        parsed: {
            isCompleteLaunch,
            launchPubkey,
        }
    };
}

/**
 * Check if transaction is a completeLaunch instruction
 */
export function isCompleteLaunchTransaction(logs: string[]): boolean {
    return logs.some(log =>
        log.includes('Instruction: CompleteLaunch') ||
        log.includes('complete_launch') ||
        log.includes('CompleteLaunch')
    );
}

/**
 * Extract launch pubkey from transaction logs
 */
export function extractLaunchPubkey(logs: string[]): string | null {
    for (const log of logs) {
        // Try multiple patterns to find the launch account
        const patterns = [
            /Launch:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i,
            /launch\s+account:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i,
            /account\s+#\d+:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/,
        ];

        for (const pattern of patterns) {
            const match = log.match(pattern);
            if (match) {
                return match[1];
            }
        }
    }
    return null;
}

/**
 * Parse DAMM transaction data
 */
export function parseDAMMTransaction(logs: string[]): ParsedTransactionData {
    const dammLogs = logs.filter(log =>
        log.includes('Program damm') ||
        log.includes('DAMM') ||
        log.includes('Position')
    );

    return {
        isMetaDAOTx: false,
        isDAMMTx: dammLogs.length > 0,
        logs: dammLogs,
        parsed: {
            // Add custom parsing logic here
        }
    };
}

