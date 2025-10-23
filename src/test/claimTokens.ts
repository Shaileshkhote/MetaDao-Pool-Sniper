import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import fs from 'fs';
import { config } from '../config/config.js';
import LAUNCHPAD_IDL from '../idl/launchpad.json' with { type: 'json' };

/**
 * Claim Tokens from MetaDAO Launch
 */

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║            💎 CLAIM METADAO TOKENS 💎                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const connection = new Connection(config.rpcUrl, 'confirmed');
    const wallet = loadWallet();

    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`💰 SOL: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}\n`);

    // Get launch pubkey from env or args
    const args = process.argv.slice(2);
    const launchPubkeyStr = args[0] || config.launchPubkey || process.env.LAUNCH_PUBKEY;

    if (!launchPubkeyStr) {
        console.error('❌ Launch pubkey required!');
        console.log('\nUsage: npm run test:claim -- <LAUNCH_PUBKEY>\n');
        console.log('Or set LAUNCH_PUBKEY in .env\n');
        process.exit(1);
    }

    const launchPubkey = new PublicKey(launchPubkeyStr);
    console.log(`🚀 Launch: ${launchPubkey.toBase58()}\n`);

    // Setup Anchor program
    const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: 'confirmed' });
    const launchpadProgram = new Program(LAUNCHPAD_IDL as any, config.launchpadProgramId, provider);

    // Fetch launch data
    console.log('📊 Fetching launch data...');
    const launch = await launchpadProgram.account.launch.fetch(launchPubkey);
    const baseMint = (launch as any).baseMint;
    const launchBaseVault = (launch as any).launchBaseVault;
    const state = Object.keys((launch as any).state)[0];

    console.log(`   State: ${state}`);
    console.log(`   Base Mint: ${baseMint.toBase58()}\n`);

    if (state !== 'complete' && state !== 'Complete') {
        console.error(`❌ Launch not complete! Current state: ${state}\n`);
        process.exit(1);
    }

    // Check funding record
    console.log('🔍 Checking your funding record...');
    const [fundingRecord] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('funding_record'),
            launchPubkey.toBuffer(),
            wallet.publicKey.toBuffer(),
        ],
        config.launchpadProgramId
    );

    const record = await launchpadProgram.account.fundingRecord.fetch(fundingRecord);
    const committedAmount = (record as any).committedAmount;
    const isTokensClaimed = (record as any).isTokensClaimed;

    console.log(`   Committed: ${committedAmount.toString()}`);
    console.log(`   Claimed: ${isTokensClaimed ? 'YES' : 'NO'}\n`);

    if (isTokensClaimed) {
        console.log('✅ Tokens already claimed!\n');
        process.exit(0);
    }

    // Build claim transaction
    console.log('🔨 Building claim transaction...\n');

    const [launchSigner] = PublicKey.findProgramAddressSync(
        [Buffer.from('launch_signer'), launchPubkey.toBuffer()],
        config.launchpadProgramId
    );

    const [eventAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('__event_authority')],
        config.launchpadProgramId
    );

    // Get or create token account
    const funderTokenAccount = await getAssociatedTokenAddress(
        baseMint,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
    );

    const accountInfo = await connection.getAccountInfo(funderTokenAccount);
    const transaction = new Transaction();

    if (!accountInfo) {
        console.log('📝 Creating token account...');
        transaction.add(
            createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                funderTokenAccount,
                wallet.publicKey,
                baseMint,
                TOKEN_PROGRAM_ID
            )
        );
    }

    const claimIx = await launchpadProgram.methods
        .claim()
        .accounts({
            launch: launchPubkey,
            fundingRecord,
            launchSigner,
            baseMint,
            launchBaseVault,
            funder: wallet.publicKey,
            funderTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            eventAuthority,
            program: config.launchpadProgramId,
        })
        .instruction();

    transaction.add(claimIx);

    console.log('🚀 Sending claim transaction...\n');

    const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet],
        { commitment: 'confirmed' }
    );

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                   ✅ CLAIMED!                              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`🔗 Transaction: ${signature}`);
    console.log(`🔍 https://solscan.io/tx/${signature}`);
    console.log(`💎 Token Account: ${funderTokenAccount.toBase58()}\n`);
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


