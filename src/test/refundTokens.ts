import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import fs from 'fs';
import { config } from '../config/config.js';
import LAUNCHPAD_IDL from '../idl/launchpad.json' with { type: 'json' };

/**
 * Refund from MetaDAO Launch
 */

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║            💸 REFUND METADAO TOKENS 💸                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const connection = new Connection(config.rpcUrl, 'confirmed');
    const wallet = loadWallet();

    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`💰 SOL: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}\n`);

    // Get launch pubkey
    const args = process.argv.slice(2);
    const launchPubkeyStr = args[0] || config.launchPubkey || process.env.LAUNCH_PUBKEY;

    if (!launchPubkeyStr) {
        console.error('❌ Launch pubkey required!');
        console.log('\nUsage: npm run test:refund -- <LAUNCH_PUBKEY>\n');
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
    const quoteMint = (launch as any).quoteMint;
    const launchQuoteVault = (launch as any).launchQuoteVault;
    const state = Object.keys((launch as any).state)[0];

    console.log(`   State: ${state}`);
    console.log(`   Quote Mint: ${quoteMint.toBase58()}\n`);

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

    try {
        const record = await launchpadProgram.account.fundingRecord.fetch(fundingRecord);
        const committedAmount = (record as any).committedAmount;
        const isRefunded = (record as any).isRefunded;

        console.log(`   Committed: ${committedAmount.toString()}`);
        console.log(`   Refunded: ${isRefunded ? 'YES' : 'NO'}\n`);

        if (isRefunded) {
            console.log('✅ Already refunded!\n');
            process.exit(0);
        }

        if (committedAmount.isZero()) {
            console.log('❌ No funds committed!\n');
            process.exit(1);
        }
    } catch (error: any) {
        if (error.message.includes('Account does not exist')) {
            console.error('❌ No funding record found!\n');
            process.exit(1);
        }
        throw error;
    }

    // Build refund transaction
    console.log('🔨 Building refund transaction...\n');

    const [launchSigner] = PublicKey.findProgramAddressSync(
        [Buffer.from('launch_signer'), launchPubkey.toBuffer()],
        config.launchpadProgramId
    );

    const [eventAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('__event_authority')],
        config.launchpadProgramId
    );

    const refundIx = await launchpadProgram.methods
        .refund()
        .accounts({
            launch: launchPubkey,
            fundingRecord,
            launchSigner,
            quoteMint,
            launchQuoteVault,
            funder: wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            eventAuthority,
            program: config.launchpadProgramId,
        })
        .instruction();

    const transaction = new Transaction();
    transaction.add(refundIx);

    console.log('🚀 Sending refund transaction...\n');

    const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet],
        { commitment: 'confirmed' }
    );

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                   ✅ REFUNDED!                             ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`🔗 Transaction: ${signature}`);
    console.log(`🔍 https://solscan.io/tx/${signature}\n`);
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

