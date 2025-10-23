import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
    ComputeBudgetProgram,
} from '@solana/web3.js';
import {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { CpAmm, getBaseFeeParams, ActivationType, BaseFeeMode, MIN_SQRT_PRICE, MAX_SQRT_PRICE } from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import fs from 'fs';
import bs58 from 'bs58';
import { TransactionExecutor } from '../services/transactionExecutor.js';
import LAUNCHPAD_IDL from '../idl/launchpad.json' with { type: 'json' };

export interface PoolConfig {
    rpcUrl: string;
    walletPrivateKey?: string;
    keypairPath?: string;
    computeUnitPrice: number;
    launchpadProgramId: PublicKey;
    launchPubkey: PublicKey;
    tokenMint?: string;
    dammV2ProgramId: PublicKey;
    poolAuthority: PublicKey;
    solMint: PublicKey;
    tokenAmount: BN;
    solAmount: BN;
    initialFeeBps: number;
    minFeeBps: number;
    decayPerMinute: number;
    collectFeeMode: number;
}

export interface PoolCreationResult {
    signature: string;
    poolPda: PublicKey;
    positionPda: PublicKey;
    tokenAccount: PublicKey;
    baseMint: PublicKey;
}

export class MetaDAOPoolCreator {
    private connection: Connection;
    private wallet: Keypair;
    private launchpadProgram: Program;
    private config: PoolConfig;
    private cpAmm: CpAmm;
    private txExecutor: TransactionExecutor;

    private cache: {
        claimTx: Transaction | null;
        createPoolTx: Transaction | null;
        positionNft: Keypair | null;
        poolPda: PublicKey | null;
        positionPda: PublicKey | null;
        tokenAccount: PublicKey | null;
        baseMint: PublicKey | null;
    } = {
            claimTx: null,
            createPoolTx: null,
            positionNft: null,
            poolPda: null,
            positionPda: null,
            tokenAccount: null,
            baseMint: null,
        };

    constructor(config: PoolConfig) {
        this.config = config;
        this.connection = new Connection(config.rpcUrl, 'confirmed');
        this.wallet = this.loadWallet();
        this.cpAmm = new CpAmm(this.connection);
        this.txExecutor = new TransactionExecutor({
            connection: this.connection,
            useGrpcBlockhash: true,
        });

        const provider = new AnchorProvider(
            this.connection,
            new Wallet(this.wallet),
            { commitment: 'confirmed' }
        );

        this.launchpadProgram = new Program(
            LAUNCHPAD_IDL as any,
            this.config.launchpadProgramId,
            provider
        );
    }

    private loadWallet(): Keypair {
        if (this.config.walletPrivateKey) {
            return Keypair.fromSecretKey(bs58.decode(this.config.walletPrivateKey));
        }
        if (this.config.keypairPath) {
            const secretKey = JSON.parse(fs.readFileSync(this.config.keypairPath, 'utf-8'));
            return Keypair.fromSecretKey(Uint8Array.from(secretKey));
        }
        throw new Error('No wallet configured');
    }

    async fetchLaunchData() {
        const launch = await this.launchpadProgram.account.launch.fetch(this.config.launchPubkey);
        return {
            baseMint: (launch as any).baseMint as PublicKey,
            launchBaseVault: (launch as any).launchBaseVault as PublicKey,
            state: (launch as any).state,
        };
    }

    async checkClaimStatus() {
        const [fundingRecord] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('funding_record'),
                this.config.launchPubkey.toBuffer(),
                this.wallet.publicKey.toBuffer(),
            ],
            this.config.launchpadProgramId
        );

        const record = await this.launchpadProgram.account.fundingRecord.fetch(fundingRecord);

        if ((record as any).isTokensClaimed) {
            throw new Error('Tokens already claimed');
        }

        return { record: record as any, fundingRecord };
    }

    private async buildClaimTx(launchData: any): Promise<{ tx: Transaction; tokenAta: PublicKey }> {
        const baseMint = launchData.baseMint;

        const [fundingRecord] = PublicKey.findProgramAddressSync(
            [Buffer.from('funding_record'), this.config.launchPubkey.toBuffer(), this.wallet.publicKey.toBuffer()],
            this.config.launchpadProgramId
        );

        const [launchSigner] = PublicKey.findProgramAddressSync(
            [Buffer.from('launch_signer'), this.config.launchPubkey.toBuffer()],
            this.config.launchpadProgramId
        );

        const [eventAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from('__event_authority')],
            this.config.launchpadProgramId
        );

        const tokenAta = await getAssociatedTokenAddress(baseMint, this.wallet.publicKey);
        const ataExists = await this.connection.getAccountInfo(tokenAta);

        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.computeUnitPrice }));

        if (!ataExists) {
            tx.add(createAssociatedTokenAccountInstruction(
                this.wallet.publicKey,
                tokenAta,
                this.wallet.publicKey,
                baseMint
            ));
        }

        const claimIx = await this.launchpadProgram.methods
            .claim()
            .accounts({
                launch: this.config.launchPubkey,
                fundingRecord,
                launchSigner,
                baseMint,
                launchBaseVault: launchData.launchBaseVault,
                funder: this.wallet.publicKey,
                funderTokenAccount: tokenAta,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                eventAuthority,
                program: this.config.launchpadProgramId,
            })
            .instruction();

        tx.add(claimIx);
        return { tx, tokenAta };
    }

    private async buildPoolCreationTx(baseMint: PublicKey): Promise<{
        tx: Transaction;
        positionNft: Keypair;
        poolPda: PublicKey;
        positionPda: PublicKey;
    }> {
        const positionNft = Keypair.generate();

        const { initSqrtPrice, liquidityDelta } = this.cpAmm.preparePoolCreationParams({
            tokenAAmount: this.config.tokenAmount,
            tokenBAmount: this.config.solAmount,
            minSqrtPrice: MIN_SQRT_PRICE,
            maxSqrtPrice: MAX_SQRT_PRICE,
        });

        const decayMinutes = (this.config.initialFeeBps - this.config.minFeeBps) / this.config.decayPerMinute;
        const totalDuration = Math.ceil(decayMinutes * 60);

        const baseFeeParams = getBaseFeeParams(
            {
                baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
                feeSchedulerParam: {
                    startingFeeBps: this.config.initialFeeBps,
                    endingFeeBps: this.config.minFeeBps,
                    numberOfPeriod: Math.ceil(decayMinutes),
                    totalDuration,
                },
            },
            9,
            ActivationType.Slot
        );

        const { tx, pool: poolPda, position: positionPda } = await this.cpAmm.createCustomPool({
            tokenAMint: baseMint,
            tokenBMint: this.config.solMint,
            tokenAAmount: this.config.tokenAmount,
            tokenBAmount: this.config.solAmount,
            sqrtMinPrice: MIN_SQRT_PRICE,
            sqrtMaxPrice: MAX_SQRT_PRICE,
            liquidityDelta,
            initSqrtPrice,
            payer: this.wallet.publicKey,
            creator: this.wallet.publicKey,
            positionNft: positionNft.publicKey,
            poolFees: {
                baseFee: baseFeeParams,
                padding: [],
                dynamicFee: null,
            },
            hasAlphaVault: false,
            collectFeeMode: this.config.collectFeeMode,
            activationPoint: null,
            activationType: 0,
            tokenAProgram: TOKEN_PROGRAM_ID,
            tokenBProgram: TOKEN_PROGRAM_ID,
            isLockLiquidity: false,
        });

        return { tx, positionNft, poolPda, positionPda };
    }

    async preBuildTransaction(): Promise<void> {
        const baseMint = this.config.tokenMint
            ? new PublicKey(this.config.tokenMint)
            : (await this.fetchLaunchData()).baseMint;

        const launchData = await this.fetchLaunchData();
        const { tx: claimTx, tokenAta } = await this.buildClaimTx(launchData);
        const { tx: createPoolTx, positionNft, poolPda, positionPda } = await this.buildPoolCreationTx(baseMint);

        claimTx.feePayer = this.wallet.publicKey;
        createPoolTx.feePayer = this.wallet.publicKey;

        this.cache = {
            claimTx,
            createPoolTx,
            positionNft,
            poolPda,
            positionPda,
            tokenAccount: tokenAta,
            baseMint,
        };

        console.log(`✅ Pre-built: Pool ${poolPda.toBase58()}`);
    }

    async executeInstantFire(): Promise<PoolCreationResult> {
        if (!this.cache.claimTx || !this.cache.createPoolTx) {
            throw new Error('Call preBuildTransaction() first');
        }

        const claimSig = await this.txExecutor.sendClaim(this.cache.claimTx, this.wallet);
        const poolExists = await this.connection.getAccountInfo(this.cache.poolPda!);

        if (!poolExists) {
            const poolSig = await this.txExecutor.sendPoolCreation(
                this.cache.createPoolTx,
                this.wallet,
                this.cache.positionNft!
            );

            return {
                signature: poolSig,
                poolPda: this.cache.poolPda!,
                positionPda: this.cache.positionPda!,
                tokenAccount: this.cache.tokenAccount!,
                baseMint: this.cache.baseMint!,
            };
        } else {
            return await this.addLiquidityToExistingPool();
        }
    }

    async addLiquidityToExistingPool(): Promise<PoolCreationResult> {
        const baseMint = this.cache.baseMint!;
        const buf1 = baseMint.toBuffer();
        const buf2 = this.config.solMint.toBuffer();
        const firstKey = Buffer.compare(buf1, buf2) === 1 ? buf1 : buf2;
        const secondKey = Buffer.compare(buf1, buf2) === 1 ? buf2 : buf1;

        const [poolPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('cpool'), firstKey, secondKey],
            this.config.dammV2ProgramId
        );

        const poolState = await this.cpAmm.fetchPoolState(poolPda);
        const isTokenA = poolState.tokenAMint.equals(baseMint);

        const depositQuote = this.cpAmm.getDepositQuote({
            inAmount: this.config.tokenAmount,
            isTokenA,
            minSqrtPrice: poolState.sqrtMinPrice,
            maxSqrtPrice: poolState.sqrtMaxPrice,
            sqrtPrice: poolState.sqrtPrice,
        });

        const maxTokenA = isTokenA ? this.config.tokenAmount : depositQuote.outputAmount;
        const maxTokenB = isTokenA ? depositQuote.outputAmount : this.config.tokenAmount;

        const positionNft = Keypair.generate();

        const tx = await this.cpAmm.createPositionAndAddLiquidity({
            owner: this.wallet.publicKey,
            pool: poolPda,
            positionNft: positionNft.publicKey,
            liquidityDelta: depositQuote.liquidityDelta,
            maxAmountTokenA: maxTokenA,
            maxAmountTokenB: maxTokenB,
            tokenAAmountThreshold: maxTokenA,
            tokenBAmountThreshold: maxTokenB,
            tokenAMint: poolState.tokenAMint,
            tokenBMint: poolState.tokenBMint,
            tokenAProgram: TOKEN_PROGRAM_ID,
            tokenBProgram: TOKEN_PROGRAM_ID,
        });

        tx.feePayer = this.wallet.publicKey;
        const signature = await this.txExecutor.sendAddLiquidity(tx, this.wallet, positionNft);

        const [positionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('position'), positionNft.publicKey.toBuffer()],
            this.config.dammV2ProgramId
        );

        return {
            signature,
            poolPda,
            positionPda,
            tokenAccount: this.cache.tokenAccount!,
            baseMint,
        };
    }

    async executeInSingleSlot(): Promise<PoolCreationResult> {
        return this.executeInstantFire();
    }

    getWalletPublicKey(): PublicKey {
        return this.wallet.publicKey;
    }
}
