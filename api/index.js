import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import {
  indexNewDocument,
  queryDocument,
  getAvailableCollections,
  removeCollection,
  getRAGMetrics,
} from "../services/ragPipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

function validateEnvironment() {
  const requiredVars = ["GEMINI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"];
  const missing = requiredVars.filter((name) => !process.env[name] || !process.env[name].trim());

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(", ")}`;
    console.error(`[Startup] ${message}`);
    throw new Error(message);
  }
}

// Do not throw at module import time on serverless platforms (e.g. Vercel).
// Validate at runtime for specific operations or rely on the host to provide env vars.
try {
  validateEnvironment();
} catch (err) {
  // Log a warning instead of crashing the process during import/build.
  // This allows serverless platforms to import the module even when env vars
  // are not configured yet (useful during preview builds). Individual
  // endpoints should still check required values when performing actions.
  console.warn('[Startup] Environment validation warning:', err.message);
}

function buildCollectionName(originalName) {
  const baseName = path.parse(originalName || "document").name;
  const safeBase = baseName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  const prefix = safeBase || "document";
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Middleware
app.use(cors());

// Middleware to ensure required env vars are present before RAG operations
function ensureEnvForRAG(req, res, next) {
  const requiredVars = ["GEMINI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"];
  const missing = requiredVars.filter((name) => !process.env[name] || !process.env[name].trim());
  if (missing.length > 0) {
    const message = `Missing required environment variables for RAG operations: ${missing.join(", ")}`;
    console.warn(`[Runtime Check] ${message}`);
    return res.status(500).json({ error: message });
  }
  next();
}

// Configure multer BEFORE express parsers to prevent conflicts
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Accept common PDF MIME type variants and text files
    const mimetype = file.mimetype.toLowerCase();
    const isPDF = (mimetype === "application/pdf") || 
                  (mimetype === "application/x-pdf") || 
                  (mimetype === "application/octet-stream" && file.originalname.endsWith(".pdf"));
    const isTXT = (mimetype === "text/plain") || 
                  (mimetype === "text/txt") ||
                  (mimetype === "application/octet-stream" && file.originalname.endsWith(".txt"));
    
    if (isPDF || isTXT) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only PDF and TXT files are allowed`), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Apply JSON parser AFTER file upload routes to avoid parsing multipart data
// Use a custom middleware to skip JSON parsing for multipart requests
app.use((req, res, next) => {
  // Skip JSON parsing for multipart requests (catches all multipart variants)
  if (req.is("multipart/*")) {
    return next();
  }
  express.json({ limit: "50mb" })(req, res, next);
});

app.use((req, res, next) => {
  // Skip URL encoding for multipart requests (catches all multipart variants)
  if (req.is("multipart/*")) {
    return next();
  }
  express.urlencoded({ limit: "50mb", extended: true })(req, res, next);
});

/**
 * API ROUTES
 */

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "NotebookLM RAG Backend is running" });
});

// List available documents
app.get("/api/documents", async (req, res) => {
  try {
    const collections = await getAvailableCollections();
    res.json({ collections });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload and index document
app.post("/api/documents/upload", ensureEnvForRAG, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      // Multer error (file filter or size limit)
      console.error("Multer error:", err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const collectionName = buildCollectionName(req.file.originalname);

    console.log(`\n[API] Received file: ${req.file.originalname}`);
    console.log(`[API] File MIME type: ${req.file.mimetype}`);
    console.log(`[API] Collection: ${collectionName}`);

    // Index the document
    const result = await indexNewDocument(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      collectionName
    );

    res.json({
      success: true,
      collectionName,
      fileName: req.file.originalname,
      chunks: result.chunks,
      summary: result.summary,
      summaryStructured: result.summaryStructured || null,
      summaryError: result.summaryError || null,
      message: "Document indexed successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Query a document (with advanced options)
app.post("/api/query", ensureEnvForRAG, async (req, res) => {
  try {
    const { query, collectionName, topK, options } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    if (!collectionName) {
      return res.status(400).json({ error: "Collection name is required" });
    }

    console.log(`[API] Query: "${query}"`);
    console.log(`[API] Collection: ${collectionName}`);

    // Advanced options with defaults
    const queryOptions = {
      useCache: options?.useCache !== false,
      useEnhancement: options?.useEnhancement !== false,
      useJudgment: options?.useJudgment !== false,
      useHYDE: options?.useHYDE === true,          // Opt-in
      useReranking: options?.useReranking === true, // Opt-in
      useCorrectiveRAG: options?.useCorrectiveRAG === true, // Opt-in
    };

    const result = await queryDocument(query, collectionName, topK || 3, queryOptions);

    res.json(result);
  } catch (error) {
    console.error("Query error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a document collection
app.delete("/api/documents/:collectionName", ensureEnvForRAG, async (req, res) => {
  try {
    const { collectionName } = req.params;

    await removeCollection(collectionName);

    res.json({
      success: true,
      message: `Collection ${collectionName} deleted successfully`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Advanced RAG API Endpoints
 */

// Get RAG system metrics and cache statistics
app.get("/api/metrics", ensureEnvForRAG, (req, res) => {
  try {
    const metrics = getRAGMetrics();
    res.json({
      success: true,
      metrics,
      features: {
        queryEnhancement: "enabled",
        queryCache: "enabled",
        documentValidation: "enabled",
        llmAsJudge: "enabled",
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get detailed system information
app.get("/api/system-info", (req, res) => {
  try {
    res.json({
      success: true,
      system: {
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || "development",
        models: {
          llm: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default app;
