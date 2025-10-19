# MetaDAO Loyal Pool Automation

```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║                    ⚠️  WARNING: UNTESTED - USE WITH CAUTION ⚠️             ║
║                                                                            ║
║  This code is untested and may contain bugs. Use at your own risk.        ║
║  Always test with small amounts first and simulate before running live.   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

Automated system to monitor MetaDAO launchpad for `completeLaunch` events and automatically claim Loyal tokens + create a Loyal/SOL DAMM v2 pool with custom fee scheduling.

## 🎯 Overview

This project provides:
1. **Geyser Transaction Streaming**: Monitor Solana transactions in real-time
2. **completeLaunch Detection**: Automatically detect when MetaDAO admin completes a token launch
3. **Token Claiming**: Automatically claim your Loyal tokens from the launchpad
4. **Pool Creation**: Create a Loyal/SOL liquidity pool on Meteora DAMM v2
5. **Custom Fee Scheduler**: 50% initial fee decaying to 1% over time (1% per minute)

## 📁 Project Structure

```
metadao/
├── src/
│   ├── automation/          # Loyal pool automation logic
│   │   ├── loyalPoolCreator.ts    # Core claim & pool creation
│   │   └── autoLoyalPool.ts       # Orchestrator/monitor
│   ├── services/            # Solana connection & geyser streaming
│   │   ├── connection.ts          # RPC connection management
│   │   ├── geyserClient.ts        # Transaction streaming
│   │   └── streamTransactions.ts  # MetaDAO tx monitor
│   ├── config/              # Configuration
│   │   └── config.ts              # Environment config
│   ├── idl/                 # Anchor IDLs
│   │   ├── launchpad.json         # MetaDAO launchpad IDL
│   │   └── damm.json              # Meteora DAMM v2 IDL
│   └── index.ts             # Main entry point
├── env.example              # Example environment configuration
├── package.json
├── tsconfig.json
└── README.md
```

## 🚀 Quick Start

### 1. Installation

```bash
# Clone the repository
cd metadao

# Install dependencies
npm install

# Install TypeScript globally (if needed)
npm install -g typescript tsx
```

### 2. Configuration

Copy the example environment file and configure it:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# Solana RPC (use a fast RPC for production)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com

# Wallet Configuration
KEYPAIR_PATH=./keypair.json

# Loyal Launch Configuration
LOYAL_LAUNCH_PUBKEY=your_loyal_launch_pubkey_here

# Pool Creation Amounts
LOYAL_AMOUNT=1000000000    # 1000 Loyal (6 decimals)
SOL_AMOUNT=100000000       # 0.1 SOL

# Fee Scheduler (50% → 1% decay)
INITIAL_FEE_BPS=5000       # 50%
MIN_FEE_BPS=100            # 1%
DECAY_PER_MINUTE=100       # 1% per minute

# Collect fees in SOL only
COLLECT_FEE_MODE=2         # 0=both, 1=token A, 2=token B (SOL)

# Compute Budget
COMPUTE_UNIT_PRICE=200000
```

### 3. Setup Keypair

Create or copy your wallet keypair to the project:

```bash
# Option 1: Create new keypair
solana-keygen new -o keypair.json

# Option 2: Copy existing keypair
cp ~/.config/solana/id.json ./keypair.json
```

**⚠️ Important**: Make sure your wallet:
- Has participated in the Loyal launch (has a funding record)
- Has enough SOL for transactions (~0.5 SOL recommended)
- Has the required tokens for pool creation

## 📋 Commands

### Automate Loyal Pool Creation

**Monitor and Auto-Execute** (Main command):
```bash
npm run automate
```

This will:
1. Monitor MetaDAO launchpad for `completeLaunch` transaction
2. When detected, automatically:
   - Claim your Loyal tokens
   - Create Loyal/SOL DAMM v2 pool
   - Set up 50%→1% fee decay schedule

**Check Status**:
```bash
npm run automate:check
```
Checks your funding record and launch state without executing.

**Simulate** (Dry run):
```bash
npm run automate:simulate
```
Simulates the full transaction without sending it on-chain.

### Other Commands

**Stream MetaDAO Transactions**:
```bash
npm start stream
```

**Show Wallet Info**:
```bash
npm start info
```

## 🔧 How It Works

### 1. Transaction Monitoring

The system uses WebSocket subscriptions (via `GeyserClient`) to monitor all transactions mentioning the MetaDAO launchpad program:

```typescript
// Subscribes to program logs
await geyserClient.subscribeToLogs(
    launchpadProgramId,
    (logData) => handleTransaction(logData)
);
```

### 2. completeLaunch Detection

When a transaction is detected, the parser checks logs for `completeLaunch` instruction:

```typescript
function isCompleteLaunchTransaction(logs: string[]): boolean {
    return logs.some(log => 
        log.includes('Instruction: CompleteLaunch') ||
        log.includes('complete_launch')
    );
}
```

### 3. Atomic Claim + Pool Creation

Once `completeLaunch` is detected, the system builds a single transaction containing:

1. **Create ATAs** (if needed)
   - Loyal token account
   - Wrapped SOL account

2. **Claim Instruction**
   - Claims tokens from launchpad
   - Transfers to your token account

3. **Create Pool Instruction**
   - Initializes DAMM v2 customizable pool
   - Deposits Loyal + SOL
   - Sets up fee scheduler
   - Creates your liquidity position

### 4. Fee Scheduler

The pool uses a time-based fee scheduler:

```
Initial Fee: 50% (5000 bps)
Minimum Fee: 1% (100 bps)
Decay Rate: 1% per minute (100 bps/min)
Time to Min: ~49 minutes
```

This creates high initial fees for snipers while gradually becoming more accessible for regular traders.

## 📊 Pool Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Token A | Loyal | Base token from launch |
| Token B | SOL | Quote token (wrapped) |
| Initial Fee | 50% | High sniper protection |
| Min Fee | 1% | Final steady-state fee |
| Decay | 1%/min | Linear decrease |
| Fee Collection | SOL only | Mode 2 - quote token |
| Activation | Immediate | Slot-based activation |

## 🔍 Monitoring Output

When running the automation, you'll see:

```
╔════════════════════════════════════════════════════════════╗
║     Auto Loyal Pool Creator - Monitoring Active          ║
╚════════════════════════════════════════════════════════════╝

🎯 Target Launch: AbC123...
👛 Wallet: XyZ789...

⏳ Waiting for completeLaunch transaction...
   The bot will automatically:
   1. Detect completeLaunch event
   2. Claim your Loyal tokens
   3. Create Loyal/SOL pool with 50%→1% fee decay

✅ Monitoring active! Press Ctrl+C to stop.
```

When `completeLaunch` is detected:

```
╔════════════════════════════════════════════════════════════╗
║              🎉 COMPLETE LAUNCH DETECTED! 🎉              ║
╚════════════════════════════════════════════════════════════╝

🔗 Transaction: 2aB3cD...
⏰ Slot: 250123456
📅 Time: 2025-10-19T...

⚡ Executing claim + pool creation...
⏳ Waiting 5 seconds for on-chain state to settle...

📊 Fetching Loyal launch data...
🔍 Checking claim eligibility...
💰 Your Funding Record:
  Committed: 1000000000
  Claimed: No
✅ Eligible to claim!

🔨 Building claim instruction...
🔨 Building pool creation instruction...
⚙️  Fee Scheduler Configuration:
  Initial Fee: 50%
  Min Fee: 1%
  Decay Rate: 1% per minute
  Will reach 1% after ~49 minutes

📦 Building single transaction...
🚀 Sending transaction...

╔════════════════════════════════════════════════════════════╗
║                    ✅ SUCCESS!                             ║
╚════════════════════════════════════════════════════════════╝

🔗 TX: 5xYz789...
🔍 Explorer: https://solscan.io/tx/5xYz789...

💎 Pool (Loyal/SOL): PoOl123...
📍 Your Position: PoS456...
🪙 Loyal Tokens: ToK789...

🌊 Meteora: https://app.meteora.ag/pools/PoOl123...
```

## ⚠️ Important Notes

### Before Running

1. **Test First**: Always run `--simulate` before live execution
2. **Check Balance**: Ensure you have enough SOL (~0.5 SOL minimum)
3. **Verify Participation**: Confirm you have a funding record with `--check`
4. **Fast RPC**: Use a premium RPC for production (Triton, Helius, etc.)
5. **IDL Files**: Ensure `launchpad.json` and `damm.json` are properly populated

### Timing

- The bot adds a 5-second delay after detecting `completeLaunch` to allow on-chain state to settle
- You can adjust this in `autoLoyalPool.ts` if needed
- Network congestion may require manual retry

### Security

- **Never commit** your `.env` file or `keypair.json`
- Use a dedicated wallet for automation
- Monitor the transaction carefully before approval
- Keep private keys secure

### Failure Handling

If the transaction fails:
- Check the error logs
- Verify your funding record hasn't already been claimed
- Ensure you have enough SOL for transaction fees
- Try manually with the simulate command first

## 🧪 Testing

### 1. Check Configuration
```bash
npm start info
```

### 2. Check Claim Status
```bash
npm run automate:check
```

### 3. Simulate Transaction
```bash
npm run automate:simulate
```

### 4. Monitor (Dry Run - Cancel Before Execution)
```bash
npm run automate
# Press Ctrl+C when you see the detection
```

## 🐛 Troubleshooting

### "Account does not exist" error
- You haven't participated in the Loyal launch
- Wrong `LOYAL_LAUNCH_PUBKEY` in config

### "Tokens already claimed" error
- You've already claimed your tokens
- Check your wallet's token accounts

### Transaction simulation fails
- IDL files may be incorrect or missing
- Program IDs might be wrong
- Check compute budget settings

### Pool creation fails
- Insufficient SOL balance
- Pool might already exist for this token pair
- Check DAMM v2 program ID and pool authority

### No completeLaunch detected
- Wrong launchpad program ID
- Launch hasn't been completed yet
- RPC connection issues

## 📝 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_RPC_URL` | No | Mainnet | Solana RPC endpoint |
| `SOLANA_WS_URL` | No | Mainnet | WebSocket endpoint |
| `KEYPAIR_PATH` | Yes | - | Path to wallet keypair |
| `LOYAL_LAUNCH_PUBKEY` | Yes | - | Target launch address |
| `LOYAL_AMOUNT` | No | 1000000000 | Loyal to deposit (base units) |
| `SOL_AMOUNT` | No | 100000000 | SOL to deposit (lamports) |
| `INITIAL_FEE_BPS` | No | 5000 | Initial fee (50%) |
| `MIN_FEE_BPS` | No | 100 | Minimum fee (1%) |
| `DECAY_PER_MINUTE` | No | 100 | Decay rate (1%/min) |
| `COLLECT_FEE_MODE` | No | 2 | Fee collection mode |
| `COMPUTE_UNIT_PRICE` | No | 200000 | Priority fee |
| `LAUNCHPAD_PROGRAM_ID` | No | LPDk... | Launchpad program |
| `DAMM_V2_PROGRAM_ID` | No | cpam... | DAMM v2 program |
| `DAMM_POOL_AUTHORITY` | No | HLnp... | Pool authority |

## 🔗 Links

- [MetaDAO](https://metadao.fi/)
- [Meteora DAMM v2](https://app.meteora.ag/)
- [Solana Documentation](https://docs.solana.com/)
- [Anchor Framework](https://www.anchor-lang.com/)

## 📜 License

MIT

---

For questions or issues, contact the development team.
# MetaDao-Pool-Sniper
