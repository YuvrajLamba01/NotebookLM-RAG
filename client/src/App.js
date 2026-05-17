import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import "./App.css";

const api = axios.create({
  baseURL:
    process.env.REACT_APP_API_BASE_URL ||
    (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:5000"
      : ""),
});

function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [useHYDE, setUseHYDE] = useState(false);
  const [useReranking, setUseReranking] = useState(false);
  const [useCorrectiveRAG, setUseCorrectiveRAG] = useState(false);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  const formatDocumentName = (name) => {
    if (!name) return "Untitled Document";

    // Convert generated collection names like My_File_1715350000000_ab12cd to My File
    const withoutSuffix = name.replace(/_[0-9]{10,}_[a-z0-9]{4,}$/i, "");
    const humanized = withoutSuffix.replace(/[_-]+/g, " ").trim();

    return humanized || name;
  };

  const normalizeSummary = (summaryText, summaryStructured) => {
    if (summaryStructured) {
      return summaryStructured;
    }

    if (typeof summaryText !== "string") {
      return null;
    }

    let parsed = null;
    try {
      const cleanedText = summaryText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");

      const firstBrace = cleanedText.indexOf("{");
      const lastBrace = cleanedText.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsed = JSON.parse(cleanedText.slice(firstBrace, lastBrace + 1));
      }
    } catch (error) {
      // Ignore parse error and fall through to regex extraction
    }

    if (parsed) {
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
    }

    // Fallback extraction for truncated or malformed JSON
    const extract = (key) => {
      const match = summaryText.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)`));
      return match ? match[1].replace(/\\\\n/g, '\\n') : null;
    };
    
    const extractArray = (key) => {
      const match = summaryText.match(new RegExp(`"${key}"\\s*:\\s*\\[(.*?)(?:\\]|$)`, 's'));
      if (!match) return [];
      const items = match[1].match(/"([^"]*)"/g);
      return items ? items.map((i) => i.replace(/"/g, "")) : [];
    };

    const title = extract("title");
    const overview = extract("overview");
    const purpose = extract("purpose");

    if (title || overview || purpose) {
      return {
        title,
        overview,
        keyTopics: extractArray("keyTopics"),
        purpose,
        tldr: extract("tldr"),
        audience: extract("audience"),
      };
    }

    return null;
  };

  const formatAnswer = (text) => {
    if (!text) return null;

    // Split into paragraphs on double newlines
    const paragraphs = text.split(/\n{2,}/);

    return paragraphs.map((para, pIdx) => {
      const trimmed = para.trim();
      if (!trimmed) return null;

      // Check if entire paragraph is a list block
      const lines = trimmed.split('\n');
      const isList = lines.every(
        (l) => /^\s*[-*•]\s/.test(l) || /^\s*\d+[.)]\s/.test(l) || l.trim() === ''
      );

      if (isList) {
        return (
          <ul key={pIdx} className="ai-list">
            {lines
              .filter((l) => l.trim())
              .map((line, lIdx) => {
                const content = line.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[.)]\s*/, '');
                return <li key={lIdx}>{inlineFormat(content)}</li>;
              })}
          </ul>
        );
      }

      return <p key={pIdx}>{inlineFormat(trimmed)}</p>;
    });
  };

  const inlineFormat = (text) => {
    // Handle **bold** and *italic*
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
  };

  const renderSummaryCard = (summaryData, summaryText) => {
    if (summaryData) {
      return (
        <div className="summary-grid">
          {summaryData.title && (
            <div className="summary-section summary-title-section">
              <span className="summary-label">Title</span>
              <p>{summaryData.title}</p>
            </div>
          )}

          {summaryData.overview && (
            <div className="summary-section summary-wide">
              <span className="summary-label">Overview</span>
              <p>{summaryData.overview}</p>
            </div>
          )}

          {summaryData.keyTopics?.length > 0 && (
            <div className="summary-section">
              <span className="summary-label">Key topics</span>
              <ul className="summary-list">
                {summaryData.keyTopics.map((topic, index) => (
                  <li key={index}>{topic}</li>
                ))}
              </ul>
            </div>
          )}

          {summaryData.purpose && (
            <div className="summary-section">
              <span className="summary-label">Purpose</span>
              <p>{summaryData.purpose}</p>
            </div>
          )}

          {summaryData.audience && (
            <div className="summary-section">
              <span className="summary-label">Audience</span>
              <p>{summaryData.audience}</p>
            </div>
          )}

          {summaryData.tldr && (
            <div className="summary-section summary-wide summary-highlight">
              <span className="summary-label">TL;DR</span>
              <p>{summaryData.tldr}</p>
            </div>
          )}
        </div>
      );
    }

    return (
      <p className="raw-summary">{summaryText || "Summary unavailable."}</p>
    );
  };

  const getStructuredSummary = (message) => {
    return normalizeSummary(message.summary, message.summaryStructured);
  };

  // Fetch available documents on mount
  useEffect(() => {
    loadDocuments();
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadDocuments = async () => {
    try {
      const response = await api.get("/api/documents");
      const collections = response.data.collections || [];
      setDocuments(collections);
      if (collections.length > 0) {
        setSelectedDoc(collections[0]);
      }
    } catch (err) {
      console.error("Error loading documents:", err);
      setError("Could not connect to backend. Please start server on port 5000.");
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!["application/pdf", "text/plain"].includes(file.type)) {
      setError("Please upload a PDF or TXT file");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    setError(null);

    try {
      const response = await api.post("/api/documents/upload", formData);

      // Add new document to list
      setDocuments((prev) => [...prev, response.data.collectionName]);
      setSelectedDoc(response.data.collectionName);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: "upload",
          fileName: response.data.fileName,
          chunks: response.data.chunks,
          summary: response.data.summary,
          summaryStructured: normalizeSummary(
            response.data.summary,
            response.data.summaryStructured || null
          ),
          summaryError: response.data.summaryError || null,
        },
      ]);
      setQuery("");
    } catch (err) {
      setError(err.response?.data?.error || "Error uploading document");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleQuery = async (e) => {
    e.preventDefault();

    if (!query.trim()) {
      setError("Please enter a question");
      return;
    }

    if (!selectedDoc) {
      setError("Please select or upload a document first");
      return;
    }

    const askedQuery = query.trim();

    setLoading(true);
    setError(null);
    setQuery("");

    // Add user message immediately for better chat feel.
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type: "user",
        query: askedQuery,
      },
    ]);

    try {
      const response = await api.post("/api/query", {
        query: askedQuery,
        collectionName: selectedDoc,
        topK: 3,
        options: {
          useHYDE,
          useReranking,
          useCorrectiveRAG,
        },
      });

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: "ai",
          answer: response.data.answer,
          chunks: response.data.retrievedChunks || [],
          confidence: response.data.confidence || 0,
          metrics: response.data.metrics || {},
        },
      ]);
    } catch (err) {
      setError(err.response?.data?.error || "Error querying document");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDocument = async (docName) => {
    try {
      await api.delete(`/api/documents/${docName}`);
      const newDocs = documents.filter((d) => d !== docName);
      setDocuments(newDocs);
      if (selectedDoc === docName) {
        setSelectedDoc(newDocs[0] || null);
      }
      setMessages([]);
    } catch (err) {
      setError("Error deleting document");
    }
  };

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <div className="header-content">
            <h1>✨ NotebookLM RAG</h1>
            <p>Chat with your documents using AI</p>
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
        </header>

        <div className="main-content">
          {/* Mobile overlay */}
          {sidebarOpen && (
            <div
              className="sidebar-overlay"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
            <div className="upload-section">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-upload"
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "📤 Upload Document"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
              <p className="upload-hint">PDF or TXT files (max 5MB)</p>
            </div>

            <div className="documents-section">
              <h3>Documents</h3>
              {documents.length === 0 ? (
                <p className="empty-state">No documents yet</p>
              ) : (
                <ul className="document-list">
                  {documents.map((doc) => (
                    <li
                      key={doc}
                      className={`doc-item ${selectedDoc === doc ? "active" : ""}`}
                    >
                      <button
                        onClick={() => {
                          setSelectedDoc(doc);
                          setSidebarOpen(false);
                        }}
                        className="doc-name"
                        title={formatDocumentName(doc)}
                      >
                        📄 {formatDocumentName(doc)}
                      </button>
                      <button
                        onClick={() => handleDeleteDocument(doc)}
                        className="btn-delete"
                        title="Delete"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Chat Area */}
          <main className="chat-area">
            {error && <div className="error-message">{error}</div>}

            <div className="messages">
              {messages.map((message) => (
                <React.Fragment key={message.id}>
                  {message.type === "upload" && (
                    <div className="message system-message">
                      <div className="message-content">
                        <h4>✅ Document Uploaded</h4>
                        <p>
                          <strong>File:</strong> {message.fileName}
                        </p>
                        <p>
                          <strong>Chunks:</strong> {message.chunks}
                        </p>
                        <div className="summary-box">
                          <strong>Summary:</strong>
                          {message.summaryError ? (
                            <div className="summary-error">
                              <span className="summary-error-icon">⚠️</span>
                              <div>
                                <p className="summary-error-title">Rate Limit Reached</p>
                                <p className="summary-error-text">{message.summaryError}</p>
                              </div>
                            </div>
                          ) : (
                            renderSummaryCard(getStructuredSummary(message), message.summary)
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {message.type === "user" && (
                    <div className="message user-message">
                      <div className="message-content">
                        <strong>You:</strong>
                        <p>{message.query}</p>
                      </div>
                    </div>
                  )}

                  {message.type === "ai" && (
                    <div className="message ai-message">
                      <div className="message-content">
                        <strong>NotebookLM:</strong>
                        <div className="ai-answer">{formatAnswer(message.answer)}</div>
                        <div className="confidence">
                          Confidence: {(message.confidence * 100).toFixed(1)}%
                        </div>
                        {message.chunks.length > 0 && (
                          <details className="sources">
                            <summary>📖 Retrieved Sources ({message.chunks.length})</summary>
                            <div className="sources-list">
                              {message.chunks.map((chunk, idx) => (
                                <div key={idx} className="source-item">
                                  <span className="source-number">Source {idx + 1}</span>
                                  <p>{chunk.content.substring(0, 150)}...</p>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}

              {loading && (
                <div className="message ai-message">
                  <div className="message-content">
                    <strong>NotebookLM:</strong>
                    <div className="typing-indicator">
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Query Input */}
            <div className="query-form-container">
              {selectedDoc ? (
                <div className="composer-shell">
                  <div className="composer-meta">
                    <span className="composer-chip">Current document</span>
                    <span className="composer-doc" title={selectedDoc}>
                      {selectedDoc}
                    </span>
                  </div>

                  <form onSubmit={handleQuery} className="query-form">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Ask about the document's themes, purpose, characters, or key ideas..."
                      disabled={loading}
                      className="query-input"
                      aria-label="Ask a question about your document"
                    />
                    <button
                      type="submit"
                      disabled={loading || !query.trim()}
                      className="btn btn-send"
                    >
                      {loading ? "⏳ Asking..." : "Send ↗"}
                    </button>
                  </form>

                  {/* Advanced RAG Features */}
                  <div className="rag-features-toggle">
                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={useHYDE}
                        onChange={(e) => setUseHYDE(e.target.checked)}
                        disabled={loading}
                        aria-label="Enable HYDE (Hypothetical Document Embeddings)"
                      />
                      <span className="toggle-label">🎯 HYDE Variations</span>
                      <span className="toggle-tooltip">Generate multiple query angles for better retrieval</span>
                    </label>

                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={useReranking}
                        onChange={(e) => setUseReranking(e.target.checked)}
                        disabled={loading}
                        aria-label="Enable semantic re-ranking"
                      />
                      <span className="toggle-label">📊 Re-ranking</span>
                      <span className="toggle-tooltip">Reorder results by semantic relevance</span>
                    </label>

                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={useCorrectiveRAG}
                        onChange={(e) => setUseCorrectiveRAG(e.target.checked)}
                        disabled={loading}
                        aria-label="Enable Corrective RAG"
                      />
                      <span className="toggle-label">🔧 Corrective RAG</span>
                      <span className="toggle-tooltip">Auto-reformulate if results are poor</span>
                    </label>
                  </div>

                  <p className="composer-help">
                    Try: summary, main topics, purpose, characters, or chapter-by-chapter questions.
                  </p>
                </div>
              ) : (
                <div className="empty-chat">
                  <div className="empty-chat-card">
                    <div className="empty-chat-icon">📄</div>
                    <h3>Upload a document to begin</h3>
                    <p>
                      Get an instant summary, then ask follow-up questions about themes,
                      characters, or the document's purpose.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
