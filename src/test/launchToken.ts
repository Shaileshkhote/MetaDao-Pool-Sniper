import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createMint, mintTo, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';
import { config } from '../config/config.js';

/**
 * Simple Test Token Creator
 */

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║               🪙 CREATE TEST TOKEN 🪙                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const args = process.argv.slice(2);
    const supply = args[0] || '1000000000000'; // Default: 1M tokens (6 decimals)

    const connection = new Connection(config.rpcUrl, 'confirmed');
    const wallet = loadWallet();

    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`💰 SOL: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}\n`);

    // Create token
    console.log('🪙 Creating token mint...');
    const mintKeypair = Keypair.generate();

    const mint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        wallet.publicKey,
        6, // 6 decimals
        mintKeypair,
        undefined,
        TOKEN_PROGRAM_ID
    );

    console.log(`✅ Mint: ${mint.toBase58()}\n`);

    // Mint tokens
    console.log('💰 Minting tokens to wallet...');
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        mint,
        wallet.publicKey
    );

    await mintTo(
        connection,
        wallet,
        mint,
        tokenAccount.address,
        wallet,
        BigInt(supply)
    );

    const displayAmount = Number(supply) / 1_000_000;
    console.log(`✅ Minted ${displayAmount.toLocaleString()} tokens\n`);

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ DONE!                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`📝 Token: ${mint.toBase58()}`);
    console.log(`💰 Balance: ${displayAmount.toLocaleString()}\n`);

    console.log('💡 Test pool creation:');
    console.log(`   npm run test:pool -- ${mint.toBase58()} ${supply}\n`);
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
