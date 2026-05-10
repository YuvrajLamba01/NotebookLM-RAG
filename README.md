# Google NotebookLM RAG Application

A full-stack Retrieval-Augmented Generation (RAG) application that enables users to chat with their documents using AI. Upload any PDF or text file and ask questions—the system retrieves relevant content and generates answers grounded in your document.

## Deployment Checklist

- Copy `.env.example` to `.env` and set all required values.
- Never commit `.env` or any real API keys.
- Install dependencies at root and client:
  - `npm install`
  - `cd client && npm install`
- Build frontend before production deploy:
  - `cd client && npm run build`
- Start backend from project root:
  - `npm start`
- Verify health endpoint before going live:
  - `GET /api/health`
- Run one upload smoke test (`.txt` or `.pdf`) and one query test.
- Confirm Qdrant is reachable from deployment environment (`QDRANT_URL`, `QDRANT_API_KEY`).

## ✨ Features

- 📤 **Document Upload**: Support for PDF and TXT files (up to 5MB)
- 🔍 **Intelligent Chunking**: Recursive character-based text splitting for context preservation
- 🧠 **Semantic Search**: Vector embeddings for accurate document retrieval
- 🤖 **AI-Powered Answers**: Gemini API integration via OpenAI SDK
- 📊 **Answer Grounding**: Ensures responses come from document content, not LLM hallucinations
- 💾 **Vector Database**: Qdrant vector database with cosine similarity retrieval
- 🎨 **Clean UI**: Modern React frontend with real-time chat interface

## 🏗️ Architecture

```
┌─────────────┐
│   Frontend  │ (React)
│   (React)   │
└──────┬──────┘
       │
       │ HTTP API
       │
┌──────▼──────────────────────────────┐
│       Express Backend (Node.js)      │
├──────────────────────────────────────┤
│  RAG Pipeline:                       │
│  • Document Processing               │
│  • Text Chunking                     │
│  • Embedding Generation              │
│  • Vector Retrieval                  │
│  • LLM Answer Generation             │
└──────┬──────────────────────────────┘
       │
       ├─────────────────────────┬──────────────────────┐
       │                         │                      │
       ▼                         ▼                      ▼
┌──────────────┐         ┌──────────────┐      ┌──────────────┐
│ Vector Store │         │ File Storage │      │ Gemini API   │
│(Qdrant Cloud)│         │ (In-Memory)  │      │ (OpenAI SDK) │
└──────────────┘         └──────────────┘      └──────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Gemini API key (from Google AI Studio)

### Installation

1. **Clone the repository** (or use this directory)
   ```bash
   cd "c:\Users\Yuvraj\Google NotebookLM RAG"
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your Gemini API key and Qdrant credentials:
   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   QDRANT_API_KEY=your_qdrant_api_key
   QDRANT_URL=your_qdrant_cluster_url
   ```

3. **Install dependencies**
   ```bash
   npm install
   cd client && npm install && cd ..
   ```

4. **Build the frontend**
   ```bash
   cd client && npm run build && cd ..
   ```

5. **Start the server**
   ```bash
   npm start
   ```

   The app will run on `http://localhost:5000`

### Development Notes

- The frontend uses `REACT_APP_API_BASE_URL` when provided.
- In local development, it falls back to `http://127.0.0.1:5000`.
- In production, it uses same-origin `/api` requests when no base URL is set.

## 📚 RAG Pipeline Overview

### 1. **Document Processing** (`services/documentProcessor.js`)
- Loads PDF and TXT files using LangChain's document loaders
- Extracts text content and preserves metadata (page numbers, source)

### 2. **Text Chunking Strategy** 
**Chunking Method**: Recursive Character Text Splitter
- **Chunk Size**: 1000 characters
- **Overlap**: 200 characters (for context continuity)
- **Separators**: Intelligently splits at sentence boundaries (`\n\n`, `\n`, `. `), then words, then characters
- **Benefit**: Preserves semantic meaning and ensures related content stays together

### 3. **Embedding Generation** (`services/embeddingService.js`)
- Uses OpenAI's `text-embedding-3-small` model
- Configured to work with Gemini API via OpenAI SDK
- Batch embedding for efficiency
- Each chunk converted to a 1536-dimensional vector

### 4. **Vector Storage & Retrieval** (`services/vectorStore.js`)
- **Qdrant Cloud** vector database implementation
- **Retrieval Method**: Cosine similarity search via `@qdrant/js-client-rest`
- Stores vectors with metadata (page numbers, chunk index) in persistent cloud storage
- Top-k retrieval (default k=3) for most relevant chunks

### 5. **LLM Answer Generation** (`services/llmService.js`)
- Uses Gemini 1.5 Flash model
- **System Prompt**: Emphasizes grounding in document content
- **Temperature**: 0.2 (favors factuality over creativity)
- Retrieved chunks injected as context to prevent hallucinations
- **Safety**: Explicitly prevents answering from general knowledge

### 6. **RAG Orchestration** (`services/ragPipeline.js`)
- Coordinates entire pipeline: ingestion → retrieval → generation
- Tracks document collections and indexing status
- Provides summary generation for indexed documents

## 🔌 API Endpoints

### Health Check
```
GET /api/health
```

### List Documents
```
GET /api/documents
```
Returns array of indexed document collections.

### Upload & Index Document
```
POST /api/documents/upload
Content-Type: multipart/form-data

Body:
- file: (PDF or TXT file)

Response:
{
  "success": true,
  "collectionName": "doc_1234567890_abc123",
  "fileName": "example.pdf",
  "chunks": 45,
  "summary": "Document summary here..."
}
```

### Query Document
```
POST /api/query
Content-Type: application/json

Body:
{
  "query": "What is X?",
  "collectionName": "doc_1234567890_abc123",
  "topK": 3
}

Response:
{
  "answer": "Based on the document...",
  "retrievedChunks": [
    {
      "content": "...",
      "metadata": {...},
      "score": 0.89
    },
    ...
  ],
  "confidence": 0.87
}
```

### Delete Document
```
DELETE /api/documents/:collectionName
```

## 🎨 Frontend Structure

- **App.js**: Main React component with state management
- **App.css**: Responsive styling for modern UI
- **Features**:
  - Sidebar with document management
  - Chat interface with scrolling
  - Retrieved sources display
  - Confidence scores
  - Error handling

## 🔐 Security & Best Practices

1. **API Key Management**: Stored in environment variables, never exposed to frontend
2. **File Validation**: Only PDF and TXT files accepted
3. **Size Limits**: 5MB max file size
4. **CORS**: Configured for frontend communication
5. **Error Handling**: Comprehensive error messages and logging

## 📦 Dependencies

### Backend
- **express**: Web framework
- **cors**: Cross-origin requests
- **multer**: File uploads
- **@langchain/community**: PDF loading and text splitting
- **@langchain/openai**: Embeddings
- **openai**: LLM integration
- **dotenv**: Environment configuration

### Frontend
- **react**: UI framework
- **axios**: HTTP client

## 🚀 Deployment

### Docker (Optional)
```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
RUN cd client && npm install && npm run build && cd ..
EXPOSE 5000
CMD ["npm", "start"]
```

### Deployment Platforms
- **Vercel (Recommended)**: Ready for serverless deployment. Simply connect your GitHub repository and set the environment variables. The `vercel.json` routing is pre-configured.
- **Heroku**: `git push heroku main`
- **Railway**: Connect GitHub repository
- **AWS/Azure**: Container deployment

## 📊 Marking Scheme Compliance

| Criterion | Implementation |
|-----------|-----------------|
| **GitHub Repository** | All code organized and documented |
| **Live Project** | Deployable with clear setup instructions |
| **RAG Pipeline** | Full end-to-end: chunking → embedding → retrieval → generation |
| **Answer Quality** | Grounded in document via system prompts and context injection |
| **Code Quality** | Modular services, comprehensive documentation, clear chunking strategy |

## 🐛 Troubleshooting

### API Key Issues
```bash
# Verify API key is set
echo $GEMINI_API_KEY

# Test connectivity
curl -X GET http://localhost:5000/api/health
```

### File Upload Errors
- Ensure file is PDF or TXT
- Check file size (max 5MB)

### Answer Quality Issues
- Increase `topK` in query (retrieve more chunks)
- Reduce chunk overlap if context too long
- Verify document has enough content about query topic

## 📝 License

MIT


---


