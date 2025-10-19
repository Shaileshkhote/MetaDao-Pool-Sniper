import { getConnection } from './connection.js';
import { GeyserClient, parseMetaDAOTransaction, parseDAMMTransaction, LogData, ProgramAccountUpdateData } from './geyserClient.js';
import { config } from '../config/config.js';

/**
 * Stream MetaDAO transactions
 */
async function streamMetaDAOTransactions(): Promise<void> {
    console.log('🚀 Starting MetaDAO Transaction Stream...\n');

    const connection = getConnection();
    const geyserClient = new GeyserClient(connection);

    // Subscribe to MetaDAO program logs
    await geyserClient.subscribeToLogs(
        config.metaDAOProgramId,
        (logData: LogData) => {
            const parsed = parseMetaDAOTransaction(logData.logs);

            if (parsed.isMetaDAOTx) {
                console.log('📥 MetaDAO Transaction Detected:');
                console.log(`   Signature: ${logData.signature}`);
                console.log(`   Slot: ${logData.slot}`);
                console.log(`   Time: ${logData.timestamp}`);
                console.log(`   Status: ${logData.err ? '❌ Failed' : '✅ Success'}`);
                console.log(`   Logs: ${parsed.logs.length} relevant log(s)`);
                parsed.logs.forEach(log => console.log(`     - ${log}`));
                console.log('');
            }
        }
    );

    // Subscribe to DAMM v2 program logs
    await geyserClient.subscribeToLogs(
        config.dammV2ProgramId,
        (logData: LogData) => {
            const parsed = parseDAMMTransaction(logData.logs);

            if (parsed.isDAMMTx) {
                console.log('📥 DAMM v2 Transaction Detected:');
                console.log(`   Signature: ${logData.signature}`);
                console.log(`   Slot: ${logData.slot}`);
                console.log(`   Time: ${logData.timestamp}`);
                console.log(`   Status: ${logData.err ? '❌ Failed' : '✅ Success'}`);
                console.log(`   Logs: ${parsed.logs.length} relevant log(s)`);
                parsed.logs.forEach(log => console.log(`     - ${log}`));
                console.log('');
            }
        }
    );

    // Subscribe to program account changes
    await geyserClient.subscribeToProgramAccounts(
        config.metaDAOProgramId,
        (accountData: ProgramAccountUpdateData) => {
            console.log('🔄 MetaDAO Account Update:');
            console.log(`   Account: ${accountData.account}`);
            console.log(`   Slot: ${accountData.slot}`);
            console.log(`   Lamports: ${accountData.lamports}`);
            console.log(`   Time: ${accountData.timestamp}`);
            console.log('');
        }
    );

    console.log(`✅ Streaming active for:`);
    console.log(`   - MetaDAO Program: ${config.metaDAOProgramId.toBase58()}`);
    console.log(`   - DAMM v2 Program: ${config.dammV2ProgramId.toBase58()}`);
    console.log(`   - Active subscriptions: ${geyserClient.getActiveSubscriptionsCount()}`);
    console.log('\n⏳ Waiting for transactions... (Press Ctrl+C to stop)\n');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n\n🛑 Shutting down gracefully...');
        await geyserClient.unsubscribeAll();
        process.exit(0);
    });

    // Keep the process running
    await new Promise<void>(() => { });
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    streamMetaDAOTransactions().catch((error: Error) => {
        console.error('❌ Error streaming transactions:', error);
        process.exit(1);
    });
}

export { streamMetaDAOTransactions };

