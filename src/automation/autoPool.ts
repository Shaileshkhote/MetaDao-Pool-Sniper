import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { parseMetaDAOTransaction, isCompleteLaunchTransaction } from '../services/transactionParser.js';
import { MetaDAOPoolCreator, PoolConfig } from './poolCreator.js';
import { getYellowstoneStream, YellowstoneTransactionData } from '../services/yellowstoneGrpc.js';
import { config } from '../config/config.js';

export class AutoPoolOrchestrator {
    private poolCreator: MetaDAOPoolCreator;
    private isExecuting: boolean = false;
    private hasExecuted: boolean = false;

    constructor(poolCreatorConfig: PoolConfig) {
        this.poolCreator = new MetaDAOPoolCreator(poolCreatorConfig);
    }

    async start(): Promise<void> {
        const yellowstone = getYellowstoneStream();

        try {
            await yellowstone.startUnifiedStream(config.launchpadProgramId);
        } catch (error: any) {
            console.error('❌ gRPC failed:', error.message);
            process.exit(1);
        }

        yellowstone.onTransaction('completeLaunch', async (txData: YellowstoneTransactionData) => {
            await this.handleTransaction(txData);
        });

        try {
            await this.poolCreator.preBuildTransaction();
            console.log('✅ Ready\n');
        } catch (error: any) {
            console.error('⚠️  Pre-build failed:', error.message);
        }

        process.on('SIGINT', async () => {
            await yellowstone.stopStreaming();
            process.exit(0);
        });

        await new Promise<void>(() => { });
    }

    private async handleTransaction(txData: YellowstoneTransactionData): Promise<void> {
        if (this.isExecuting || this.hasExecuted) return;

        const parsed = parseMetaDAOTransaction(txData.logs);
        if (!isCompleteLaunchTransaction(parsed)) return;

        console.log(`\n🎯 ${txData.signature.substring(0, 20)}... (${txData.slot})`);
        await this.execute();
    }

    private async execute(): Promise<void> {
        this.isExecuting = true;

        try {
            let result: any;
            try {
                result = await this.poolCreator.executeInstantFire();
            } catch {
                result = await this.poolCreator.executeInSingleSlot();
            }

            console.log(`✅ ${result.signature}`);
            console.log(`   https://solscan.io/tx/${result.signature}`);
            console.log(`   https://app.meteora.ag/pools/${result.poolPda.toBase58()}\n`);

            this.hasExecuted = true;
            await getYellowstoneStream().stopStreaming();
            process.exit(0);

        } catch (error: any) {
            console.error('❌', error.message);

            if (error.message.includes('already in use') || error.logs?.some((log: string) => log.includes('already in use'))) {
                try {
                    const result = await this.poolCreator.addLiquidityToExistingPool();
                    console.log(`✅ ${result.signature}\n`);
                    this.hasExecuted = true;
                    await getYellowstoneStream().stopStreaming();
                    process.exit(0);
                } catch (addLiqError: any) {
                    console.error('❌', addLiqError.message);
                }
            }

            if (error.message.includes('already claimed') || error.message.includes('No funding record')) {
                this.hasExecuted = true;
                await getYellowstoneStream().stopStreaming();
                process.exit(1);
            }

            this.isExecuting = false;
        }
    }
}

export function createPoolConfigFromEnv(): PoolConfig {
    const walletPrivateKey = process.env.WALLET_PRIVATE_KEY || config.walletPrivateKey;
    const keypairPath = process.env.KEYPAIR_PATH || process.env.WALLET_KEYPAIR_PATH || config.keypairPath;

    if (!walletPrivateKey && !keypairPath) {
        throw new Error('WALLET_PRIVATE_KEY or KEYPAIR_PATH required');
    }

    const launchPubkey = process.env.LAUNCH_PUBKEY;
    if (!launchPubkey) {
        throw new Error('LAUNCH_PUBKEY required');
    }

    return {
        rpcUrl: config.rpcUrl,
        walletPrivateKey,
        keypairPath,
        computeUnitPrice: parseInt(process.env.COMPUTE_UNIT_PRICE || '2000000'),
        launchpadProgramId: config.launchpadProgramId,
        launchPubkey: new PublicKey(launchPubkey),
        tokenMint: process.env.TOKEN_MINT,
        dammV2ProgramId: config.dammV2ProgramId,
        poolAuthority: new PublicKey(process.env.DAMM_POOL_AUTHORITY || 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'),
        solMint: new PublicKey('So11111111111111111111111111111111111111112'),
        tokenAmount: process.env.TOKEN_AMOUNT ? new BN(process.env.TOKEN_AMOUNT) : new BN('1000000000'),
        solAmount: process.env.SOL_AMOUNT ? new BN(process.env.SOL_AMOUNT) : new BN(String(0.1 * LAMPORTS_PER_SOL)),
        initialFeeBps: parseInt(process.env.INITIAL_FEE_BPS || '5000'),
        minFeeBps: parseInt(process.env.MIN_FEE_BPS || '100'),
        decayPerMinute: parseInt(process.env.DECAY_PER_MINUTE || '100'),
        collectFeeMode: parseInt(process.env.COLLECT_FEE_MODE || '1'),
    };
}

export async function startAutoPool(): Promise<void> {
    const poolConfig = createPoolConfigFromEnv();
    const orchestrator = new AutoPoolOrchestrator(poolConfig);
    await orchestrator.start();
}
