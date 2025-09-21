import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

// Simple trade test - just execute a BUY trade
async function testTrade() {
  console.log("🧪 Simple Trade Test");
  console.log("===================");
  
  // Your configuration (hardcoded for simplicity)
  const privateKey = "0xd1d15f1aeeb9a918479d1097a2c04b88c9b890419bf31ca837eec26636ae31df";
  const walletAddress = "eth|D1499B10A0e1F4912FD1d771b183DfDfBDF766DC";
  const buyAmount = 1; // 1 GUSDC
  const slippageTolerance = 0.05; // 5%
  
  console.log(`💰 Spending: ${buyAmount} GUSDC`);
  console.log(`🎯 Wallet: ${walletAddress}`);
  console.log(`🛡️ Slippage: ${slippageTolerance * 100}%`);
  console.log("");
  
  try {
    // Initialize GSwap
    console.log("🔄 Initializing GSwap SDK...");
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({ signer });
    
    // Token formats
    const gusdcToken = "GUSDC|Unit|none|none";
    const galaToken = "GALA|Unit|none|none";
    
    // Get quote
    console.log("📊 Getting quote...");
    const quote = await gSwap.quoting.quoteExactInput(
      gusdcToken,
      galaToken,
      buyAmount
    );
    
    console.log(`💰 Expected GALA: ${quote.outTokenAmount.toNumber().toFixed(6)}`);
    console.log(`📊 Fee tier: ${quote.feeTier}`);
    
    // Calculate minimum output with slippage
    const amountOutMinimum = quote.outTokenAmount.multipliedBy(1 - slippageTolerance);
    console.log(`🛡️ Min output: ${amountOutMinimum.toNumber().toFixed(6)} GALA`);
    console.log("");
    
    // Execute trade
    console.log("🚀 Executing trade...");
    const result = await gSwap.swaps.swap(
      gusdcToken,
      galaToken,
      quote.feeTier,
      {
        exactIn: buyAmount,
        amountOutMinimum: amountOutMinimum
      },
      walletAddress
    );
    
    console.log("");
    console.log("✅ Trade successful!");
    console.log(`🔗 Transaction: ${result.transactionId}`);
    console.log(`💰 Spent: ${buyAmount} GUSDC`);
    console.log(`💰 Received: ~${quote.outTokenAmount.toNumber().toFixed(6)} GALA`);
    
  } catch (error) {
    console.error("❌ Trade failed:", error.message);
  }
}

// Run the test
testTrade();
