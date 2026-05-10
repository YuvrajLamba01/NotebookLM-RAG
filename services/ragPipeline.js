import { processDocument, processDocumentFromBuffer } from "./documentProcessor.js";
import { embedChunks, embedQuery } from "./embeddingService.js";
import {
  indexDocuments,
  retrieveSimilarDocuments,
  getCollectionStats,
  listCollections,
  deleteCollection,
} from "./vectorStore.js";
import { generateGroundedAnswer, generateDocumentSummary } from "./llmService.js";

/**
 * End-to-end RAG Pipeline
 * Ingestion → Chunking → Embedding → Storage → Retrieval → Generation
 */

/**
 * Index a new document
 * @param {Buffer} fileBuffer - Document buffer
 * @param {string} mimetype - Document MIME type
 * @param {string} originalName - Original file name
 * @param {string} collectionName - Unique identifier for this document
 * @returns {Promise<Object>} Indexing result
 */
export async function indexNewDocument(fileBuffer, mimetype, originalName, collectionName) {
  try {
    console.log("\n=== STARTING RAG INDEXING PIPELINE ===");
    console.log(`Document: ${originalName}`);
    console.log(`Collection: ${collectionName}\n`);

    // Step 1: Process document
    const chunks = await processDocumentFromBuffer(fileBuffer, mimetype, originalName);

    // Step 2: Generate embeddings
    const embeddedChunks = await embedChunks(chunks);

    // Step 3: Index into vector store
    await indexDocuments(collectionName, embeddedChunks);

    // Step 4: Generate summary
    console.log(`[RAG] Generating document summary...`);
    // Log debug info about chunks to help diagnose empty-summary issues
    if (chunks && chunks.length > 0) {
      console.log(`[RAG DEBUG] sample chunk keys: ${Object.keys(chunks[0]).join(', ')}`);
      console.log(`[RAG DEBUG] sample pageContent length: ${String((chunks[0].pageContent||chunks[0].content||'').length)}`);
    } else {
      console.log('[RAG DEBUG] no chunks available for summary');
    }

    const summary = await generateDocumentSummary(chunks);

    const summaryStructured = summary ? parseSummaryJson(summary) : null;
    const summaryError = summary ? null : "Summary unavailable — the AI model is temporarily rate-limited. Your document is indexed and ready to query. You can ask questions now.";

    const stats = await getCollectionStats(collectionName);

    console.log("\n=== INDEXING COMPLETE ===\n");

    return {
      success: true,
      collectionName,
      chunks: chunks.length,
      stats,
      summary,
      summaryStructured,
      summaryError,
    };
  } catch (error) {
    console.error("Error indexing document:", error);
    throw error;
  }
}

function parseSummaryJson(summaryText) {
  if (!summaryText || typeof summaryText !== "string") {
    return null;
  }

  const cleanedText = summaryText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  const firstBrace = cleanedText.indexOf("{");
  const lastBrace = cleanedText.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(cleanedText.slice(firstBrace, lastBrace + 1));

    return {
      title: typeof parsed.title === "string" ? parsed.title : null,
      overview: typeof parsed.overview === "string" ? parsed.overview : null,
      keyTopics: Array.isArray(parsed.keyTopics)
        ? parsed.keyTopics.filter((topic) => typeof topic === "string" && topic.trim())
        : [],
      purpose: typeof parsed.purpose === "string" ? parsed.purpose : null,
      audience: typeof parsed.audience === "string" ? parsed.audience : null,
      tldr: typeof parsed.tldr === "string" ? parsed.tldr : null,
    };
  } catch (error) {
    console.warn("Failed to parse JSON summary:", error.message);
    return null;
  }
}

/**
 * Query a document collection
 * @param {string} query - User question
 * @param {string} collectionName - Collection to query
 * @param {number} k - Number of chunks to retrieve
 * @returns {Promise<Object>} Answer and retrieved chunks
 */
export async function queryDocument(query, collectionName, k = 3) {
  try {
    console.log(`\n[RAG Query] Question: "${query}"`);

    // Step 1: Embed query
    const queryEmbedding = await embedQuery(query);

    // Step 2: Retrieve similar chunks
    const retrievedChunks = await retrieveSimilarDocuments(
      collectionName,
      queryEmbedding,
      k
    );

    console.log(
      `[RAG Query] Retrieved ${retrievedChunks.length} relevant chunks`
    );

    if (retrievedChunks.length === 0) {
      return {
        answer:
          "Sorry, I could not find any relevant information in the document to answer your question.",
        retrievedChunks: [],
        confidence: 0,
      };
    }

    // Step 3: Generate grounded answer
    const answer = await generateGroundedAnswer(query, retrievedChunks);

    // Calculate average confidence score
    const confidence =
      retrievedChunks.reduce((sum, chunk) => sum + chunk.score, 0) /
      retrievedChunks.length;

    return {
      answer,
      retrievedChunks,
      confidence,
    };
  } catch (error) {
    console.error("Error querying document:", error);
    throw error;
  }
}

/**
 * Get available collections
 * @returns {Array} List of collection names
 */
export async function getAvailableCollections() {
  return await listCollections();
}

/**
 * Delete a collection
 * @param {string} collectionName - Collection to delete
 */
export async function removeCollection(collectionName) {
  await deleteCollection(collectionName);
}
