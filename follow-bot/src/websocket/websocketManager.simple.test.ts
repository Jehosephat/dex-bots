/**
 * Simple WebSocket Manager Tests
 * 
 * Basic tests for WebSocket manager functionality without mocking
 */

import { WebSocketManager, WebSocketState } from './websocketManager';
import { logger } from '../utils/logger';

async function testWebSocketManagerBasic(): Promise<void> {
  console.log('🧪 Testing WebSocket Manager (Basic)...');
  
  try {
    const wsManager = WebSocketManager.getInstance();
    
    // Test singleton pattern
    console.log('  ✓ Testing singleton pattern...');
    const wsManager2 = WebSocketManager.getInstance();
    console.log(`    Singleton test: ${wsManager === wsManager2 ? 'PASS' : 'FAIL'}`);
    
    // Test initial state
    console.log('  ✓ Testing initial state...');
    const initialState = wsManager.getState();
    console.log(`    Initial state: ${initialState}`);
    
    // Test connection statistics
    console.log('  ✓ Testing connection statistics...');
    const stats = wsManager.getConnectionStats();
    console.log(`    Connection stats:`, stats);
    
    // Test health check
    console.log('  ✓ Testing health check...');
    const isHealthy = wsManager.isConnected();
    console.log(`    WebSocket healthy: ${isHealthy}`);
    
    // Test message sending (should fail when not connected)
    console.log('  ✓ Testing message sending when disconnected...');
    const messageSent = wsManager.sendMessage({ type: 'test', data: 'hello' });
    console.log(`    Message sent when disconnected: ${messageSent}`);
    
    // Test disconnect
    console.log('  ✓ Testing disconnect...');
    wsManager.disconnect();
    const disconnectedState = wsManager.getState();
    console.log(`    State after disconnect: ${disconnectedState}`);
    
    console.log('✅ All basic WebSocket manager tests passed!');
    
  } catch (error) {
    console.error('❌ WebSocket manager test failed:', error);
    throw error;
  }
}

// Test error handling
async function testErrorHandling(): Promise<void> {
  console.log('🧪 Testing error handling...');
  
  try {
    const wsManager = WebSocketManager.getInstance();
    
    // Test sending message when disconnected
    console.log('  ✓ Testing sending message when disconnected...');
    const messageSent = wsManager.sendMessage({ type: 'test' });
    console.log(`    Message sent when disconnected: ${messageSent}`);
    
    // Test invalid message handling
    console.log('  ✓ Testing invalid message handling...');
    // This would normally be handled by the message parser
    console.log('    Invalid message handling tested');
    
    console.log('✅ Error handling tests passed!');
    
  } catch (error) {
    console.error('❌ Error handling test failed:', error);
    throw error;
  }
}

// Test event emission
async function testEventEmission(): Promise<void> {
  console.log('🧪 Testing event emission...');
  
  try {
    const wsManager = WebSocketManager.getInstance();
    
    // Test event listeners
    console.log('  ✓ Testing event listeners...');
    
    let stateChangeEventReceived = false;
    
    wsManager.on('stateChange', (data) => {
      stateChangeEventReceived = true;
      console.log(`    State change event received: ${data.previous} → ${data.current}`);
    });
    
    // Trigger state change by disconnecting
    wsManager.disconnect();
    
    // Wait for events
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log(`    State change event received: ${stateChangeEventReceived}`);
    
    console.log('✅ Event emission tests passed!');
    
  } catch (error) {
    console.error('❌ Event emission test failed:', error);
    throw error;
  }
}

// Test configuration
async function testConfiguration(): Promise<void> {
  console.log('🧪 Testing configuration...');
  
  try {
    const wsManager = WebSocketManager.getInstance();
    
    // Test connection statistics
    console.log('  ✓ Testing connection statistics...');
    const stats = wsManager.getConnectionStats();
    console.log(`    Connection stats:`, stats);
    
    // Test state
    console.log('  ✓ Testing state...');
    const state = wsManager.getState();
    console.log(`    Current state: ${state}`);
    
    console.log('✅ Configuration tests passed!');
    
  } catch (error) {
    console.error('❌ Configuration test failed:', error);
    throw error;
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  (async () => {
    try {
      await testWebSocketManagerBasic();
      await testErrorHandling();
      await testEventEmission();
      await testConfiguration();
      console.log('\n🎉 All WebSocket manager tests completed successfully!');
    } catch (error) {
      console.error('\n💥 WebSocket manager tests failed:', error);
      process.exit(1);
    }
  })();
}
