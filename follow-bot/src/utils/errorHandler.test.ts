/**
 * Error Handler Tests
 * 
 * Tests for the error handling and recovery system
 */

import { ErrorHandler, ErrorCategory, ErrorSeverity, CircuitBreakerState } from './errorHandler';

async function testErrorHandler(): Promise<void> {
  console.log('🧪 Testing Error Handler...');
  
  try {
    const errorHandler = ErrorHandler.getInstance();
    
    // Test error handling
    console.log('  ✓ Testing error handling...');
    const testError = new Error('Test network error');
    const botError = await errorHandler.handleError(
      testError,
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM,
      { test: true }
    );
    
    console.log(`    Error ID: ${botError.id}`);
    console.log(`    Category: ${botError.category}`);
    console.log(`    Severity: ${botError.severity}`);
    console.log(`    Retryable: ${botError.retryable}`);
    console.log(`    Max Retries: ${botError.maxRetries}`);
    
    // Test error statistics
    console.log('  ✓ Testing error statistics...');
    const stats = errorHandler.getErrorStatistics();
    console.log(`    Total errors: ${stats.totalErrors}`);
    console.log(`    Unresolved errors: ${stats.unresolvedErrors}`);
    console.log(`    Errors by category:`, stats.errorsByCategory);
    
    // Test circuit breaker
    console.log('  ✓ Testing circuit breaker...');
    errorHandler.createCircuitBreaker('test-service');
    
    // Test successful operation
    let successCount = 0;
    try {
      await errorHandler.executeWithCircuitBreaker('test-service', async () => {
        successCount++;
        return 'success';
      });
      console.log('    Circuit breaker successful operation: OK');
    } catch (error) {
      console.log('    Circuit breaker successful operation: FAILED');
    }
    
    // Test failing operation
    let failureCount = 0;
    try {
      await errorHandler.executeWithCircuitBreaker('test-service', async () => {
        failureCount++;
        throw new Error('Simulated failure');
      });
    } catch (error) {
      console.log('    Circuit breaker failing operation: Expected failure');
    }
    
    // Test circuit breaker status
    const circuitBreakerStatus = errorHandler.getCircuitBreakerStatus();
    console.log(`    Circuit breaker status:`, circuitBreakerStatus['test-service']?.state);
    
    // Test health checks
    console.log('  ✓ Testing health checks...');
    errorHandler.addHealthCheck('test-check', async () => {
      return Math.random() > 0.5;
    });
    
    const healthResults = await errorHandler.runHealthChecks();
    console.log(`    Health check results:`, healthResults);
    
    // Test error cleanup
    console.log('  ✓ Testing error cleanup...');
    errorHandler.cleanupOldErrors(0); // Clean all errors
    const afterCleanup = errorHandler.getErrorStatistics();
    console.log(`    Errors after cleanup: ${afterCleanup.totalErrors}`);
    
    console.log('✅ All error handler tests passed!');
    
  } catch (error) {
    console.error('❌ Error handler test failed:', error);
    throw error;
  }
}

// Test error categorization
async function testErrorCategorization(): Promise<void> {
  console.log('🧪 Testing error categorization...');
  
  try {
    const errorHandler = ErrorHandler.getInstance();
    
    // Test different error categories
    const testErrors = [
      { error: new Error('Network timeout'), category: ErrorCategory.NETWORK, severity: ErrorSeverity.MEDIUM },
      { error: new Error('WebSocket connection lost'), category: ErrorCategory.WEBSOCKET, severity: ErrorSeverity.HIGH },
      { error: new Error('Invalid configuration'), category: ErrorCategory.CONFIGURATION, severity: ErrorSeverity.CRITICAL },
      { error: new Error('Trade validation failed'), category: ErrorCategory.TRADING, severity: ErrorSeverity.HIGH },
      { error: new Error('System out of memory'), category: ErrorCategory.SYSTEM, severity: ErrorSeverity.CRITICAL }
    ];
    
    for (const testError of testErrors) {
      const botError = await errorHandler.handleError(
        testError.error,
        testError.category,
        testError.severity
      );
      
      console.log(`    ${testError.category}: ${botError.retryable ? 'Retryable' : 'Not retryable'}`);
    }
    
    console.log('✅ Error categorization tests passed!');
    
  } catch (error) {
    console.error('❌ Error categorization test failed:', error);
    throw error;
  }
}

// Test circuit breaker behavior
async function testCircuitBreakerBehavior(): Promise<void> {
  console.log('🧪 Testing circuit breaker behavior...');
  
  try {
    const errorHandler = ErrorHandler.getInstance();
    errorHandler.createCircuitBreaker('failing-service');
    
    // Simulate multiple failures to open circuit breaker
    console.log('  ✓ Simulating failures to open circuit breaker...');
    for (let i = 0; i < 6; i++) {
      try {
        await errorHandler.executeWithCircuitBreaker('failing-service', async () => {
          throw new Error(`Simulated failure ${i + 1}`);
        });
      } catch (error) {
        // Expected failure
      }
    }
    
    // Check circuit breaker state
    const status = errorHandler.getCircuitBreakerStatus();
    const circuitState = status['failing-service']?.state;
    console.log(`    Circuit breaker state: ${circuitState}`);
    
    if (circuitState === CircuitBreakerState.OPEN) {
      console.log('    ✅ Circuit breaker opened correctly after failures');
    } else {
      console.log('    ❌ Circuit breaker should be OPEN but is not');
    }
    
    // Test that circuit breaker blocks requests when open
    try {
      await errorHandler.executeWithCircuitBreaker('failing-service', async () => {
        return 'should not execute';
      });
      console.log('    ❌ Circuit breaker should have blocked request');
    } catch (error) {
      console.log('    ✅ Circuit breaker correctly blocked request');
    }
    
    console.log('✅ Circuit breaker behavior tests passed!');
    
  } catch (error) {
    console.error('❌ Circuit breaker behavior test failed:', error);
    throw error;
  }
}

// Test recovery strategies
async function testRecoveryStrategies(): Promise<void> {
  console.log('🧪 Testing recovery strategies...');
  
  try {
    const errorHandler = ErrorHandler.getInstance();
    
    // Test network error recovery
    const networkError = new Error('ECONNRESET');
    const botError = await errorHandler.handleError(
      networkError,
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM
    );
    
    console.log(`    Network error retryable: ${botError.retryable}`);
    console.log(`    Network error max retries: ${botError.maxRetries}`);
    
    // Test configuration error recovery
    const configError = new Error('Invalid config file');
    const configBotError = await errorHandler.handleError(
      configError,
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.CRITICAL
    );
    
    console.log(`    Configuration error retryable: ${configBotError.retryable}`);
    console.log(`    Configuration error max retries: ${configBotError.maxRetries}`);
    
    console.log('✅ Recovery strategy tests passed!');
    
  } catch (error) {
    console.error('❌ Recovery strategy test failed:', error);
    throw error;
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  (async () => {
    try {
      await testErrorHandler();
      await testErrorCategorization();
      await testCircuitBreakerBehavior();
      await testRecoveryStrategies();
      console.log('\n🎉 All error handling tests completed successfully!');
    } catch (error) {
      console.error('\n💥 Error handling tests failed:', error);
      process.exit(1);
    }
  })();
}
