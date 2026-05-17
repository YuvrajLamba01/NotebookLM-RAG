import { OpenAI } from "openai";

/**
 * Advanced Query Enhancement Service
 * - Rewrites unclear queries for better retrieval
 * - Corrects typos and grammar
 * - Validates query intent
 */

function getClient() {
  return new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  const status = error?.status || error?.response?.status;
  return status === 429 || status === 500 || status === 503 || status === 504;
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

  return Math.min(1000 * Math.pow(2, attempt), 8000);
}

async function createChatCompletionWithRetry(client, request) {
  let lastError = null;

  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      return await client.chat.completions.create(request);
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === 3) {
        throw error;
      }

      const delayMs = getRetryDelayMs(error, attempt);
      console.warn(
        `[QueryEnhancement] Retryable error on attempt ${attempt + 1}/4. Waiting ${delayMs}ms before retrying...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Rewrite query for better retrieval accuracy
 * Handles typos, grammar, and clarifies intent
 * @param {string} query - Original user query
 * @returns {Promise<Object>} { originalQuery, rewrittenQuery, hasTypos, intent }
 */
export async function enhanceQuery(query) {
  const client = getClient();

  try {
    console.log(`[QueryEnhancement] Processing query: "${query}"`);

    const response = await createChatCompletionWithRetry(client, {
      model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are a query enhancement expert. Your job is to:
1. Fix typos and grammar errors
2. Clarify vague or ambiguous questions
3. Identify the main intent (search, analysis, comparison, definition, etc.)
4. Expand abbreviations if needed

Respond ONLY with valid JSON (no markdown code blocks):
{
  "rewrittenQuery": "the improved query",
  "intent": "search|analysis|comparison|definition|explanation|other",
  "hasTypos": true|false,
  "confidence": 0.0-1.0
}`,
        },
        {
          role: "user",
          content: `Enhance this query: "${query}"`,
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const responseText = response.choices[0].message.content;
    console.log(`[QueryEnhancement] Raw response: ${responseText.substring(0, 100)}`);

    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[QueryEnhancement] Could not parse enhancement response`);
      return {
        originalQuery: query,
        rewrittenQuery: query,
        hasTypos: false,
        intent: "search",
        confidence: 0.5,
      };
    }

    const enhanced = JSON.parse(jsonMatch[0]);

    console.log(`[QueryEnhancement] Enhanced: "${enhanced.rewrittenQuery}" (intent: ${enhanced.intent})`);

    return {
      originalQuery: query,
      rewrittenQuery: enhanced.rewrittenQuery || query,
      hasTypos: enhanced.hasTypos || false,
      intent: enhanced.intent || "search",
      confidence: enhanced.confidence || 0.5,
    };
  } catch (error) {
    console.error("[QueryEnhancement] Error enhancing query:", error.message);
    // Fallback: return original query
    return {
      originalQuery: query,
      rewrittenQuery: query,
      hasTypos: false,
      intent: "search",
      confidence: 0.3,
    };
  }
}

/**
 * LLM as Judge - Validate retrieved results match query intent
 * @param {string} query - Original query
 * @param {Array} retrievedChunks - Retrieved document chunks
 * @returns {Promise<Object>} { isRelevant, relevanceScore, shouldRetrieveMore }
 */
export async function validateRetrievalQuality(query, retrievedChunks) {
  const client = getClient();

  if (!retrievedChunks || retrievedChunks.length === 0) {
    return {
      isRelevant: false,
      relevanceScore: 0,
      shouldRetrieveMore: true,
      feedback: "No chunks retrieved",
    };
  }

  try {
    console.log(`[QueryJudge] Validating ${retrievedChunks.length} retrieved chunks`);

    // Build context from retrieved chunks
    const context = retrievedChunks
      .map((chunk, i) => {
        const preview = chunk.content
          ? chunk.content.substring(0, 150).replace(/\n/g, " ")
          : "";
        return `Chunk ${i + 1} (score: ${chunk.score?.toFixed(2) || "N/A"}): ${preview}...`;
      })
      .join("\n\n");

    const response = await createChatCompletionWithRetry(client, {
      model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are a retrieval quality judge. Analyze if retrieved chunks truly answer the query.
Respond ONLY with valid JSON:
{
  "isRelevant": true|false,
  "relevanceScore": 0.0-1.0,
  "shouldRetrieveMore": true|false,
  "feedback": "brief explanation"
}`,
        },
        {
          role: "user",
          content: `Query: "${query}"\n\nRetrieved chunks:\n${context}\n\nAre these chunks relevant to answering the query?`,
        },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });

    const responseText = response.choices[0].message.content;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn(`[QueryJudge] Could not parse judge response`);
      return {
        isRelevant: true,
        relevanceScore: 0.6,
        shouldRetrieveMore: false,
        feedback: "Default validation",
      };
    }

    const judgment = JSON.parse(jsonMatch[0]);
    console.log(
      `[QueryJudge] Validation: relevant=${judgment.isRelevant}, score=${judgment.relevanceScore?.toFixed(2)}`
    );

    return judgment;
  } catch (error) {
    console.error("[QueryJudge] Error validating retrieval:", error.message);
    return {
      isRelevant: true,
      relevanceScore: 0.5,
      shouldRetrieveMore: false,
      feedback: "Validation error",
    };
  }
}

/**
 * Detect and handle common query issues
 * @param {string} query - User query
 * @returns {Object} { hasSpellingErrors, suggestedCorrections, confidence }
 */
export function detectQueryIssues(query) {
  const issues = {
    hasSpellingErrors: false,
    suggestedCorrections: [],
    confidence: 0.8,
  };

  // Check for common patterns
  const tooShort = query.trim().length < 3;
  const hasNumbers = /\d+/.test(query);
  const hasSpecialChars = /[!@#$%^&*()_+=\[\]{};:'",<>/?\\|`~]/.test(query);
  const allCaps = query === query.toUpperCase() && query.length > 3;

  if (tooShort) {
    issues.suggestedCorrections.push("Query is very short - add more context");
    issues.confidence -= 0.2;
  }

  if (allCaps) {
    issues.suggestedCorrections.push("Query is all caps - try normal capitalization");
  }

  if (hasSpecialChars && !hasNumbers) {
    issues.suggestedCorrections.push("Query contains unusual special characters");
    issues.confidence -= 0.1;
  }

  return issues;
}

/**
 * CORRECTIVE RAG: Reformulate query if retrieval quality is poor
 * @param {string} originalQuery - Original query
 * @param {string} originalEnhancedQuery - Already enhanced query
 * @param {number} attempt - Attempt number (to avoid infinite loops)
 * @returns {Promise<string>} More aggressive reformulated query
 */
export async function reformulateQueryAggressively(originalQuery, originalEnhancedQuery = null, attempt = 1) {
  const client = getClient();
  const baseQuery = originalEnhancedQuery || originalQuery;
  const maxAttempts = 2;

  if (attempt > maxAttempts) {
    console.log(`[CorrectiveRAG] Max reformulation attempts reached (${maxAttempts})`);
    return baseQuery;
  }

  try {
    console.log(`[CorrectiveRAG] Reformulating query (attempt ${attempt}/${maxAttempts}): "${baseQuery}"`);

    const response = await createChatCompletionWithRetry(client, {
      model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are an expert at query reformulation for improved document retrieval. The initial retrieval was not satisfactory.
Aggressively reformulate the query to:
1. Break down complex queries into more specific terms
2. Add synonyms and related concepts
3. Focus on key nouns and entities
4. Remove ambiguous words
5. Add context-specific keywords

Respond ONLY with valid JSON:
{
  "reformulatedQuery": "aggressive reformulation with different terms",
  "strategy": "explanation of reformulation strategy"
}`,
        },
        {
          role: "user",
          content: `Original query: "${originalQuery}"\nPrevious attempt: "${baseQuery}"\n\nProvide a MORE DIFFERENT reformulation to retrieve relevant documents.`,
        },
      ],
      temperature: 0.6,
      max_tokens: 300,
    });

    const responseText = response.choices[0].message.content;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn(`[CorrectiveRAG] Could not parse reformulation response`);
      return baseQuery;
    }

    const reformulated = JSON.parse(jsonMatch[0]);
    console.log(`[CorrectiveRAG] Reformulated: "${reformulated.reformulatedQuery}" (${reformulated.strategy})`);

    return reformulated.reformulatedQuery || baseQuery;
  } catch (error) {
    console.error("[CorrectiveRAG] Error reformulating query:", error.message);
    return baseQuery;
  }
}

/**
 * HYDE: Generate hypothetical documents and use them for better retrieval
 * @param {string} query - User query
 * @returns {Promise<Array>} Array of { query: string, type: "hypothetical"|"original" }
 */
export async function generateHypotheticalDocuments(query) {
  const client = getClient();

  try {
    console.log(`[HYDE] Generating hypothetical documents for query: "${query}"`);

    const response = await createChatCompletionWithRetry(client, {
      model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are an expert at generating hypothetical document excerpts that would answer a given query.
Generate 2-3 realistic document snippets that would directly answer the user's question.
These should be diverse in perspective/source to improve retrieval coverage.

Respond ONLY with valid JSON:
{
  "hypotheticalDocuments": [
    "First hypothetical excerpt (as if from a relevant document)",
    "Second hypothetical excerpt (different angle or source)",
    "Third hypothetical excerpt (another perspective)"
  ]
}`,
        },
        {
          role: "user",
          content: `Generate realistic document excerpts that would answer this query: "${query}"`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const responseText = response.choices[0].message.content;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn(`[HYDE] Could not parse hypothetical documents response`);
      return [{ query, type: "original" }];
    }

    const result = JSON.parse(jsonMatch[0]);
    const documents = result.hypotheticalDocuments || [];

    console.log(`[HYDE] Generated ${documents.length} hypothetical documents`);

    return [
      { query, type: "original" },
      ...documents.slice(0, 2).map((doc) => ({
        query: doc,
        type: "hypothetical",
      })),
    ];
  } catch (error) {
    console.error("[HYDE] Error generating hypothetical documents:", error.message);
    return [{ query, type: "original" }];
  }
}

/**
 * CROSS-ENCODER RE-RANKING: Semantic re-ranking of retrieved chunks
 * @param {string} query - User query
 * @param {Array} chunks - Retrieved chunks with similarity scores
 * @param {number} topK - Number of top results to return after re-ranking
 * @returns {Promise<Array>} Re-ranked chunks sorted by semantic relevance
 */
export async function rerankChunksBySemantic(query, chunks, topK = 5) {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  if (chunks.length <= topK) {
    console.log(`[Reranker] Insufficient chunks (${chunks.length}) for re-ranking, returning as-is`);
    return chunks;
  }

  const client = getClient();

  try {
    console.log(`[Reranker] Re-ranking ${chunks.length} chunks for query: "${query}"`);

    const chunkSummaries = chunks
      .slice(0, 15)
      .map((chunk, idx) => {
        const summary = (chunk.content || "").substring(0, 200).replace(/\n/g, " ");
        return `[${idx + 1}] ${summary}...`;
      })
      .join("\n\n");

    const response = await createChatCompletionWithRetry(client, {
      model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are an expert at semantic relevance scoring. Score each document chunk's relevance to the user's query (0.0-1.0).

Respond ONLY with valid JSON:
{
  "scores": [
    { "index": 1, "relevanceScore": 0.95, "reason": "exact match for X" },
    { "index": 2, "relevanceScore": 0.75, "reason": "discusses Y" }
  ]
}`,
        },
        {
          role: "user",
          content: `Query: "${query}"\n\nScore these chunks by semantic relevance:\n\n${chunkSummaries}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    const responseText = response.choices[0].message.content;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn(`[Reranker] Could not parse re-ranking response`);
      return chunks.slice(0, topK);
    }

    const result = JSON.parse(jsonMatch[0]);
    const scores = result.scores || [];

    const scoreMap = {};
    scores.forEach((item) => {
      if (item.index && typeof item.relevanceScore === "number") {
        scoreMap[item.index - 1] = item.relevanceScore;
      }
    });

    const rankedChunks = chunks.slice(0, 15).map((chunk, idx) => ({
      ...chunk,
      rerankScore: scoreMap[idx] ?? chunk.score ?? 0,
    }));

    rankedChunks.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));

    console.log(`[Reranker] Top result: score=${(rankedChunks[0].rerankScore || 0).toFixed(2)}`);

    return rankedChunks.slice(0, topK);
  } catch (error) {
    console.error("[Reranker] Error re-ranking chunks:", error.message);
    return chunks.slice(0, topK);
  }
}
