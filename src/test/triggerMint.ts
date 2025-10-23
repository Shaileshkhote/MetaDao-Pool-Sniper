import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { mintTo, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';
import { config } from '../config/config.js';

/**
 * Trigger Minting Event
 * Mints tokens to trigger the Yellowstone listener in testInstantFire.ts
 */

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              🔔 TRIGGER MINT EVENT 🔔                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Load mint address from testInstantFire
    if (!fs.existsSync('/tmp/test_mint.txt')) {
        console.error('❌ No mint found!');
        console.log('   Run npm run test:fire first\n');
        process.exit(1);
    }

    const mintAddress = fs.readFileSync('/tmp/test_mint.txt', 'utf-8').trim();
    const mint = new PublicKey(mintAddress);

    const connection = new Connection(config.rpcUrl, 'confirmed');
    const wallet = loadWallet();

    console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`🪙 Mint: ${mint.toBase58()}\n`);

    // Get or create token account
    console.log('📝 Getting token account...');
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        mint,
        wallet.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
    );

    console.log(`✅ Token Account: ${tokenAccount.address.toBase58()}\n`);

    // Mint tokens
    const mintAmount = BigInt(1000000000); // 1000 tokens

    console.log('🔥 MINTING TOKENS (this will trigger instant fire!)...\n');

    const signature = await mintTo(
        connection,
        wallet,
        mint,
        tokenAccount.address,
        wallet,
        mintAmount,
        [],
        undefined,
        TOKEN_PROGRAM_ID
    );

    console.log(`✅ Minted!`);
    console.log(`📡 Signature: ${signature}`);
    console.log(`🔗 https://solscan.io/tx/${signature}\n`);

    console.log('💡 Check the other terminal - pool should be created instantly!\n');
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

