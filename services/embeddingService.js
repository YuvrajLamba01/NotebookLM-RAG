import { OpenAI } from "openai";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-2-preview";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const BATCH_SIZE = 16;
const MAX_RETRIES = 4;

function getClient() {
  return new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: GEMINI_API_BASE_URL,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(error, attempt) {
  const retryAfterHeader = error?.headers?.["retry-after"] || error?.response?.headers?.["retry-after"];
  const retryAfterSeconds = Number(retryAfterHeader);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  const message = String(error?.message || "");
  const secondsMatch = message.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (secondsMatch) {
    return Math.ceil(Number(secondsMatch[1]) * 1000);
  }

  const baseDelay = 1000 * Math.pow(2, attempt);
  return Math.min(baseDelay, 8000);
}

function isRetryableError(error) {
  const status = error?.status || error?.response?.status;
  return status === 429 || status === 500 || status === 503 || status === 504;
}

async function createEmbeddingsWithRetry(client, input) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input,
      });
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      const delayMs = getRetryDelayMs(error, attempt);
      console.warn(
        `[Embedding] Retryable error on attempt ${attempt + 1}/${MAX_RETRIES + 1}. Waiting ${delayMs}ms before retrying...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Generate embeddings for text chunks using Gemini's OpenAI-compatible endpoint.
 * @param {Array} chunks - Document chunks to embed
 * @returns {Promise<Array>} Chunks with embeddings
 */
export async function embedChunks(chunks) {
  const client = getClient();

  console.log(`[Embedding] Generating embeddings for ${chunks.length} chunks...`);

  try {
    const batchedChunks = chunkArray(chunks, BATCH_SIZE);
    const embeddedChunks = [];

    for (const batch of batchedChunks) {
      const response = await createEmbeddingsWithRetry(
        client,
        batch.map((chunk) => chunk.pageContent)
      );

      response.data.forEach((item, index) => {
        embeddedChunks.push({
          ...batch[index],
          embedding: item.embedding,
        });
      });
    }

    console.log(`[Embedding] Successfully embedded ${embeddedChunks.length} chunks`);
    return embeddedChunks;
  } catch (error) {
    console.error("Error embedding chunks:", error);
    throw error;
  }
}

/**
 * Embed a single query using Gemini.
 * @param {string} query - User query to embed
 * @returns {Promise<Array>} Query embedding vector
 */
export async function embedQuery(query) {
  const client = getClient();
  const response = await createEmbeddingsWithRetry(client, query);

  return response.data[0].embedding;
}