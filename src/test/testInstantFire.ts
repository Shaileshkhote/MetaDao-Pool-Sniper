import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createMint } from '@solana/spl-token';
import { CpAmm, getBaseFeeParams, ActivationType, BaseFeeMode, MIN_SQRT_PRICE, MAX_SQRT_PRICE } from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';
import fs from 'fs';
import { config } from '../config/config.js';
import { getYellowstoneStream } from '../services/yellowstoneGrpc.js';

/**
 * Test Instant Fire Mechanism
 * 
 * This test:
 * 1. Creates a token (gets mint address but doesn't mint yet)
 * 2. Pre-builds pool creation transaction
 * 3. Listens via Yellowstone for wallet activity
 * 4. When you run triggerMint.ts, it fires the pre-built tx instantly
 */

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║          ⚡ TEST INSTANT FIRE MECHANISM ⚡                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const connection = new Connection(config.rpcUrl, 'confirmed');
    const wallet = loadWallet();

    console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}`);
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`💰 SOL: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}\n`);

    // Step 1: Create token mint (but don't mint tokens yet)
    console.log('🪙 Step 1: Creating token mint...');
    const mintKeypair = Keypair.generate();

    const mint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        wallet.publicKey,
        6,
        mintKeypair,
        undefined,
        TOKEN_PROGRAM_ID
    );

    console.log(`✅ Mint created: ${mint.toBase58()}`);
    console.log(`   (No tokens minted yet)\n`);

    // Save mint address for trigger script
    fs.writeFileSync('/tmp/test_mint.txt', mint.toBase58());
    console.log(`💾 Saved mint address to /tmp/test_mint.txt\n`);

    // Step 2: Pre-build pool creation transaction
    console.log('⚡ Step 2: Pre-building pool creation transaction...\n');

    const tokenAmount = new BN(1000000000); // 1000 tokens
    const solAmount = new BN(String(0.1 * LAMPORTS_PER_SOL));

    const cpAmm = new CpAmm(connection);
    const positionNft = Keypair.generate();

    const { initSqrtPrice, liquidityDelta } = cpAmm.preparePoolCreationParams({
        tokenAAmount: tokenAmount,
        tokenBAmount: solAmount,
        minSqrtPrice: MIN_SQRT_PRICE,
        maxSqrtPrice: MAX_SQRT_PRICE,
    });

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

    const poolFees = {
        baseFee: baseFeeParams,
        padding: [],
        dynamicFee: null,
    };

    const { tx: createPoolTx, pool: poolPda, position: positionPda } = await cpAmm.createCustomPool({
        tokenAMint: mint,
        tokenBMint: new PublicKey('So11111111111111111111111111111111111111112'),
        tokenAAmount: tokenAmount,
        tokenBAmount: solAmount,
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
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

    createPoolTx.feePayer = wallet.publicKey;

    console.log(`✅ Pool transaction pre-built!`);
    console.log(`📦 Pool: ${poolPda.toBase58()}`);
    console.log(`📍 Position: ${positionPda.toBase58()}`);
    console.log(`📦 Instructions: ${createPoolTx.instructions.length}\n`);

    // Step 3: Start Yellowstone listener
    console.log('🌊 Step 3: Starting Yellowstone listener...\n');

    const yellowstone = getYellowstoneStream();

    // Listen for transactions involving OUR WALLET
    console.log(`📡 Listening for wallet transactions: ${wallet.publicKey.toBase58().substring(0, 20)}...\n`);
    await yellowstone.startUnifiedStream(wallet.publicKey);

    let txFired = false;

    yellowstone.onTransaction('mint_trigger', async (txData) => {
        if (txFired) return;

        // Check if transaction involves our mint (in accounts!) and MintTo (in logs)
        const mintStr = mint.toBase58();
        const hasMint = txData.accounts.includes(mintStr);
        const isMintTo = txData.logs.some(log => log.includes('MintTo'));

        if (hasMint && isMintTo) {
            txFired = true;

            console.log('\n🔥 MINT DETECTED! FIRING PRE-BUILT TRANSACTION...\n');

            const startTime = Date.now();

            // Get fresh blockhash from Yellowstone
            const cachedBlockhash = yellowstone.getLatestBlockhash();
            if (cachedBlockhash) {
                createPoolTx.recentBlockhash = cachedBlockhash.blockhash;
                console.log(`⚡ Using cached blockhash (age: ${yellowstone.getBlockhashAge()}ms)`);
            } else {
                const { blockhash } = await connection.getLatestBlockhash();
                createPoolTx.recentBlockhash = blockhash;
            }

            createPoolTx.partialSign(wallet, positionNft);

            const signature = await connection.sendRawTransaction(createPoolTx.serialize(), {
                skipPreflight: true,
                maxRetries: 0,
            });

            const executionTime = Date.now() - startTime;

            console.log(`🔥 FIRED in ${executionTime}ms!`);
            console.log(`📡 Signature: ${signature}`);
            console.log(`🔗 https://solscan.io/tx/${signature}\n`);

            console.log('✅ Test complete! Shutting down...');
            await yellowstone.stopStreaming();
            process.exit(0);
        }
    });

    console.log('✅ Yellowstone listening for mint events...\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ⏳ WAITING...                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('💡 Now run in another terminal:');
    console.log(`   npm run test:trigger\n`);
    console.log('⏸️  Press Ctrl+C to cancel\n');

    // Keep running
    await new Promise(() => { });
}

function loadWallet(): Keypair {
    if (config.walletPrivateKey) {
        return Keypair.fromSecretKey(bs58.decode(config.walletPrivateKey));
    }
    if (config.keypairPath) {
        const secretKey = JSON.parse(fs.readFileSync(config.keypairPath, 'utf-8'));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }
    throw new Error('No wallet!');
}

main().catch(console.error);

