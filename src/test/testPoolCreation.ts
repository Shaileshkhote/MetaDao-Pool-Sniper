import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { CpAmm, getBaseFeeParams, ActivationType, BaseFeeMode, MIN_SQRT_PRICE, MAX_SQRT_PRICE } from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';
import fs from 'fs';
import { config } from '../config/config.js';

/**
 * Simple Meteora Pool Test - Using Official SDK
 */

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         🧪 METEORA DAMM POOL (Official SDK) 🧪            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const args = process.argv.slice(2);
    const shouldExecute = args.includes('--execute');
    const nonFlagArgs = args.filter(arg => !arg.startsWith('--'));

    const tokenMintStr = nonFlagArgs[0];
    const tokenAmountStr = nonFlagArgs[1];

    if (!tokenMintStr || !tokenAmountStr) {
        console.error('Usage: npm run test:pool -- <TOKEN_MINT> <TOKEN_AMOUNT> [--execute]\n');
        console.log('Examples:');
        console.log('  npm run test:pool -- 6p6xgHyF... 3000000');
        console.log('  npm run test:pool -- LYLikz... 1000000000 --execute\n');
        process.exit(1);
    }

    const tokenMint = new PublicKey(tokenMintStr);
    const tokenAmount = new BN(tokenAmountStr);
    const solMint = new PublicKey('So11111111111111111111111111111111111111112');

    console.log(`🎯 Token: ${tokenMint.toBase58()}`);
    console.log(`💧 Amount: ${tokenAmount.toString()}`);
    console.log(`📊 Mode: ${shouldExecute ? '🔥 EXECUTE' : '🧪 SIMULATE'}\n`);

    const connection = new Connection(config.rpcUrl, 'confirmed');
    const wallet = loadWallet();
    const cpAmm = new CpAmm(connection);

    console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}`);
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`💰 SOL: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}\n`);

    // Check pool
    const buf1 = tokenMint.toBuffer();
    const buf2 = solMint.toBuffer();
    const firstKey = Buffer.compare(buf1, buf2) === 1 ? buf1 : buf2;
    const secondKey = Buffer.compare(buf1, buf2) === 1 ? buf2 : buf1;

    const [poolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('cpool'), firstKey, secondKey],
        config.dammV2ProgramId
    );

    const poolExists = await cpAmm.isPoolExist(poolPda);
    console.log(`📝 Pool: ${poolPda.toBase58()}`);
    console.log(`📊 Status: ${poolExists ? 'EXISTS' : 'DOES NOT EXIST'}\n`);

    if (!poolExists) {
        console.log('🆕 Creating new customizable pool...\n');
        await createPool(connection, wallet, cpAmm, tokenMint, tokenAmount, shouldExecute);
    } else {
        const poolState = await cpAmm.fetchPoolState(poolPda);
        console.log('💧 Adding liquidity to existing pool...\n');

        if (poolState.liquidity.eqn(0)) {
            console.warn('⚠️  Pool has ZERO liquidity - you will be the first LP!');
            console.warn(`   Check pool: https://app.meteora.ag/pools/${poolPda.toBase58()}\n`);
        }

        await addLiquidity(connection, wallet, cpAmm, poolPda, poolState, tokenMint, tokenAmount, shouldExecute);
    }
}

async function createPool(
    connection: Connection,
    wallet: Keypair,
    cpAmm: CpAmm,
    tokenMint: PublicKey,
    tokenAmount: BN,
    shouldExecute: boolean
) {
    const solMint = new PublicKey('So11111111111111111111111111111111111111112');
    const solAmount = new BN(String(0.1 * LAMPORTS_PER_SOL));
    const positionNft = Keypair.generate();

    // Use SDK constants for price range
    const sqrtMinPrice = MIN_SQRT_PRICE;
    const sqrtMaxPrice = MAX_SQRT_PRICE;

    // Calculate init price and liquidity
    const { initSqrtPrice, liquidityDelta } = cpAmm.preparePoolCreationParams({
        tokenAAmount: tokenAmount,
        tokenBAmount: solAmount,
        minSqrtPrice: sqrtMinPrice,
        maxSqrtPrice: sqrtMaxPrice,
    });

    console.log(`💱 Init Price: ${initSqrtPrice.toString()}`);
    console.log(`💧 Liquidity: ${liquidityDelta.toString()}\n`);

    // Fee config using SDK helper
    const decayMinutes = (config.initialFeeBps - config.minFeeBps) / config.decayPerMinute;
    const totalDuration = Math.ceil(decayMinutes * 60);

    const baseFeeParams = getBaseFeeParams(
        {
            baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
            feeSchedulerParam: {
                startingFeeBps: config.initialFeeBps,
                endingFeeBps: config.minFeeBps,
                numberOfPeriod: Math.ceil(decayMinutes),
                totalDuration,
            },
        },
        9,
        ActivationType.Slot
    );

    console.log(`⚙️  Fee: ${config.initialFeeBps / 100}% → ${config.minFeeBps / 100}% over ${decayMinutes.toFixed(1)} min\n`);

    const poolFees = {
        baseFee: baseFeeParams,
        padding: [],
        dynamicFee: null,
    };

    const { tx, pool, position } = await cpAmm.createCustomPool({
        tokenAMint: tokenMint,
        tokenBMint: solMint,
        tokenAAmount: tokenAmount,
        tokenBAmount: solAmount,
        sqrtMinPrice,
        sqrtMaxPrice,
        liquidityDelta,
        initSqrtPrice,
        payer: wallet.publicKey,
        creator: wallet.publicKey,
        positionNft: positionNft.publicKey,
        poolFees,
        hasAlphaVault: false,
        collectFeeMode: 0,
        activationPoint: null,
        activationType: 0,
        tokenAProgram: TOKEN_PROGRAM_ID,
        tokenBProgram: TOKEN_PROGRAM_ID,
        isLockLiquidity: false,
    });

    console.log(`✅ Transaction built`);
    console.log(`📦 Pool: ${pool.toBase58()}`);
    console.log(`📍 Position: ${position.toBase58()}\n`);

    if (shouldExecute) {
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = wallet.publicKey;
        tx.partialSign(wallet, positionNft);

        console.log('🚀 Sending...\n');
        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(sig);

        console.log('✅ POOL CREATED!');
        console.log(`🔗 https://solscan.io/tx/${sig}`);
        console.log(`🌊 https://app.meteora.ag/pools/${pool.toBase58()}\n`);
    } else {
        console.log('🧪 Simulating...');
        tx.partialSign(positionNft);
        const sim = await connection.simulateTransaction(tx);
        if (sim.value.err) {
            console.error('❌ Failed:', sim.value.err);
            process.exit(1);
        }
        console.log(`✅ Simulation OK! Compute: ${sim.value.unitsConsumed}\n`);
    }
}

async function addLiquidity(
    connection: Connection,
    wallet: Keypair,
    cpAmm: CpAmm,
    pool: PublicKey,
    poolState: any,
    tokenMint: PublicKey,
    tokenAmount: BN,
    shouldExecute: boolean
) {
    const positionNft = Keypair.generate();

    console.log(`📊 Pool liquidity: ${poolState.liquidity.toString()}`);
    console.log(`📝 New position: ${positionNft.publicKey.toBase58()}\n`);

    // Use SDK to properly calculate amounts
    const isTokenA = poolState.tokenAMint.equals(tokenMint);

    // Get deposit quote to know how much of the other token we need
    const depositQuote = cpAmm.getDepositQuote({
        inAmount: tokenAmount,
        isTokenA,
        minSqrtPrice: poolState.sqrtMinPrice,
        maxSqrtPrice: poolState.sqrtMaxPrice,
        sqrtPrice: poolState.sqrtPrice,
    });

    // Use SDK values directly
    const liquidityDelta = depositQuote.liquidityDelta;
    const maxTokenA = isTokenA ? tokenAmount : depositQuote.outputAmount;
    const maxTokenB = isTokenA ? depositQuote.outputAmount : tokenAmount;

    console.log(`💧 Liquidity delta: ${liquidityDelta.toString()}`);
    console.log(`📊 Amounts:`);
    console.log(`   Max Token A: ${maxTokenA.toString()}`);
    console.log(`   Max Token B: ${maxTokenB.toString()}\n`);

    const tx = await cpAmm.createPositionAndAddLiquidity({
        owner: wallet.publicKey,
        pool,
        positionNft: positionNft.publicKey,
        liquidityDelta,
        maxAmountTokenA: maxTokenA,
        maxAmountTokenB: maxTokenB,
        tokenAAmountThreshold: maxTokenA.mul(new BN(105)).div(new BN(100)),
        tokenBAmountThreshold: maxTokenB.mul(new BN(105)).div(new BN(100)),
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAProgram: TOKEN_PROGRAM_ID,
        tokenBProgram: TOKEN_PROGRAM_ID,
    });

    if (shouldExecute) {
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = wallet.publicKey;
        tx.partialSign(wallet, positionNft);

        console.log('🚀 Sending...\n');
        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(sig);

        console.log('✅ LIQUIDITY ADDED!');
        console.log(`🔗 https://solscan.io/tx/${sig}\n`);
    } else {
        console.log('🧪 Simulating...');
        tx.partialSign(positionNft);
        const sim = await connection.simulateTransaction(tx);
        if (sim.value.err) {
            console.error('❌ Failed:', sim.value.err);
            if (sim.value.logs) sim.value.logs.forEach(l => console.error(l));
            process.exit(1);
        }
        console.log(`✅ Simulation OK! Compute: ${sim.value.unitsConsumed}\n`);
    }
}

function loadWallet(): Keypair {
    if (config.walletPrivateKey) {
        return Keypair.fromSecretKey(bs58.decode(config.walletPrivateKey));
    }
    if (config.keypairPath) {
        const secretKey = JSON.parse(fs.readFileSync(config.keypairPath, 'utf-8'));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }
    throw new Error('No wallet configured!');
}

main().catch(console.error);
