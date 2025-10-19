import { getConnection, getWallet, getWalletBalance } from './services/connection.js';
import { validateConfig, config } from './config/config.js';
import { streamMetaDAOTransactions } from './services/streamTransactions.js';
import { startAutoLoyalPool } from './automation/autoLoyalPool.js';

/**
 * MetaDAO Geyser & DAMM Position Manager
 * Main entry point for the application
 */

function printBanner(): void {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║       MetaDAO Loyal Pool Automation Bot              ║');
    console.log('║       Auto-Claim & Create Pool on Launch             ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
}

function printHelp(): void {
    console.log('Usage: npm start [command] [options]\n');
    console.log('Commands:');
    console.log('  stream              Stream MetaDAO transactions (default)');
    console.log('  info                Show wallet and configuration info');
    console.log('  automate            Auto-claim Loyal & create pool on completeLaunch');
    console.log('    --check           Check claim status and launch state');
    console.log('    --simulate        Simulate claim and pool creation');
    console.log('  help                Show this help message\n');
    console.log('Examples:');
    console.log('  npm start stream');
    console.log('  npm start automate              # Monitor and auto-execute');
    console.log('  npm start automate --check      # Check status');
    console.log('  npm start automate --simulate   # Test without executing\n');
}

async function showInfo(): Promise<void> {
    console.log('📊 Configuration Information:\n');

    console.log('Network:');
    console.log(`  RPC: ${config.rpcUrl}`);
    console.log(`  WebSocket: ${config.wsUrl}\n`);

    console.log('Program IDs:');
    console.log(`  MetaDAO: ${config.metaDAOProgramId.toBase58()}`);
    console.log(`  Launchpad: ${config.launchpadProgramId.toBase58()}`);
    console.log(`  DAMM v2: ${config.dammV2ProgramId.toBase58()}\n`);

    try {
        const connection = getConnection();
        const wallet = getWallet();
        const balance = await getWalletBalance(connection, wallet);

        console.log('Wallet:');
        console.log(`  Address: ${wallet.publicKey.toBase58()}`);
        console.log(`  Balance: ${balance.toFixed(4)} SOL\n`);

        // Get slot info
        const slot = await connection.getSlot();
        console.log('Network Status:');
        console.log(`  Current Slot: ${slot}`);
        console.log(`  Connected: ✅\n`);
    } catch (error) {
        console.error('❌ Error getting wallet info:', (error as Error).message);
    }
}

async function main(): Promise<void> {
    printBanner();

    // Parse command line arguments
    const args = process.argv.slice(2);
    const command = args[0] || 'stream';

    // Validate configuration for commands that need it
    if (command !== 'help' && !validateConfig()) {
        console.error('❌ Configuration error. Please set up your .env file.');
        console.log('Copy env.example to .env and fill in your details.\n');
        process.exit(1);
    }

    try {
        switch (command) {
            case 'stream':
                await streamMetaDAOTransactions();
                break;

            case 'info':
                await showInfo();
                break;

            case 'automate': {
                // Determine mode based on flags
                let mode: 'monitor' | 'simulate' | 'check' = 'monitor';
                if (args.includes('--simulate')) {
                    mode = 'simulate';
                } else if (args.includes('--check')) {
                    mode = 'check';
                }
                await startAutoLoyalPool(mode);
                break;
            }

            case 'help':
                printHelp();
                break;

            default:
                console.log(`❌ Unknown command: ${command}\n`);
                printHelp();
                process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ Error:', (error as Error).message);
        if ((error as any).stack) {
            console.error('\nStack trace:', (error as any).stack);
        }
        process.exit(1);
    }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error: Error) => {
    console.error('\n❌ Unhandled promise rejection:', error);
    process.exit(1);
});

// Run the main function
main();

