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
} from "./services/ragPipeline.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

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
app.use(express.json());
app.use(express.static(path.join(__dirname, "client/build")));

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

// Query a document
app.post("/api/query", async (req, res) => {
  try {
    const { query, collectionName, topK } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    if (!collectionName) {
      return res.status(400).json({ error: "Collection name is required" });
    }

    console.log(`[API] Query: "${query}"`);
    console.log(`[API] Collection: ${collectionName}`);

    const result = await queryDocument(query, collectionName, topK || 3);

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

// Serve frontend (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/build/index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// Start server if not running in Vercel
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✅ NotebookLM RAG Server running on http://localhost:${PORT}`);
    console.log(`📄 API Documentation:`);
    console.log(`   GET  /api/health - Health check`);
    console.log(`   GET  /api/documents - List indexed documents`);
    console.log(`   POST /api/documents/upload - Upload and index document`);
    console.log(`   POST /api/query - Query a document`);
    console.log(`   DELETE /api/documents/:collectionName - Delete document\n`);
  });
}

// Export for Vercel
export default app;
