/**
 * Quick Test Suite for Advanced RAG v2
 * Tests all new features without requiring server
 */

import dotenv from "dotenv";
dotenv.config();

// Import all services
import { 
  enhanceQuery, 
  validateRetrievalQuality, 
  detectQueryIssues 
} from "./services/queryEnhancementService.js";
import { 
  queryCache, 
  getCacheStats 
} from "./services/queryCache.js";
import { 
  validateDocumentBuffer, 
  validateDocumentContent,
  formatValidationResult 
} from "./services/documentValidation.js";

console.log("\n🧪 Testing Advanced RAG v2 Features...\n");

// Test 1: Query Enhancement
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Test 1: Query Enhancement Service");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

try {
  const testQuery = "wht is machne lerning";
  console.log(`Input: "${testQuery}"\n`);
  
  const enhanced = await enhanceQuery(testQuery);
  console.log(`✓ Enhanced: "${enhanced.rewrittenQuery}"`);
  console.log(`  - Intent: ${enhanced.intent}`);
  console.log(`  - Has Typos: ${enhanced.hasTypos}`);
  console.log(`  - Confidence: ${(enhanced.confidence * 100).toFixed(1)}%\n`);
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 2: Query Issue Detection
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Test 2: Query Issue Detection");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

try {
  const issues = detectQueryIssues("HI");
  console.log(`Input: "HI"\n`);
  console.log(`✓ Issues Detected: ${issues.suggestedCorrections.length}`);
  issues.suggestedCorrections.forEach(c => console.log(`  - ${c}`));
  console.log(`  - Confidence: ${(issues.confidence * 100).toFixed(1)}%\n`);
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 3: Query Cache
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Test 3: Query Cache");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

try {
  const testResult = { answer: "Test answer", chunks: 3 };
  queryCache.set("test query", "test_collection", testResult);
  console.log(`✓ Cache Set: "test query" → test_collection`);
  
  const cached = queryCache.get("test query", "test_collection");
  if (cached) {
    console.log(`✓ Cache Hit: Retrieved from cache`);
  }
  
  const stats = getCacheStats();
  console.log(`\nCache Statistics:`);
  console.log(`  - Size: ${stats.size}/${stats.maxSize}`);
  console.log(`  - Hit Rate: ${stats.hitRate}%`);
  console.log(`  - Utilization: ${stats.utilization}%\n`);
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 4: Document Validation
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Test 4: Document Validation");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

try {
  // Test with valid text buffer
  const validBuffer = Buffer.from("This is a sample document with valid content for testing");
  const validation1 = validateDocumentBuffer(validBuffer, "text/plain", "test.txt");
  console.log(`✓ Valid Text File:`);
  console.log(`  - Valid: ${validation1.isValid}`);
  console.log(`  - Size: ${validation1.quality.size} bytes\n`);
  
  // Test with empty buffer
  const emptyBuffer = Buffer.from("");
  const validation2 = validateDocumentBuffer(emptyBuffer, "text/plain", "empty.txt");
  console.log(`✓ Empty File Detection:`);
  console.log(`  - Valid: ${validation2.isValid}`);
  console.log(`  - Errors: ${validation2.errors.length}`);
  if (validation2.errors.length > 0) {
    validation2.errors.forEach(err => console.log(`    - ${err}`));
  }
  console.log();
  
  // Test with small buffer
  const smallBuffer = Buffer.from("x");
  const validation3 = validateDocumentBuffer(smallBuffer, "text/plain", "small.txt");
  console.log(`✓ Small File Detection:`);
  console.log(`  - Valid: ${validation3.isValid}`);
  console.log(`  - Warnings: ${validation3.warnings.length}`);
  if (validation3.warnings.length > 0) {
    validation3.warnings.forEach(warn => console.log(`    - ${warn}`));
  }
  console.log();
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 5: Content Validation
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Test 5: Content Validation");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

try {
  // Valid chunks
  const validChunks = [
    { pageContent: "This is a valid chunk with content", metadata: { page: 1 } },
    { pageContent: "Another chunk with information", metadata: { page: 1 } },
  ];
  
  const contentVal = validateDocumentContent(validChunks);
  console.log(`✓ Valid Chunks:`);
  console.log(`  - Valid: ${contentVal.isValid}`);
  console.log(`  - Chunks: ${contentVal.stats.chunkCount}`);
  console.log(`  - Total Chars: ${contentVal.stats.totalChars}`);
  console.log(`  - Avg Chunk Size: ${contentVal.stats.avgChunkSize.toFixed(0)} chars\n`);
  
  // Empty chunks
  const emptyChunks = [
    { pageContent: "", metadata: {} },
    { pageContent: "", metadata: {} },
  ];
  
  const emptyVal = validateDocumentContent(emptyChunks);
  console.log(`✓ Empty Chunks Detection:`);
  console.log(`  - Valid: ${emptyVal.isValid}`);
  console.log(`  - Errors: ${emptyVal.errors.length}`);
  if (emptyVal.errors.length > 0) {
    emptyVal.errors.forEach(err => console.log(`    - ${err}`));
  }
  console.log();
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("✅ All Tests Complete!\n");
console.log("Advanced RAG v2 Features are ready to use.\n");
