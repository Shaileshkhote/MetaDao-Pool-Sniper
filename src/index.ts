import { getConnection, getWallet, getWalletBalance } from './services/connection.js';
import { validateConfig, config } from './config/config.js';
import { startAutoPool } from './automation/autoPool.js';

function printBanner(): void {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║         MetaDAO Pool Sniper                           ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
}

function printHelp(): void {
    console.log('Usage: npm start [command]\n');
    console.log('Commands:');
    console.log('  info       Show wallet and configuration');
    console.log('  help       Show this help message\n');
    console.log('Default: Starts pool sniper bot\n');
}

async function showInfo(): Promise<void> {
    console.log('📊 Configuration:\n');
    console.log(`RPC: ${config.rpcUrl}`);
    console.log(`Launchpad: ${config.launchpadProgramId.toBase58()}`);
    console.log(`DAMM v2: ${config.dammV2ProgramId.toBase58()}\n`);

    try {
        const connection = getConnection();
        const wallet = getWallet();
        const balance = await getWalletBalance(connection, wallet);

        console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
        console.log(`Balance: ${balance.toFixed(4)} SOL`);
        console.log(`Slot: ${await connection.getSlot()}\n`);
    } catch (error) {
        console.error('❌', (error as Error).message);
    }
}

async function main(): Promise<void> {
    printBanner();

    const command = process.argv[2];

    if (command === 'help') {
        printHelp();
        return;
    }

    if (!validateConfig()) {
        console.error('❌ Configuration error. Set up your .env file.\n');
        process.exit(1);
    }

    try {
        if (command === 'info') {
            await showInfo();
        } else {
            await startAutoPool();
        }
    } catch (error) {
        console.error('\n❌', (error as Error).message);
        process.exit(1);
    }
}

process.on('unhandledRejection', (error: Error) => {
    console.error('\n❌ Unhandled rejection:', error.message);
    process.exit(1);
});

main();
