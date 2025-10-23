import { PublicKey, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config/config.js';

let Client: any;
let CommitmentLevel: any;

async function loadYellowstoneClient() {
    const module = await import('@triton-one/yellowstone-grpc');
    Client = (module as any).default || (module as any).Client || module;
    CommitmentLevel = (module as any).CommitmentLevel;
}

export interface YellowstoneTransactionData {
    signature: string;
    slot: number;
    accounts: string[];
    logs: string[];
    err: any;
}

export class YellowstoneUnifiedStream {
    private client: any = null;
    private stream: any = null;
    private latestBlockhash: string | null = null;
    private latestBlockHeight: number = 0;
    private blockhashLastUpdate: number = 0;
    private isStreaming: boolean = false;
    private txCallbacks: Map<string, (tx: YellowstoneTransactionData) => void> = new Map();

    constructor(private endpoint: string, private xToken?: string) { }

    async startUnifiedStream(launchpadProgramId: PublicKey): Promise<void> {
        if (this.isStreaming) return;

        // Validate gRPC endpoint
        if (!this.endpoint) {
            console.error('❌ GEYSER_RPC_URL not configured or using default RPC.');
            console.error('   Set GEYSER_RPC_URL to a Yellowstone gRPC endpoint.');
            console.error('   Example: grpc.triton.one:443');
            throw new Error('GEYSER_RPC_URL required for gRPC streaming');
        }

        try {
            await loadYellowstoneClient();
            this.client = new Client(this.endpoint, this.xToken, {
                'grpc.max_receive_message_length': 1024 * 1024 * 1024,
            });
            this.stream = await this.client.subscribe();
        } catch (error: any) {
            console.error('❌ Failed to initialize gRPC client:', error.message);
            throw error;
        }

        this.stream.on('data', (data: any) => {
            if (data.block?.blockhash) {
                this.latestBlockhash = data.block.blockhash;
                this.latestBlockHeight = data.block.blockHeight || data.block.slot || 0;
                this.blockhashLastUpdate = Date.now();
                if (!this.isStreaming) this.isStreaming = true;
            }

            if (data.blockMeta?.blockhash) {
                this.latestBlockhash = data.blockMeta.blockhash;
                this.latestBlockHeight = data.blockMeta.blockHeight?.blockHeight || data.blockMeta.blockHeight || data.blockMeta.slot || 0;
                this.blockhashLastUpdate = Date.now();
                if (!this.isStreaming) this.isStreaming = true;
            }

            if (data.transaction) {
                const tx = data.transaction.transaction;
                // Extract signature from top level
                const signature = tx.signature
                    ? bs58.encode(Buffer.from(tx.signature))
                    : '';

                // Extract account keys from nested transaction.message
                const accounts = (tx.transaction?.message?.accountKeys || []).map((key: any) =>
                    key ? bs58.encode(Buffer.from(key)) : ''
                ).filter(Boolean);

                // Extract logs from meta
                const logs = tx.meta?.logMessages || [];
                const err = tx.meta?.err || null;
                const slot = parseInt(data.transaction.slot || '0');

                this.txCallbacks.forEach(callback => {
                    try {
                        callback({ signature, slot, accounts, logs, err });
                    } catch (error) {
                        console.error('TX callback error:', error);
                    }
                });
            }

            if (data.slot && !this.isStreaming) {
                this.fetchBlockhashFromSlot().catch(() => { });
            }
        });

        this.stream.on('error', (error: Error) => {
            console.error('❌ gRPC error:', error.message);
            this.isStreaming = false;
        });

        this.stream.on('end', () => {
            this.isStreaming = false;
        });

        const request: any = {
            accounts: {},
            slots: {},
            transactions: {
                launchpad: {
                    vote: false,
                    failed: false,
                    accountInclude: [launchpadProgramId.toBase58()],
                    accountExclude: [],
                    accountRequired: [],
                },
            },
            transactionsStatus: {},
            blocks: {},
            blocksMeta: {},
            entry: {},
            commitment: CommitmentLevel?.CONFIRMED,
            accountsDataSlice: [],
            ping: undefined,
        };

        console.log('📝 Sending subscription request...');
        this.stream.write(request);

        try {
            const blockhashData = await this.client.getLatestBlockhash(CommitmentLevel?.FINALIZED || 2);
            if (blockhashData?.blockhash) {
                this.latestBlockhash = blockhashData.blockhash;
                this.latestBlockHeight = blockhashData.lastValidBlockHeight || 0;
                this.blockhashLastUpdate = Date.now();
                this.isStreaming = true;
                this.startBlockhashRefresh();
            }
        } catch {
            await this.fetchBlockhashFromSlot();
        }
    }

    private async fetchBlockhashFromSlot(): Promise<void> {
        try {
            const connection = new Connection(config.rpcUrl, 'confirmed');
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
            this.latestBlockhash = blockhash;
            this.latestBlockHeight = lastValidBlockHeight;
            this.blockhashLastUpdate = Date.now();
            if (!this.isStreaming) {
                this.isStreaming = true;
                this.startBlockhashRefresh();
            }
        } catch { }
    }

    private startBlockhashRefresh(): void {
        setInterval(async () => {
            try {
                const connection = new Connection(config.rpcUrl, 'confirmed');
                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
                this.latestBlockhash = blockhash;
                this.latestBlockHeight = lastValidBlockHeight;
                this.blockhashLastUpdate = Date.now();
            } catch { }
        }, 5000);
    }

    onTransaction(id: string, callback: (tx: YellowstoneTransactionData) => void): void {
        this.txCallbacks.set(id, callback);
    }

    offTransaction(id: string): void {
        this.txCallbacks.delete(id);
    }

    getLatestBlockhash(): { blockhash: string; blockHeight: number } | null {
        if (!this.latestBlockhash) return null;
        return {
            blockhash: this.latestBlockhash,
            blockHeight: this.latestBlockHeight,
        };
    }

    isActive(): boolean {
        return this.isStreaming && !!this.latestBlockhash;
    }

    getBlockhashAge(): number {
        return Date.now() - this.blockhashLastUpdate;
    }

    async stopStreaming(): Promise<void> {
        if (this.stream) {
            this.stream.end();
            this.stream = null;
        }
        this.isStreaming = false;
        this.txCallbacks.clear();
    }
}

let yellowstoneStream: YellowstoneUnifiedStream | null = null;

function parseGrpcEndpoint(endpoint: string): string {
    if (!endpoint) return endpoint;

    // Remove protocol if present
    endpoint = endpoint.replace(/^(grpc:\/\/|https:\/\/|http:\/\/)/, '');

    // Remove trailing slash
    endpoint = endpoint.replace(/\/$/, '');

    return endpoint;
}

export function getYellowstoneStream(): YellowstoneUnifiedStream {
    if (!yellowstoneStream) {
        const rawEndpoint = config.geyserRpcUrl;
        if (!rawEndpoint) {
            throw new Error('GEYSER_RPC_URL is not configured');
        }
        const endpoint = rawEndpoint;
        const xToken = config.geyserXToken;

        yellowstoneStream = new YellowstoneUnifiedStream(endpoint, xToken);
    }

    return yellowstoneStream;
}

export function getYellowstoneStreamer(): YellowstoneUnifiedStream {
    return getYellowstoneStream();
}

