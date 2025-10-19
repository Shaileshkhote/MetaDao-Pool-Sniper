import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
    ComputeBudgetProgram,
} from '@solana/web3.js';
import {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Program, AnchorProvider, Wallet, BN, Idl } from '@coral-xyz/anchor';
import fs from 'fs';

// Import IDLs
import LAUNCHPAD_IDL from '../idl/launchpad.json' with { type: 'json' };
import DAMM_V2_IDL from '../idl/damm.json' with { type: 'json' };

export interface LoyalPoolConfig {
    rpcUrl: string;
    keypairPath: string;
    computeUnitPrice: number;

    // MetaDAO Launchpad
    launchpadProgramId: PublicKey;
    loyalLaunchPubkey: PublicKey;

    // Meteora DAMM v2
    dammV2ProgramId: PublicKey;
    poolAuthority: PublicKey;

    // SOL mint
    solMint: PublicKey;

    // Pool creation amounts
    loyalAmount: BN;
    solAmount: BN;

    // Fee scheduler
    initialFeeBps: number;
    minFeeBps: number;
    decayPerMinute: number;

    // Collect fee mode
    collectFeeMode: number;
}

export interface LaunchData {
    state: any;
    baseMint: PublicKey;
    launchBaseVault: PublicKey;
    totalCommittedAmount: BN;
}

export interface FundingRecord {
    committedAmount: BN;
    isTokensClaimed: boolean;
}

export interface ATAResult {
    address: PublicKey;
    needsCreation: boolean;
    instruction: any | null;
}

export interface FeeScheduler {
    cliffFeeNumerator: BN;
    baseFeeMode: number;
    firstFactor: number;
    secondFactor: Buffer;
    thirdFactor: BN;
}

export interface PoolCreationResult {
    signature: string;
    poolPda: PublicKey;
    positionPda: PublicKey;
    loyalTokenAccount: PublicKey;
    baseMint: PublicKey;
}

/**
 * MetaDAO Loyal Token Claim & DAMM v2 Pool Creation
 * 
 * 1. Claims Loyal tokens from MetaDAO launchpad
 * 2. Creates NEW DAMM v2 pool: Loyal/SOL
 * 3. Fee scheduler: 50% → 1% decay per minute
 * 4. Collect fees in quote token (SOL) only
 */
export class MetaDAOLoyalPoolCreator {
    private connection: Connection;
    private wallet: Keypair;
    private launchpadProgram!: Program;
    private dammV2Program!: Program;
    private config: LoyalPoolConfig;

    constructor(config: LoyalPoolConfig) {
        this.config = config;
        this.connection = new Connection(config.rpcUrl, 'confirmed');
        this.wallet = this.loadWallet(config.keypairPath);
        this.setupAnchor();
    }

    private loadWallet(keypairPath: string): Keypair {
        const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }

    private setupAnchor(): void {
        const provider = new AnchorProvider(
            this.connection,
            new Wallet(this.wallet),
            { commitment: 'confirmed' }
        );

        this.launchpadProgram = new Program(
            LAUNCHPAD_IDL as any as Idl,
            this.config.launchpadProgramId,
            provider
        );

        this.dammV2Program = new Program(
            DAMM_V2_IDL as any as Idl,
            this.config.dammV2ProgramId,
            provider
        );
    }

    async getOrCreateATA(
        mint: PublicKey,
        owner: PublicKey,
        allowOwnerOffCurve = false
    ): Promise<ATAResult> {
        const ata = await getAssociatedTokenAddress(
            mint,
            owner,
            allowOwnerOffCurve,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const accountInfo = await this.connection.getAccountInfo(ata);

        return {
            address: ata,
            needsCreation: accountInfo === null,
            instruction:
                accountInfo === null
                    ? createAssociatedTokenAccountInstruction(
                        owner,
                        ata,
                        owner,
                        mint,
                        TOKEN_PROGRAM_ID,
                        ASSOCIATED_TOKEN_PROGRAM_ID
                    )
                    : null,
        };
    }

    /**
     * Fetch launch data
     */
    async fetchLaunchData(): Promise<LaunchData> {
        console.log('📊 Fetching Loyal launch data...');
        const launch = await this.launchpadProgram.account.launch.fetch(
            this.config.loyalLaunchPubkey
        );

        console.log('\nLaunch Details:');
        console.log(`  State: ${Object.keys((launch as any).state)[0]}`);
        console.log(`  Base Mint (Loyal): ${(launch as any).baseMint.toBase58()}`);
        console.log(`  Total Raised: ${(launch as any).totalCommittedAmount.toString()}`);

        return launch as any as LaunchData;
    }

    /**
     * Check claim eligibility
     */
    async checkClaimStatus(): Promise<{ record: FundingRecord; fundingRecord: PublicKey }> {
        console.log('\n🔍 Checking claim eligibility...');

        const [fundingRecord] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('funding_record'),
                this.config.loyalLaunchPubkey.toBuffer(),
                this.wallet.publicKey.toBuffer(),
            ],
            this.config.launchpadProgramId
        );

        try {
            const record = await this.launchpadProgram.account.fundingRecord.fetch(
                fundingRecord
            );

            console.log('💰 Your Funding Record:');
            console.log(`  Committed: ${(record as any).committedAmount.toString()}`);
            console.log(`  Claimed: ${(record as any).isTokensClaimed ? 'Yes' : 'No'}`);

            if ((record as any).isTokensClaimed) {
                throw new Error('Tokens already claimed!');
            }

            console.log('✅ Eligible to claim!');
            return { record: record as any as FundingRecord, fundingRecord };
        } catch (error: any) {
            if (error.message.includes('Account does not exist')) {
                throw new Error('No funding record. Did you participate?');
            }
            throw error;
        }
    }

    /**
     * Build claim instruction
     */
    async buildClaimInstruction(launchData: LaunchData): Promise<{
        claimIx: any;
        ataIx: any | null;
        baseMint: PublicKey;
        loyalTokenAccount: PublicKey;
    }> {
        console.log('\n🔨 Building claim instruction...');

        const baseMint = launchData.baseMint;

        const [fundingRecord] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('funding_record'),
                this.config.loyalLaunchPubkey.toBuffer(),
                this.wallet.publicKey.toBuffer(),
            ],
            this.config.launchpadProgramId
        );

        const [launchSigner] = PublicKey.findProgramAddressSync(
            [Buffer.from('launch_signer'), this.config.loyalLaunchPubkey.toBuffer()],
            this.config.launchpadProgramId
        );

        const [eventAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from('__event_authority')],
            this.config.launchpadProgramId
        );

        const funderTokenAccount = await this.getOrCreateATA(baseMint, this.wallet.publicKey);

        const claimIx = await this.launchpadProgram.methods
            .claim()
            .accounts({
                launch: this.config.loyalLaunchPubkey,
                fundingRecord: fundingRecord,
                launchSigner: launchSigner,
                baseMint: baseMint,
                launchBaseVault: launchData.launchBaseVault,
                funder: this.wallet.publicKey,
                funderTokenAccount: funderTokenAccount.address,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                eventAuthority: eventAuthority,
                program: this.config.launchpadProgramId,
            })
            .instruction();

        console.log(`  Loyal Mint: ${baseMint.toBase58()}`);
        console.log(`  Token Account: ${funderTokenAccount.address.toBase58()}`);

        return {
            claimIx,
            ataIx: funderTokenAccount.instruction,
            baseMint,
            loyalTokenAccount: funderTokenAccount.address,
        };
    }

    /**
     * Calculate fee scheduler parameters
     * 50% initial fee, decaying 1% per minute
     */
    calculateFeeScheduler(): FeeScheduler {
        console.log('\n⚙️  Fee Scheduler Configuration:');
        console.log(`  Initial Fee: ${this.config.initialFeeBps / 100}%`);
        console.log(`  Min Fee: ${this.config.minFeeBps / 100}%`);
        console.log(`  Decay Rate: ${this.config.decayPerMinute / 100}% per minute`);

        // Calculate how many minutes until min fee
        const totalDecay = this.config.initialFeeBps - this.config.minFeeBps;
        const minutesToMin = totalDecay / this.config.decayPerMinute;
        const slotsPerMinute = 150; // ~2.5 slots per second * 60 seconds
        const totalSlots = Math.ceil(minutesToMin * slotsPerMinute);

        console.log(
            `  Will reach ${this.config.minFeeBps / 100}% after ~${Math.ceil(minutesToMin)} minutes (${totalSlots} slots)`
        );

        return {
            cliffFeeNumerator: new BN(this.config.initialFeeBps),
            baseFeeMode: 2, // Time-based fee scheduler
            firstFactor: totalSlots, // Total slots for decay
            secondFactor: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), // Unused for mode 2
            thirdFactor: new BN(this.config.minFeeBps), // Min fee
        };
    }

    /**
     * Build pool creation instruction with customizable fee
     */
    async buildCreatePoolInstruction(
        baseMint: PublicKey,
        loyalTokenAccount: PublicKey
    ): Promise<{
        createPoolIx: any;
        positionNftMint: Keypair;
        solAtaIx: any | null;
        poolPda: PublicKey;
        positionPda: PublicKey;
    }> {
        console.log('\n🔨 Building pool creation instruction...');

        // Generate position NFT mint (required for pool creation)
        const positionNftMint = Keypair.generate();
        console.log(`  Position NFT Mint: ${positionNftMint.publicKey.toBase58()}`);

        // Derive position NFT account PDA
        const [positionNftAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from('position_nft_account'), positionNftMint.publicKey.toBuffer()],
            this.config.dammV2ProgramId
        );

        // Derive pool PDA (token mints determine pool address)
        const [poolPda] = PublicKey.findProgramAddressSync(
            [baseMint.toBuffer(), this.config.solMint.toBuffer()],
            this.config.dammV2ProgramId
        );

        console.log(`  Pool Address: ${poolPda.toBase58()}`);

        // Derive position PDA
        const [positionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('position'), positionNftMint.publicKey.toBuffer()],
            this.config.dammV2ProgramId
        );

        // Derive token vaults
        const [tokenAVault] = PublicKey.findProgramAddressSync(
            [Buffer.from('token_vault'), baseMint.toBuffer(), poolPda.toBuffer()],
            this.config.dammV2ProgramId
        );

        const [tokenBVault] = PublicKey.findProgramAddressSync(
            [Buffer.from('token_vault'), this.config.solMint.toBuffer(), poolPda.toBuffer()],
            this.config.dammV2ProgramId
        );

        // Get SOL token account (wrapped SOL)
        const solTokenAccount = await this.getOrCreateATA(
            this.config.solMint,
            this.wallet.publicKey
        );

        // Event authority
        const [eventAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from('__event_authority')],
            this.config.dammV2ProgramId
        );

        // Calculate price
        // sqrt_price = sqrt(token_b_amount / token_a_amount) * 2^64
        const priceRatio =
            this.config.solAmount.toNumber() / this.config.loyalAmount.toNumber();
        const sqrtPrice = Math.sqrt(priceRatio);
        const sqrtPriceX64 = new BN(Math.floor(sqrtPrice * Math.pow(2, 64)));

        console.log(`  Initial Price: ${priceRatio.toFixed(9)} SOL per Loyal`);
        console.log(`  Sqrt Price: ${sqrtPriceX64.toString()}`);

        // Fee scheduler config
        const feeScheduler = this.calculateFeeScheduler();

        // Pool parameters for customizable pool
        const params = {
            poolFees: {
                baseFee: feeScheduler,
                padding: [0, 0, 0],
                dynamicFee: null, // No dynamic fee, using time-based scheduler
            },
            sqrtMinPrice: new BN(0), // No price range restriction
            sqrtMaxPrice: new BN('340282366920938463463374607431768211455'), // Max u128
            hasAlphaVault: false,
            liquidity: new BN(1000000), // Initial liquidity
            sqrtPrice: sqrtPriceX64,
            activationType: 0, // Activate by slot
            collectFeeMode: this.config.collectFeeMode, // Collect fees in quote token only (SOL)
            activationPoint: null, // Activate immediately
        };

        // Create customizable pool instruction
        const createPoolIx = await this.dammV2Program.methods
            .initializeCustomizablePool(params)
            .accounts({
                creator: this.wallet.publicKey,
                positionNftMint: positionNftMint.publicKey,
                positionNftAccount: positionNftAccount,
                payer: this.wallet.publicKey,
                poolAuthority: this.config.poolAuthority,
                pool: poolPda,
                position: positionPda,
                tokenAMint: baseMint,
                tokenBMint: this.config.solMint,
                tokenAVault: tokenAVault,
                tokenBVault: tokenBVault,
                payerTokenA: loyalTokenAccount,
                payerTokenB: solTokenAccount.address,
                tokenAProgram: TOKEN_PROGRAM_ID,
                tokenBProgram: TOKEN_PROGRAM_ID,
                token2022Program: TOKEN_2022_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                eventAuthority: eventAuthority,
                program: this.config.dammV2ProgramId,
            })
            .instruction();

        return {
            createPoolIx,
            positionNftMint,
            solAtaIx: solTokenAccount.instruction,
            poolPda,
            positionPda,
        };
    }

    /**
     * Execute claim + pool creation in single transaction
     */
    async executeInSingleSlot(): Promise<PoolCreationResult> {
        try {
            console.log('\n╔════════════════════════════════════════════════════════════╗');
            console.log('║  Claim Loyal + Create DAMM v2 Pool (Loyal/SOL)            ║');
            console.log('╚════════════════════════════════════════════════════════════╝\n');

            console.log(`👛 Wallet: ${this.wallet.publicKey.toBase58()}`);

            const balance = await this.connection.getBalance(this.wallet.publicKey);
            console.log(`💰 SOL Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}`);

            // 1. Fetch launch
            const launchData = await this.fetchLaunchData();

            const state = Object.keys(launchData.state)[0];
            if (state !== 'complete' && state !== 'Complete') {
                throw new Error(`Launch must be complete. Current: ${state}`);
            }

            // 2. Check eligibility
            await this.checkClaimStatus();

            // 3. Build claim instruction
            const { claimIx, ataIx: loyalAtaIx, baseMint, loyalTokenAccount } =
                await this.buildClaimInstruction(launchData);

            // 4. Build pool creation instruction
            const { createPoolIx, positionNftMint, solAtaIx, poolPda, positionPda } =
                await this.buildCreatePoolInstruction(baseMint, loyalTokenAccount);

            // 5. Build transaction
            console.log('\n📦 Building single transaction...');
            const transaction = new Transaction();

            // Compute budget
            transaction.add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: this.config.computeUnitPrice,
                })
            );

            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: 800000, // Pool creation needs more CU
                })
            );

            // Add instructions
            if (loyalAtaIx) {
                console.log('  ➕ Create Loyal token account');
                transaction.add(loyalAtaIx);
            }

            if (solAtaIx) {
                console.log('  ➕ Create SOL token account');
                transaction.add(solAtaIx);
            }

            console.log('  ➕ Claim Loyal tokens');
            transaction.add(claimIx);

            console.log('  ➕ Create DAMM v2 pool (Loyal/SOL)');
            transaction.add(createPoolIx);

            const signers = [this.wallet, positionNftMint];

            console.log(`\n📝 Transaction: ${transaction.instructions.length} instructions`);
            console.log(`🔑 Signers: ${signers.length}`);

            const { blockhash } = await this.connection.getLatestBlockhash('finalized');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.wallet.publicKey;

            console.log('\n🚀 Sending transaction...');

            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                signers,
                {
                    commitment: 'confirmed',
                    maxRetries: 5,
                }
            );

            console.log('\n╔════════════════════════════════════════════════════════════╗');
            console.log('║                    ✅ SUCCESS!                             ║');
            console.log('╚════════════════════════════════════════════════════════════╝\n');
            console.log(`🔗 TX: ${signature}`);
            console.log(`🔍 Explorer: https://solscan.io/tx/${signature}`);
            console.log(`\n💎 Pool (Loyal/SOL): ${poolPda.toBase58()}`);
            console.log(`📍 Your Position: ${positionPda.toBase58()}`);
            console.log(`🪙 Loyal Tokens: ${loyalTokenAccount.toBase58()}`);
            console.log(`\n🌊 Meteora: https://app.meteora.ag/pools/${poolPda.toBase58()}`);

            return { signature, poolPda, positionPda, loyalTokenAccount, baseMint };
        } catch (error: any) {
            console.error('\n❌ Error:', error.message);
            if (error.logs) {
                console.error('\n📋 Logs:');
                error.logs.forEach((log: string) => console.error(log));
            }
            throw error;
        }
    }

    /**
     * Simulate transaction
     */
    async simulate(): Promise<any> {
        console.log('\n🧪 SIMULATION MODE\n');

        try {
            const launchData = await this.fetchLaunchData();
            await this.checkClaimStatus();

            const { claimIx, ataIx: loyalAtaIx, baseMint, loyalTokenAccount } =
                await this.buildClaimInstruction(launchData);

            const { createPoolIx, positionNftMint, solAtaIx } =
                await this.buildCreatePoolInstruction(baseMint, loyalTokenAccount);

            const transaction = new Transaction();

            if (loyalAtaIx) transaction.add(loyalAtaIx);
            if (solAtaIx) transaction.add(solAtaIx);
            transaction.add(claimIx);
            transaction.add(createPoolIx);

            transaction.recentBlockhash = (
                await this.connection.getLatestBlockhash()
            ).blockhash;
            transaction.feePayer = this.wallet.publicKey;
            transaction.partialSign(positionNftMint);

            const simulation = await this.connection.simulateTransaction(transaction);

            if (simulation.value.err) {
                console.error('\n❌ Simulation failed!');
                console.error('Error:', simulation.value.err);
                if (simulation.value.logs) {
                    console.error('\nLogs:');
                    simulation.value.logs.forEach((log) => console.error(log));
                }
                throw new Error('Simulation failed');
            } else {
                console.log('\n✅ Simulation successful!');
                console.log(
                    `⚡ Compute: ${simulation.value.unitsConsumed?.toLocaleString()}`
                );
            }

            return simulation;
        } catch (error: any) {
            console.error('\n❌ Error:', error.message);
            throw error;
        }
    }

    getWalletPublicKey(): PublicKey {
        return this.wallet.publicKey;
    }
}

