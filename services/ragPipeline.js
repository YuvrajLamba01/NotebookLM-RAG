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
import {
  enhanceQuery,
  validateRetrievalQuality,
  detectQueryIssues,
  reformulateQueryAggressively,
  generateHypotheticalDocuments,
  rerankChunksBySemantic,
} from "./queryEnhancementService.js";
import {
  getCachedResult,
  cacheResult,
  invalidateCollectionCache,
  getCacheStats,
} from "./queryCache.js";
import {
  validateDocument,
  formatValidationResult,
  validateDocumentContent,
} from "./documentValidation.js";

/**
 * Advanced End-to-end RAG Pipeline v2
 * Enhanced with:
 * - Document validation (GIGO prevention)
 * - Query enhancement (typo correction, rewriting)
 * - Query caching (performance optimization)
 * - LLM-as-Judge validation
 * - Comprehensive error handling
 *
 * Ingestion → Validation → Chunking → Embedding → Storage → 
 * Enhancement → Cache Check → Retrieval → Judgment → Generation
 */

/**
 * Index a new document with validation
 * @param {Buffer} fileBuffer - Document buffer
 * @param {string} mimetype - Document MIME type
 * @param {string} originalName - Original file name
 * @param {string} collectionName - Unique identifier for this document
 * @returns {Promise<Object>} Indexing result with validation info
 */
export async function indexNewDocument(fileBuffer, mimetype, originalName, collectionName) {
  try {
    console.log("\n=== STARTING ADVANCED RAG INDEXING PIPELINE ===");
    console.log(`Document: ${originalName}`);
    console.log(`Collection: ${collectionName}\n`);

    // Step 0: Validate document buffer (GIGO Prevention)
    console.log(`[RAG] Validating document...`);
    const bufferValidation = validateDocument(fileBuffer, mimetype, originalName);

    if (!bufferValidation.isValid) {
      console.error("[RAG] Document validation failed:");
      console.error(formatValidationResult(bufferValidation));
      throw new Error(
        `Document validation failed: ${bufferValidation.bufferValidation.errors.join("; ")}`
      );
    }

    if (bufferValidation.bufferValidation.warnings.length > 0) {
      console.warn("[RAG] Document validation warnings:");
      bufferValidation.bufferValidation.warnings.forEach((w) => console.warn(`  - ${w}`));
    }

    // Step 1: Process document
    console.log(`[RAG] Processing document...`);
    const chunks = await processDocumentFromBuffer(fileBuffer, mimetype, originalName);

    // Step 1.5: Validate parsed content (GIGO Prevention - Content Level)
    const contentValidation = validateDocumentContent(chunks);
    console.log(`[RAG] Content Quality:`);
    console.log(`  - Chunks: ${contentValidation.stats.chunkCount}`);
    console.log(`  - Total Size: ${contentValidation.stats.totalChars} chars`);
    console.log(`  - Avg Chunk: ${contentValidation.stats.avgChunkSize.toFixed(0)} chars`);

    if (!contentValidation.isValid) {
      console.error("[RAG] Content validation failed:");
      contentValidation.errors.forEach((err) => console.error(`  - ${err}`));
      throw new Error(`Content validation failed: ${contentValidation.errors.join("; ")}`);
    }

    if (contentValidation.warnings.length > 0) {
      console.warn("[RAG] Content validation warnings:");
      contentValidation.warnings.forEach((w) => console.warn(`  - ${w}`));
    }

    // Step 2: Generate embeddings
    console.log(`[RAG] Generating embeddings for ${chunks.length} chunks...`);
    const embeddedChunks = await embedChunks(chunks);

    // Step 3: Index into vector store
    console.log(`[RAG] Indexing into vector store...`);
    await indexDocuments(collectionName, embeddedChunks);

    // Step 4: Generate summary
    console.log(`[RAG] Generating document summary...`);
    if (chunks && chunks.length > 0) {
      console.log(`[RAG DEBUG] sample chunk keys: ${Object.keys(chunks[0]).join(", ")}`);
      console.log(
        `[RAG DEBUG] sample pageContent length: ${String(
          (chunks[0].pageContent || chunks[0].content || "").length
        )}`
      );
    } else {
      console.log("[RAG DEBUG] no chunks available for summary");
    }

    const summary = await generateDocumentSummary(chunks);

    const summaryStructured = summary ? parseSummaryJson(summary) : null;
    const summaryError = summary
      ? null
      : "Summary unavailable — the AI model is temporarily rate-limited. Your document is indexed and ready to query. You can ask questions now.";

    const stats = await getCollectionStats(collectionName);

    // Clear cache for this collection (new document)
    invalidateCollectionCache(collectionName);

    console.log("\n=== ADVANCED INDEXING COMPLETE ===\n");
    console.log(`[RAG] Cache cleared for collection: ${collectionName}`);

    return {
      success: true,
      collectionName,
      chunks: chunks.length,
      stats,
      summary,
      summaryStructured,
      summaryError,
      validation: {
        bufferValid: bufferValidation.isValid,
        contentValid: contentValidation.isValid,
        warnings: [
          ...bufferValidation.bufferValidation.warnings,
          ...contentValidation.warnings,
        ],
      },
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
 * Query a document collection with advanced features
 * @param {string} query - User question
 * @param {string} collectionName - Collection to query
 * @param {number} k - Number of chunks to retrieve
 * @param {Object} options - Advanced options
 * @returns {Promise<Object>} Answer, retrieved chunks, and quality metrics
 */
export async function queryDocument(
  query,
  collectionName,
  k = 3,
  options = {
    useCache: true,
    useEnhancement: true,
    useJudgment: true,
  }
) {
  try {
    console.log(`\n[RAG Query] Question: "${query}"`);
    console.log(
      `[RAG Query] Options: cache=${options.useCache}, enhancement=${options.useEnhancement}, judgment=${options.useJudgment}`
    );

    // Step 0: Check cache first (if enabled)
    if (options.useCache) {
      const cachedResult = getCachedResult(query, collectionName);
      if (cachedResult) {
        console.log(`[RAG Query] ✓ Returning cached result`);
        return {
          ...cachedResult,
          fromCache: true,
        };
      }
    }

    // Step 1: Detect and handle query issues (without LLM)
    const queryIssues = detectQueryIssues(query);
    if (queryIssues.suggestedCorrections.length > 0) {
      console.warn(`[RAG Query] Query issues detected:`);
      queryIssues.suggestedCorrections.forEach((correction) =>
        console.warn(`  - ${correction}`)
      );
    }

    // Step 2: Enhance query (rewrite, typo correction) - if enabled
    let enhancedQuery = query;
    let queryEnhancement = null;

    if (options.useEnhancement) {
      queryEnhancement = await enhanceQuery(query);
      enhancedQuery = queryEnhancement.rewrittenQuery;

      if (query !== enhancedQuery) {
        console.log(`[RAG Query] Query enhanced:`);
        console.log(`  Original:   "${query}"`);
        console.log(`  Enhanced:   "${enhancedQuery}"`);
        console.log(`  Intent:     ${queryEnhancement.intent}`);
        console.log(`  Confidence: ${(queryEnhancement.confidence * 100).toFixed(1)}%`);
      }
    }

    // Step 3: Embed enhanced query
    console.log(`[RAG Query] Embedding query...`);
    const queryEmbedding = await embedQuery(enhancedQuery);

    // Step 3.5 (Optional): HYDE - Generate hypothetical documents
    let allQueryVariations = [enhancedQuery];
    if (options.useHYDE) {
      try {
        const hydeResults = await generateHypotheticalDocuments(query);
        allQueryVariations = hydeResults.map((h) => h.query);
        console.log(`[RAG Query] HYDE: Generated ${hydeResults.length} query variations`);
      } catch (hydeError) {
        console.error(`[RAG Query] HYDE error, falling back to single query:`, hydeError.message);
        allQueryVariations = [enhancedQuery];
      }
    }

    // Step 4: Retrieve similar chunks (using HYDE query variations if enabled)
    let allRetrievedChunks = [];
    if (allQueryVariations.length > 1) {
      console.log(`[RAG Query] Retrieving with ${allQueryVariations.length} query variations...`);
      for (const queryVar of allQueryVariations) {
        const varEmbedding = await embedQuery(queryVar);
        const chunks = await retrieveSimilarDocuments(collectionName, varEmbedding, k);
        allRetrievedChunks = allRetrievedChunks.concat(chunks);
      }
    } else {
      console.log(`[RAG Query] Retrieving ${k} chunks...`);
      allRetrievedChunks = await retrieveSimilarDocuments(
        collectionName,
        queryEmbedding,
        k
      );
    }

    // Deduplicate chunks by content
    const seen = new Set();
    let retrievedChunks = allRetrievedChunks.filter((chunk) => {
      const key = chunk.content?.substring(0, 100) || "";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`[RAG Query] Retrieved ${retrievedChunks.length} chunks (${allRetrievedChunks.length} before dedup)`);

    if (retrievedChunks.length === 0) {
      const noResultResponse = {
        answer:
          "Sorry, I could not find any relevant information in the document to answer your question.",
        retrievedChunks: [],
        confidence: 0,
        enhancement: queryEnhancement,
        judgment: {
          isRelevant: false,
          relevanceScore: 0,
          feedback: "No chunks retrieved",
        },
      };

      if (options.useCache) {
        cacheResult(query, collectionName, noResultResponse);
      }

      return noResultResponse;
    }

    // Step 4.5 (Optional): Cross-Encoder Re-ranking
    let finalChunks = retrievedChunks;
    if (options.useReranking && retrievedChunks.length > k) {
      try {
        finalChunks = await rerankChunksBySemantic(enhancedQuery, retrievedChunks, k);
        console.log(`[RAG Query] Re-ranking applied: top score=${finalChunks[0]?.rerankScore?.toFixed(2) || "N/A"}`);
      } catch (rerankerError) {
        console.error(`[RAG Query] Re-ranking error, using original order:`, rerankerError.message);
        finalChunks = retrievedChunks.slice(0, k);
      }
    } else {
      finalChunks = retrievedChunks.slice(0, k);
    }

    // Step 5: LLM-as-Judge validation (if enabled)
    let judgment = null;
    if (options.useJudgment) {
      judgment = await validateRetrievalQuality(enhancedQuery, finalChunks);
      console.log(`[RAG Query] Retrieval Quality Judgment:`);
      console.log(`  Relevant: ${judgment.isRelevant}`);
      console.log(`  Score: ${(judgment.relevanceScore * 100).toFixed(1)}%`);
      console.log(`  Should retrieve more: ${judgment.shouldRetrieveMore}`);

      // Step 5.5 (Optional): Corrective RAG - Reformulate if quality is low
      if (judgment.relevanceScore < 0.4 && options.useCorrectiveRAG) {
        try {
          console.log(`[RAG Query] Low relevance (${(judgment.relevanceScore * 100).toFixed(1)}%) - Applying Corrective RAG...`);
          const reformulatedQuery = await reformulateQueryAggressively(query, enhancedQuery);

          if (reformulatedQuery !== enhancedQuery) {
            console.log(`[RAG Query] Corrective RAG: Retrying with "${reformulatedQuery}"`);
            const reformulatedEmbedding = await embedQuery(reformulatedQuery);
            const reformulatedChunks = await retrieveSimilarDocuments(collectionName, reformulatedEmbedding, k + 2);

            if (options.useReranking && reformulatedChunks.length > k) {
              finalChunks = await rerankChunksBySemantic(reformulatedQuery, reformulatedChunks, k);
            } else {
              finalChunks = reformulatedChunks.slice(0, k);
            }

            // Re-judge the new results
            judgment = await validateRetrievalQuality(reformulatedQuery, finalChunks);
            console.log(`[RAG Query] Re-Judgment after Corrective RAG: ${(judgment.relevanceScore * 100).toFixed(1)}%`);
          }
        } catch (correctiveError) {
          console.error(`[RAG Query] Corrective RAG error, continuing with current chunks:`, correctiveError.message);
        }
      } else if (!judgment.isRelevant && judgment.shouldRetrieveMore && k < 10) {
        console.log(`[RAG Query] Judgment suggests retrieving more chunks, retrying with k=${k + 3}...`);
        return queryDocument(query, collectionName, k + 3, {
          ...options,
          useJudgment: false,
        });
      }
    }

    // Step 6: Generate grounded answer
    console.log(`[RAG Query] Generating answer...`);
    const answer = await generateGroundedAnswer(enhancedQuery, finalChunks);

    // Calculate average confidence score
    const confidence =
      finalChunks.reduce((sum, chunk) => sum + (chunk.rerankScore || chunk.score || 0), 0) / finalChunks.length;

    const result = {
      answer,
      retrievedChunks: finalChunks,
      confidence,
      enhancement: queryEnhancement,
      judgment,
      metrics: {
        originalQuery: query,
        enhancedQuery,
        chunksRetrieved: finalChunks.length,
        averageChunkScore: confidence,
        useHYDE: options.useHYDE,
        useReranking: options.useReranking,
        useCorrectiveRAG: options.useCorrectiveRAG,
      },
    };

    // Step 7: Cache result (if enabled)
    if (options.useCache) {
      cacheResult(query, collectionName, result);
    }

    return result;
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
 * Delete a collection and clear its cache
 * @param {string} collectionName - Collection to delete
 */
export async function removeCollection(collectionName) {
  invalidateCollectionCache(collectionName);
  await deleteCollection(collectionName);
  console.log(`[RAG] Collection removed and cache cleared: ${collectionName}`);
}

/**
 * Get system metrics and statistics
 * @returns {Object} Cache stats and system info
 */
export function getRAGMetrics() {
  const cacheStats = getCacheStats();
  return {
    cache: cacheStats,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Clear all query cache
 */
export function clearQueryCache() {
  const stats = getCacheStats();
  console.log(`[RAG] Clearing query cache: ${stats.size} entries`);
  // Implementation handled internally in queryCache
}

