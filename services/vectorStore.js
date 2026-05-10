import { QdrantClient } from "@qdrant/js-client-rest";
import crypto from "crypto";

// Initialize Qdrant Client
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

/**
 * Index documents into vector store
 * @param {string} collectionName - Collection name
 * @param {Array} embeddedChunks - Chunks with embeddings
 */
export async function indexDocuments(collectionName, embeddedChunks) {
  if (!embeddedChunks || embeddedChunks.length === 0) return;

  const vectorDimension = embeddedChunks[0].embedding.length || 1536;

  try {
    await qdrant.getCollection(collectionName);
    console.log(`[VectorStore] Collection ${collectionName} exists.`);
  } catch (e) {
    console.log(`[VectorStore] Creating collection ${collectionName}...`);
    await qdrant.createCollection(collectionName, {
      vectors: {
        size: vectorDimension,
        distance: "Cosine",
      },
    });
  }

  const points = embeddedChunks.map((chunk) => ({
    id: crypto.randomUUID(),
    vector: chunk.embedding,
    payload: {
      content: chunk.pageContent,
      metadata: chunk.metadata,
    },
  }));

  await qdrant.upsert(collectionName, { wait: true, points });
  console.log(`[VectorStore] Added ${points.length} vectors to ${collectionName}`);
}

/**
 * Retrieve similar documents
 * @param {string} collectionName - Collection name
 * @param {Array} queryVector - Query embedding
 * @param {number} k - Number of results
 * @returns {Array} Retrieved documents
 */
export async function retrieveSimilarDocuments(collectionName, queryVector, k = 3) {
  try {
    const searchResult = await qdrant.search(collectionName, {
      vector: queryVector,
      limit: k,
      with_payload: true,
    });

    return searchResult.map((res) => ({
      content: res.payload.content,
      metadata: res.payload.metadata,
      score: res.score,
    }));
  } catch (error) {
    console.error(`[VectorStore] Search error for ${collectionName}:`, error);
    return [];
  }
}

/**
 * Get collection statistics
 * @param {string} collectionName - Collection name
 * @returns {Object} Collection info
 */
export async function getCollectionStats(collectionName) {
  try {
    const info = await qdrant.getCollection(collectionName);
    return {
      pointCount: info.vectors_count,
    };
  } catch (e) {
    return null;
  }
}

/**
 * List all indexed collections
 * @returns {Array} Collection names
 */
export async function listCollections() {
  try {
    const result = await qdrant.getCollections();
    return result.collections.map((c) => c.name);
  } catch (e) {
    console.error("[VectorStore] List collections error:", e);
    return [];
  }
}

/**
 * Delete collection
 * @param {string} collectionName - Collection name
 */
export async function deleteCollection(collectionName) {
  try {
    await qdrant.deleteCollection(collectionName);
    console.log(`[VectorStore] Deleted collection: ${collectionName}`);
  } catch (error) {
    console.error(`[VectorStore] Delete collection error for ${collectionName}:`, error);
  }
}
