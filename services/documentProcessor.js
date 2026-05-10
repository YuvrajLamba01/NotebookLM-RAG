import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Load and parse PDF or text files
 * @param {string} filePath - Path to the document file
 * @returns {Promise<Array>} Array of document pages
 */
export async function loadDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const pdfBuffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(pdfBuffer);
    return [
      {
        pageContent: parsed.text || "",
        metadata: {
          source: filePath,
          type: "pdf",
          totalPages: parsed.numpages || 0,
          info: parsed.info || {},
        },
      },
    ];
  } else if (ext === ".txt") {
    const content = fs.readFileSync(filePath, "utf-8");
    return [
      {
        pageContent: content,
        metadata: {
          source: filePath,
          type: "txt",
        },
      },
    ];
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }
}

/**
 * Load and parse PDF or text from a buffer (for Vercel serverless)
 * @param {Buffer} buffer - File buffer
 * @param {string} mimetype - MIME type of the file
 * @param {string} originalName - Original file name
 * @returns {Promise<Array>} Array of document pages
 */
export async function loadDocumentFromBuffer(buffer, mimetype, originalName) {
  if (mimetype === "application/pdf") {
    const parsed = await pdfParse(buffer);
    return [
      {
        pageContent: parsed.text || "",
        metadata: {
          source: originalName,
          type: "pdf",
          totalPages: parsed.numpages || 0,
          info: parsed.info || {},
        },
      },
    ];
  } else if (mimetype === "text/plain") {
    const content = buffer.toString("utf-8");
    return [
      {
        pageContent: content,
        metadata: {
          source: originalName,
          type: "txt",
        },
      },
    ];
  } else {
    throw new Error(`Unsupported file type: ${mimetype}`);
  }
}

/**
 * Split documents into manageable chunks using Recursive Character Text Splitter
 * Chunking Strategy: Recursive Character Text Splitter
 * - Splits at sentence boundaries first
 * - Falls back to word boundaries
 * - Ensures contextual coherence
 * @param {Array} documents - Array of documents to chunk
 * @returns {Promise<Array>} Array of chunked documents
 */
export async function chunkDocuments(documents) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const chunkedDocs = await splitter.splitDocuments(documents);

  // Add metadata for better tracking
  return chunkedDocs.map((doc, index) => ({
    ...doc,
    metadata: {
      ...doc.metadata,
      chunkIndex: index,
      chunkSize: doc.pageContent.length,
    },
  }));
}

/**
 * Process an entire document: load and chunk
 * @param {string} filePath - Path to document
 * @returns {Promise<Array>} Processed and chunked documents
 */
export async function processDocument(filePath) {
  console.log(`[Processing] Loading document: ${filePath}`);
  const docs = await loadDocument(filePath);

  console.log(`[Processing] Chunking ${docs.length} document(s)...`);
  const chunks = await chunkDocuments(docs);

  console.log(`[Processing] Created ${chunks.length} chunks`);
  return chunks;
}

/**
 * Process a document from a buffer: load and chunk
 * @param {Buffer} buffer - File buffer
 * @param {string} mimetype - MIME type
 * @param {string} originalName - Original filename
 * @returns {Promise<Array>} Processed and chunked documents
 */
export async function processDocumentFromBuffer(buffer, mimetype, originalName) {
  console.log(`[Processing] Loading document from buffer: ${originalName}`);
  const docs = await loadDocumentFromBuffer(buffer, mimetype, originalName);

  console.log(`[Processing] Chunking ${docs.length} document(s)...`);
  const chunks = await chunkDocuments(docs);

  console.log(`[Processing] Created ${chunks.length} chunks`);
  return chunks;
}
