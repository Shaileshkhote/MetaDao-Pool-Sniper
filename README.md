# MetaDAO Pool Sniper

Ultra-fast automated pool creation bot for any MetaDAO token launch. Monitors via Yellowstone gRPC, detects `completeLaunch`, and instantly fires a pre-built transaction to claim tokens and create a Meteora DAMM v2 pool.

## ⚡ Features

- **Yellowstone gRPC Streaming**: Real-time transaction monitoring with zero RPC latency
- **Pre-built Transactions**: Transactions built BEFORE completeLaunch for instant execution
- **Meteora SDK Integration**: Clean pool creation using official SDK
- **Cached Blockhashes**: gRPC-streamed blockhashes for sub-slot execution
- **Custom Fee Scheduler**: 50% → 1% decay over time
- **Pool Snipe Fallback**: Automatically adds liquidity if pool already exists

## 📁 Project Structure

```
metadao/
├── src/
│   ├── automation/
│   │   ├── poolCreator.ts         # Pool creation with Meteora SDK
│   │   └── autoPool.ts            # Main orchestrator
│   ├── services/
│   │   ├── yellowstoneGrpc.ts     # gRPC transaction streaming
│   │   ├── transactionParser.ts   # completeLaunch detection
│   │   ├── transactionExecutor.ts # Optimized TX sending
│   │   └── connection.ts          # RPC connection
│   ├── config/
│   │   └── config.ts              # Configuration
│   └── idl/
│       ├── launchpad.json         # MetaDAO launchpad IDL
│       └── damm.json              # Meteora DAMM v2 IDL
├── env.example
└── package.json
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp env.example .env
```

Edit `.env`:

```env
# Yellowstone gRPC (REQUIRED for streaming)
GEYSER_RPC_URL=grpc.triton.one:443
GEYSER_X_TOKEN=your_token_here

# Solana RPC (for fallback)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Wallet (use ONE of these)
WALLET_PRIVATE_KEY=your_base58_private_key  # Phantom/Solflare format
# OR
KEYPAIR_PATH=./keypair.json                 # Solana CLI format

# Target Launch
LAUNCH_PUBKEY=your_launch_pubkey_here
TOKEN_MINT=your_token_mint_here         # Optional: for instant fire

# Pool Amounts
TOKEN_AMOUNT=1000000000   # 1000 tokens (6 decimals)
SOL_AMOUNT=100000000      # 0.1 SOL

# Fee Scheduler (50% → 1%)
INITIAL_FEE_BPS=5000      # 50%
MIN_FEE_BPS=100           # 1%
DECAY_PER_MINUTE=100      # 1% per minute

# Priority Fee
COMPUTE_UNIT_PRICE=2000000  # 0.002 SOL
```

### 3. Run the Bot

```bash
npm run automate
```

## 🔧 How It Works

### 1. Initialization
- Connects to Yellowstone gRPC endpoint
- Subscribes to MetaDAO launchpad program transactions
- Pre-builds complete transaction (claim + pool creation)
- Caches blockhash from gRPC stream

### 2. Monitoring
- Receives transactions in real-time via gRPC
- Parses logs to detect `completeLaunch` instruction
- Instant detection (no RPC polling delay)

### 3. Execution
When `completeLaunch` is detected:
1. **Claim Tokens**: Uses pre-built claim transaction
2. **Check Pool**: Verifies if pool exists
3. **Create Pool** OR **Add Liquidity**: Executes appropriate action
4. Uses gRPC-cached blockhash for instant signing
5. Sends with `skipPreflight` for maximum speed

### 4. Pool Configuration
- **Token Pair**: Token/SOL (any MetaDAO launch token)
- **Initial Fee**: 50% (high sniper protection)
- **Min Fee**: 1% (final trading fee)
- **Decay**: 1% per minute (~49 minutes to minimum)
- **Fee Collection**: SOL only (quote token)

## 📊 Transaction Flow

```
gRPC Stream → Parse Logs → Detect completeLaunch
                                    ↓
                    Get Cached Blockhash (0ms)
                                    ↓
                    Sign Pre-built TX (~5ms)
                                    ↓
                    Send TX (~20-40ms)
                                    ↓
            Total: ~25-50ms (~0.06-0.12 slots)
```

## 🎯 Commands

### Start the Bot
```bash
npm start
# or
npm run automate
```

### Show Configuration
```bash
npm run info
```

### Development Mode (auto-reload)
```bash
npm run dev
```

## 🔑 Getting Yellowstone gRPC Access

You need a Yellowstone gRPC endpoint from:

### Triton One (Recommended)
```
GEYSER_RPC_URL=grpc.triton.one:443
GEYSER_X_TOKEN=your_triton_token
```
Get access at: https://triton.one

### Helius
```
GEYSER_RPC_URL=mainnet.helius-rpc.com
GEYSER_X_TOKEN=your_helius_api_key
```
Get access at: https://helius.dev

## ⚙️ Configuration Options

### Wallet Setup

**Option 1: Base58 Private Key (Recommended)**
```env
WALLET_PRIVATE_KEY=your_base58_key_from_phantom
```
Export from Phantom: Settings → Security & Privacy → Export Private Key

**Option 2: JSON Keypair**
```env
KEYPAIR_PATH=./keypair.json
```

### Pool Amounts

Amounts are in base units (smallest denomination):

```env
# For token with 6 decimals:
TOKEN_AMOUNT=1000000000  # = 1000 tokens

# SOL in lamports:
SOL_AMOUNT=100000000     # = 0.1 SOL
```

### Fee Scheduler

```env
INITIAL_FEE_BPS=5000      # 50% (5000 basis points)
MIN_FEE_BPS=100           # 1% (100 basis points)
DECAY_PER_MINUTE=100      # Decay rate

# Calculate time to min fee:
# (5000 - 100) / 100 = 49 minutes
```

### Fee Collection Modes

```env
COLLECT_FEE_MODE=0  # Both tokens
COLLECT_FEE_MODE=1  # Token A only (launch token)
COLLECT_FEE_MODE=2  # Token B only (SOL) - Recommended
```

## 📝 Output Example

```
🎯 Target: AbC123...
👛 Wallet: XyZ789...

✅ Transaction pre-built

🔍 Monitoring for completeLaunch...


🎯 DETECTED completeLaunch: 5xYz... (slot 375231881)
🔥 Executing...

✅ SUCCESS!
   TX: 5xYz789abc...
   Pool: PoOl123...
   Solscan: https://solscan.io/tx/5xYz789abc...
   Meteora: https://app.meteora.ag/pools/PoOl123...
```

## 🐛 Troubleshooting

### "GEYSER_RPC_URL required"
- Set a valid Yellowstone gRPC endpoint
- Don't use HTTP URLs (use gRPC endpoints like `grpc.triton.one:443`)

### "Tokens already claimed"
- You've already claimed from this launch
- Check your wallet token accounts

### "Pool already exists"
- Bot automatically switches to add liquidity mode
- Check the output for the liquidity addition transaction

### Empty logs/accounts
- Verify gRPC endpoint is streaming transaction details
- Check `GEYSER_X_TOKEN` is correct

### No transactions detected
- Verify `LAUNCHPAD_PROGRAM_ID` is correct
- Check gRPC connection is active
- Ensure launch hasn't already completed

## 🔒 Security

- **Never commit** `.env` or keypairs
- Use a dedicated wallet for automation
- Test with small amounts first
- Keep private keys secure
- Use hardware wallets for large amounts

## 📊 Performance

- **Detection Latency**: ~0ms (gRPC stream)
- **Blockhash Fetch**: ~0ms (cached from gRPC)
- **Transaction Build**: ~5-10ms (pre-built)
- **Network Send**: ~20-40ms
- **Total**: ~25-50ms (~0.06-0.12 slots)

## 🔗 Resources

- [MetaDAO](https://metadao.fi/)
- [Meteora](https://app.meteora.ag/)
- [Triton One](https://triton.one/)
- [Helius](https://helius.dev/)
- [Solana Docs](https://docs.solana.com/)

## ⚠️ Disclaimer

This software is provided as-is. Use at your own risk. Always test with small amounts first. No guarantees on execution speed or success.

## 📜 License

MIT

---

**Built with**:
- Yellowstone gRPC (Triton)
- Meteora CP-AMM SDK
- Solana Web3.js
- Anchor Framework
