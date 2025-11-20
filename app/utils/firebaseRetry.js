"use client";

/**
 * Retry wrapper for Firebase operations
 * Handles temporary network issues in captive portal environment
 * 
 * @param {Function} operation - The async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} delayMs - Delay between retries in milliseconds (default: 1000)
 * @returns {Promise} - Result of the operation or throws error after all retries
 */
export async function retryOperation(operation, maxRetries = 3, delayMs = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries}...`);
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ Attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        // Wait before retrying (exponential backoff)
        const waitTime = delayMs * attempt;
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  // All retries failed
  console.error(`❌ All ${maxRetries} attempts failed`);
  throw lastError;
}

/**
 * Wrapper for Firebase operations with timeout and retry
 * 
 * @param {Function} operation - The Firebase operation to execute
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @param {number} maxRetries - Maximum retries (default: 3)
 * @returns {Promise} - Result or throws error
 */
export async function withTimeoutAndRetry(operation, timeoutMs = 30000, maxRetries = 3) {
  return retryOperation(async () => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timeout")), timeoutMs)
    );
    
    return await Promise.race([
      operation(),
      timeoutPromise
    ]);
  }, maxRetries, 1000);
}

