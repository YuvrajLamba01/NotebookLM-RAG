/**
 * Test suite for new RAG optimization features:
 * - Corrective RAG (reformulateQueryAggressively)
 * - HYDE (generateHypotheticalDocuments)
 * - Cross-Encoder Re-ranking (rerankChunksBySemantic)
 */

import {
  reformulateQueryAggressively,
  generateHypotheticalDocuments,
  rerankChunksBySemantic,
} from "./services/queryEnhancementService.js";

// Simple mock chunks for testing
const mockChunks = [
  {
    id: "chunk1",
    content: "Machine learning is a subset of artificial intelligence.",
    score: 0.85,
  },
  {
    id: "chunk2",
    content: "Deep learning uses neural networks with multiple layers.",
    score: 0.78,
  },
  {
    id: "chunk3",
    content: "Natural language processing helps computers understand text.",
    score: 0.72,
  },
  {
    id: "chunk4",
    content: "Computer vision enables machines to process visual information.",
    score: 0.65,
  },
  {
    id: "chunk5",
    content: "Supervised learning requires labeled training data.",
    score: 0.58,
  },
];

async function runTests() {
  console.log("\n=== Testing New RAG Features ===\n");

  // Test 1: Corrective RAG
  console.log("TEST 1: Corrective RAG (reformulateQueryAggressively)");
  console.log("-".repeat(50));
  try {
    const originalQuery = "wht is machin lerning";
    const enhancedQuery = "What is machine learning";
    
    console.log(`Original query: "${originalQuery}"`);
    console.log(`Enhanced query: "${enhancedQuery}"`);
    
    const reformulated = await reformulateQueryAggressively(
      originalQuery,
      enhancedQuery
    );
    
    console.log(`Reformulated: "${reformulated}"`);
    console.log("✓ Corrective RAG works\n");
  } catch (error) {
    console.error("✗ Corrective RAG error:", error.message, "\n");
  }

  // Test 2: HYDE
  console.log("TEST 2: HYDE (generateHypotheticalDocuments)");
  console.log("-".repeat(50));
  try {
    const query = "How does machine learning work?";
    console.log(`Query: "${query}"`);
    
    const hypothetical = await generateHypotheticalDocuments(query);
    
    console.log(`Generated ${hypothetical.length} query variations:`);
    hypothetical.forEach((h, i) => {
      console.log(`  ${i + 1}. [${h.type}] "${h.query}"`);
    });
    console.log("✓ HYDE works\n");
  } catch (error) {
    console.error("✗ HYDE error:", error.message, "\n");
  }

  // Test 3: Cross-Encoder Re-ranking
  console.log("TEST 3: Cross-Encoder Re-ranking (rerankChunksBySemantic)");
  console.log("-".repeat(50));
  try {
    const query = "What is machine learning?";
    console.log(`Query: "${query}"`);
    console.log(`Input chunks: ${mockChunks.length}`);
    
    const reranked = await rerankChunksBySemantic(query, mockChunks, 3);
    
    console.log(`Reranked top 3 chunks:`);
    reranked.forEach((chunk, i) => {
      console.log(
        `  ${i + 1}. Score: ${chunk.rerankScore?.toFixed(2) || "N/A"} - "${chunk.content.substring(0, 60)}..."`
      );
    });
    console.log("✓ Cross-Encoder Re-ranking works\n");
  } catch (error) {
    console.error("✗ Cross-Encoder Re-ranking error:", error.message, "\n");
  }

  console.log("=== All Tests Completed ===\n");
}

// Run tests
runTests().catch(console.error);
