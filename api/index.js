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

validateEnvironment();

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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Configure multer for file uploads using memory storage for Vercel compatibility
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["application/pdf", "text/plain"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and TXT files are allowed"));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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
app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const collectionName = buildCollectionName(req.file.originalname);

    console.log(`\n[API] Received file: ${req.file.originalname}`);
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
app.post("/api/query", async (req, res) => {
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
app.delete("/api/documents/:collectionName", async (req, res) => {
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
app.get("/api/metrics", (req, res) => {
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
