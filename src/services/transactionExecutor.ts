import { Connection, Transaction, Keypair, SendOptions } from '@solana/web3.js';
import { getYellowstoneStream } from './yellowstoneGrpc.js';

export interface TxExecutorConfig {
    connection: Connection;
    skipPreflight?: boolean;
    maxRetries?: number;
    useGrpcBlockhash?: boolean;
}

export class TransactionExecutor {
    private connection: Connection;

    constructor(private config: TxExecutorConfig) {
        this.connection = config.connection;
    }

    async getBlockhash(): Promise<string> {
        if (this.config.useGrpcBlockhash !== false) {
            const yellowstone = getYellowstoneStream();
            const cached = yellowstone.getLatestBlockhash();
            if (cached && yellowstone.isActive()) {
                return cached.blockhash;
            }
        }
        return (await this.connection.getLatestBlockhash('finalized')).blockhash;
    }

    async sendAndSign(
        tx: Transaction,
        signers: Keypair[],
        options?: { skipPreflight?: boolean; maxRetries?: number }
    ): Promise<string> {
        const blockhash = await this.getBlockhash();
        tx.recentBlockhash = blockhash;

        if (signers.length === 1) {
            tx.sign(signers[0]);
        } else {
            tx.partialSign(...signers);
        }

        const sendOptions: SendOptions = {
            skipPreflight: options?.skipPreflight ?? this.config.skipPreflight ?? false,
            maxRetries: options?.maxRetries ?? this.config.maxRetries ?? 2,
        };

        return await this.connection.sendRawTransaction(tx.serialize(), sendOptions);
    }

    async sendClaim(tx: Transaction, wallet: Keypair): Promise<string> {
        return this.sendAndSign(tx, [wallet], { skipPreflight: false, maxRetries: 2 });
    }

    async sendPoolCreation(tx: Transaction, wallet: Keypair, positionNft: Keypair): Promise<string> {
        return this.sendAndSign(tx, [wallet, positionNft], { skipPreflight: true, maxRetries: 0 });
    }

    async sendAddLiquidity(tx: Transaction, wallet: Keypair, positionNft: Keypair): Promise<string> {
        const sig = await this.sendAndSign(tx, [wallet, positionNft], { skipPreflight: false });
        await this.connection.confirmTransaction(sig);
        return sig;
    }

    async sendToMultipleRPCs(rawTx: Buffer, endpoints: string[]): Promise<string[]> {
        const promises = endpoints.map(async (endpoint) => {
            try {
                const conn = new Connection(endpoint, 'confirmed');
                return await conn.sendRawTransaction(rawTx, {
                    skipPreflight: true,
                    maxRetries: 0,
                });
            } catch {
                return null;
            }
        });

        const results = await Promise.allSettled(promises);
        return results
            .filter((r) => r.status === 'fulfilled' && r.value)
            .map((r: any) => r.value);
    }
}

