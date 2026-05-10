import { OpenAI } from "openai";

/**
 * Initialize OpenAI client configured for Gemini API
 * @returns {OpenAI} Configured OpenAI client
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

  for (let attempt = 0; attempt <= 4; attempt += 1) {
    try {
      return await client.chat.completions.create(request);
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === 4) {
        throw error;
      }

      const delayMs = getRetryDelayMs(error, attempt);
      console.warn(
        `[LLM] Retryable error on attempt ${attempt + 1}/5. Waiting ${delayMs}ms before retrying...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Generate a grounded answer using retrieved context
 * @param {string} query - User query
 * @param {Array} retrievedChunks - Retrieved document chunks
 * @param {string} model - Model to use (default: gemini-1.5-flash)
 * @returns {Promise<string>} Generated answer
 */
export async function generateGroundedAnswer(
  query,
  retrievedChunks,
  model = process.env.GEMINI_MODEL || "gemini-3-flash-preview"
) {
  const client = getClient();

  // Build context from retrieved chunks
  const context = retrievedChunks
    .map((chunk, i) => {
      const pageInfo = chunk.metadata?.loc?.pageNumber
        ? ` (Page ${chunk.metadata.loc.pageNumber})`
        : "";
      return `Source ${i + 1}${pageInfo}:\n${chunk.content}`;
    })
    .join("\n\n---\n\n");

  // Create system prompt that emphasizes grounded answers
  const systemPrompt = `You are an AI Assistant that answers questions based ONLY on the provided document context.

IMPORTANT RULES:
1. Only answer based on the provided context from the document.
2. If the answer is not in the context, explicitly say "This information is not available in the document."
3. Always cite which source you're referencing (Source 1, Source 2, etc.)
4. Do not use your general knowledge - stick strictly to the document content.
5. Be concise and specific in your answers.
6. If asked for examples, provide them only from the document.

DOCUMENT CONTEXT:
${context}`;

  try {
    console.log(`[LLM] Generating answer for query: "${query}"`);

    const response = await createChatCompletionWithRetry(client, {
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: query,
        },
      ],
      temperature: 0.2, // Lower temperature for more factual answers
      max_tokens: 1000,
    });

    const answer = response.choices[0].message.content;
    console.log(`[LLM] Answer generated successfully`);

    return answer;
  } catch (error) {
    console.error("Error generating answer:", error);
    throw error;
  }
}

/**
 * Generate a concise summary of a document
 * @param {Array} documentChunks - All chunks from a document
 * @returns {Promise<string>} Document summary
 */
export async function generateDocumentSummary(documentChunks) {
  const client = getClient();

  // Build a representative context by sampling chunks evenly across the document.
  if (!documentChunks || documentChunks.length === 0) {
    return (
      "The provided document appears to be empty and contains no text or information to summarize. " +
      "Please provide a document with content if you would like a concise summary."
    );
  }

  const total = documentChunks.length;
  const sampleCount = Math.min(6, total);
  const sampled = [];
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.round((i * (total - 1)) / (sampleCount - 1 || 1));
    const chunk = documentChunks[idx] || documentChunks[0];
    const text = chunk.pageContent || chunk.content || (chunk.payload && chunk.payload.content) || "";
    if (text && text.trim().length > 0) sampled.push(text.trim());
  }

  if (sampled.length === 0) {
    return (
      "The provided document appears to be empty or contains no readable text. Consequently, I am unable to provide a summary of its contents."
    );
  }

  const context = sampled.join("\n\n---\n\n");

  try {
    const promptSystem =
      "You are a document summarizer. Your job is to explain what the document contains, its main topics, and its purpose using only the provided text. Do not stop at the title. Do not invent details that are not supported by the excerpts.";

    const promptUser = `You are given representative excerpts from a document.

Your summary must answer these questions clearly:
1. What does the document contain overall?
2. What are the key topics or themes?
3. What is the purpose of the document?

Return ONLY valid JSON with this shape:
{
  "title": "short title or null",
  "overview": "2-3 sentence plain-English summary of what the document contains",
  "keyTopics": ["topic 1", "topic 2", "topic 3"],
  "purpose": "1 sentence explanation of the document's purpose",
  "audience": "who this is for, or null",
  "tldr": "1 sentence summary"
}

Rules:
- Focus on content, themes, and purpose, not just naming the document.
- If a field is not supported by the text, use null for strings and [] for arrays.
- Keep keyTopics to 3-5 items.
- Keep the JSON compact and concise so it can fit in a single response.
- Do not wrap the JSON in markdown or code fences.

Document excerpts:
${context}`;

    const response = await createChatCompletionWithRetry(client, {
      model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
      messages: [
        { role: "system", content: promptSystem },
        { role: "user", content: promptUser },
      ],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error generating summary:", error);

    if (isRetryableError(error)) {
      console.warn("[LLM] Summary generation rate-limited. Returning null.");
      return null;
    }

    throw error;
  }
}
