import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getConnection } from '../services/connection.js';
import { GeyserClient, LogData, isCompleteLaunchTransaction, extractLaunchPubkey } from '../services/geyserClient.js';
import { MetaDAOLoyalPoolCreator, LoyalPoolConfig } from './loyalPoolCreator.js';
import { config } from '../config/config.js';

/**
 * Automated Loyal Pool Creator
 * 
 * Monitors MetaDAO launchpad for completeLaunch events and automatically:
 * 1. Detects when admin completes the launch
 * 2. Claims Loyal tokens
 * 3. Creates Loyal/SOL DAMM v2 pool with custom fee scheduler
 */
export class AutoLoyalPoolOrchestrator {
    private geyserClient: GeyserClient;
    private targetLaunchPubkey: PublicKey;
    private poolCreator: MetaDAOLoyalPoolCreator;
    private isExecuting: boolean = false;
    private hasExecuted: boolean = false;

    constructor(
        targetLaunchPubkey: PublicKey,
        poolCreatorConfig: LoyalPoolConfig
    ) {
        const connection = getConnection();
        this.geyserClient = new GeyserClient(connection);
        this.targetLaunchPubkey = targetLaunchPubkey;
        this.poolCreator = new MetaDAOLoyalPoolCreator(poolCreatorConfig);
    }

    /**
     * Start monitoring for completeLaunch event
     */
    async startMonitoring(): Promise<void> {
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║     Auto Loyal Pool Creator - Monitoring Active          ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        console.log(`🎯 Target Launch: ${this.targetLaunchPubkey.toBase58()}`);
        console.log(`👛 Wallet: ${this.poolCreator.getWalletPublicKey().toBase58()}\n`);

        console.log('⏳ Waiting for completeLaunch transaction...');
        console.log('   The bot will automatically:');
        console.log('   1. Detect completeLaunch event');
        console.log('   2. Claim your Loyal tokens');
        console.log('   3. Create Loyal/SOL pool with 50%→1% fee decay\n');

        // Subscribe to MetaDAO launchpad program logs
        await this.geyserClient.subscribeToLogs(
            config.launchpadProgramId,
            async (logData: LogData) => {
                await this.handleTransaction(logData);
            }
        );

        console.log('✅ Monitoring active! Press Ctrl+C to stop.\n');

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n\n🛑 Shutting down gracefully...');
            await this.geyserClient.unsubscribeAll();
            process.exit(0);
        });

        // Keep process running
        await new Promise<void>(() => { });
    }

    /**
     * Handle incoming transaction
     */
    private async handleTransaction(logData: LogData): Promise<void> {
        // Skip if already executing or executed
        if (this.isExecuting || this.hasExecuted) {
            return;
        }

        // Check if this is a completeLaunch transaction
        if (!isCompleteLaunchTransaction(logData.logs)) {
            return;
        }

        // Check if it failed
        if (logData.err) {
            console.log('⚠️  Detected completeLaunch transaction but it failed');
            return;
        }

        // Try to extract launch pubkey from logs
        const launchPubkey = extractLaunchPubkey(logData.logs);

        // If we can extract pubkey, check if it matches our target
        if (launchPubkey && launchPubkey !== this.targetLaunchPubkey.toBase58()) {
            console.log(`📥 completeLaunch detected for different launch: ${launchPubkey}`);
            return;
        }

        // If we can't extract pubkey, we still proceed (safer to attempt)
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║              🎉 COMPLETE LAUNCH DETECTED! 🎉              ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        console.log(`🔗 Transaction: ${logData.signature}`);
        console.log(`⏰ Slot: ${logData.slot}`);
        console.log(`📅 Time: ${logData.timestamp}\n`);

        if (launchPubkey) {
            console.log(`🚀 Launch: ${launchPubkey}\n`);
        }

        // Execute claim + pool creation
        await this.executeClaimAndPoolCreation();
    }

    /**
     * Execute the claim and pool creation
     */
    private async executeClaimAndPoolCreation(): Promise<void> {
        this.isExecuting = true;

        try {
            console.log('⚡ Executing claim + pool creation...\n');

            // Small delay to ensure launch state is fully updated on-chain
            console.log('⏳ Waiting 5 seconds for on-chain state to settle...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Execute the claim and pool creation
            const result = await this.poolCreator.executeInSingleSlot();

            console.log('\n╔════════════════════════════════════════════════════════════╗');
            console.log('║           🎊 MISSION ACCOMPLISHED! 🎊                     ║');
            console.log('╚════════════════════════════════════════════════════════════╝\n');

            console.log('✅ Successfully claimed Loyal tokens');
            console.log('✅ Successfully created Loyal/SOL pool\n');

            console.log('📊 Results:');
            console.log(`   Transaction: ${result.signature}`);
            console.log(`   Pool: ${result.poolPda.toBase58()}`);
            console.log(`   Position: ${result.positionPda.toBase58()}`);
            console.log(`   Loyal Token Account: ${result.loyalTokenAccount.toBase58()}`);
            console.log(`   Loyal Mint: ${result.baseMint.toBase58()}\n`);

            console.log('🔗 Links:');
            console.log(`   Solscan: https://solscan.io/tx/${result.signature}`);
            console.log(`   Meteora Pool: https://app.meteora.ag/pools/${result.poolPda.toBase58()}\n`);

            this.hasExecuted = true;

            // Unsubscribe and exit
            console.log('🛑 Shutting down monitor...');
            await this.geyserClient.unsubscribeAll();

            console.log('\n✨ Bot completed successfully. Exiting...\n');
            process.exit(0);

        } catch (error: any) {
            console.error('\n❌ Error executing claim and pool creation:', error.message);

            if (error.stack) {
                console.error('\nStack trace:', error.stack);
            }

            // Don't retry on certain errors
            if (
                error.message.includes('already claimed') ||
                error.message.includes('No funding record')
            ) {
                console.log('\n⚠️  Cannot proceed. Shutting down...');
                this.hasExecuted = true;
                await this.geyserClient.unsubscribeAll();
                process.exit(1);
            }

            console.log('\n⚠️  Will continue monitoring in case of transient error...');
            this.isExecuting = false;
        }
    }

    /**
     * Simulate the claim and pool creation without executing
     */
    async simulate(): Promise<void> {
        console.log('\n🧪 SIMULATION MODE\n');
        console.log(`🎯 Target Launch: ${this.targetLaunchPubkey.toBase58()}`);
        console.log(`👛 Wallet: ${this.poolCreator.getWalletPublicKey().toBase58()}\n`);

        await this.poolCreator.simulate();
    }

    /**
     * Check status of the launch and funding record
     */
    async checkStatus(): Promise<void> {
        console.log('\n📊 STATUS CHECK\n');
        console.log(`🎯 Target Launch: ${this.targetLaunchPubkey.toBase58()}`);
        console.log(`👛 Wallet: ${this.poolCreator.getWalletPublicKey().toBase58()}\n`);

        try {
            const launchData = await this.poolCreator.fetchLaunchData();
            const { record } = await this.poolCreator.checkClaimStatus();

            console.log('\n✅ Status check complete!');
            console.log(`   Ready to claim: ${!record.isTokensClaimed}`);
        } catch (error: any) {
            console.error('\n❌ Error:', error.message);
        }
    }
}

/**
 * Create configuration from environment
 */
export function createLoyalPoolConfigFromEnv(): LoyalPoolConfig {
    const keypairPath = process.env.KEYPAIR_PATH || process.env.WALLET_KEYPAIR_PATH;
    if (!keypairPath) {
        throw new Error('KEYPAIR_PATH or WALLET_KEYPAIR_PATH must be set in environment');
    }

    const loyalLaunchPubkey = process.env.LOYAL_LAUNCH_PUBKEY;
    if (!loyalLaunchPubkey) {
        throw new Error('LOYAL_LAUNCH_PUBKEY must be set in environment');
    }

    const loyalAmount = process.env.LOYAL_AMOUNT
        ? new BN(process.env.LOYAL_AMOUNT)
        : new BN('1000000000'); // 1000 Loyal (6 decimals)

    const solAmount = process.env.SOL_AMOUNT
        ? new BN(process.env.SOL_AMOUNT)
        : new BN(String(0.1 * LAMPORTS_PER_SOL)); // 0.1 SOL

    return {
        rpcUrl: config.rpcUrl,
        keypairPath,
        computeUnitPrice: parseInt(process.env.COMPUTE_UNIT_PRICE || '200000'),

        // MetaDAO Launchpad
        launchpadProgramId: config.launchpadProgramId,
        loyalLaunchPubkey: new PublicKey(loyalLaunchPubkey),

        // Meteora DAMM v2
        dammV2ProgramId: config.dammV2ProgramId,
        poolAuthority: new PublicKey(
            process.env.DAMM_POOL_AUTHORITY || 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
        ),

        // SOL mint
        solMint: new PublicKey('So11111111111111111111111111111111111111112'),

        // Pool creation amounts
        loyalAmount,
        solAmount,

        // Fee scheduler: 50% → 1% decay per minute
        initialFeeBps: parseInt(process.env.INITIAL_FEE_BPS || '5000'), // 50%
        minFeeBps: parseInt(process.env.MIN_FEE_BPS || '100'), // 1%
        decayPerMinute: parseInt(process.env.DECAY_PER_MINUTE || '100'), // 1% per minute

        // Collect fees in quote token only (SOL)
        collectFeeMode: parseInt(process.env.COLLECT_FEE_MODE || '2'), // 2 = quote token only
    };
}

/**
 * Main function to start the automated bot
 */
export async function startAutoLoyalPool(mode: 'monitor' | 'simulate' | 'check' = 'monitor'): Promise<void> {
    const poolConfig = createLoyalPoolConfigFromEnv();
    const orchestrator = new AutoLoyalPoolOrchestrator(
        poolConfig.loyalLaunchPubkey,
        poolConfig
    );

    switch (mode) {
        case 'monitor':
            await orchestrator.startMonitoring();
            break;
        case 'simulate':
            await orchestrator.simulate();
            break;
        case 'check':
            await orchestrator.checkStatus();
            break;
    }
}

