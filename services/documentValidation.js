/**
 * Document Validation Service
 * Implements "Garbage In, Garbage Out" (GIGO) prevention
 * Validates document quality before indexing
 */

/**
 * Validate document buffer for corruption and content
 * @param {Buffer} buffer - Document buffer
 * @param {string} mimetype - MIME type
 * @param {string} originalName - Original file name
 * @returns {Object} { isValid, errors, warnings, quality }
 */
export function validateDocumentBuffer(buffer, mimetype, originalName) {
  const result = {
    isValid: true,
    errors: [],
    warnings: [],
    quality: {
      size: buffer.length,
      isEmpty: buffer.length === 0,
      isSuspiciouslySmall: buffer.length < 100,
      isSuspiciouslyLarge: buffer.length > 50 * 1024 * 1024, // 50MB
    },
  };

  // Check file size
  if (buffer.length === 0) {
    result.errors.push("Document is empty (0 bytes)");
    result.isValid = false;
  }

  if (buffer.length < 100) {
    result.warnings.push("Document is very small (<100 bytes) - may have minimal content");
    result.quality.isSuspiciouslySmall = true;
  }

  if (buffer.length > 50 * 1024 * 1024) {
    result.errors.push("Document exceeds 50MB limit");
    result.isValid = false;
  }

  // Validate MIME type
  const validMimeTypes = ["application/pdf", "text/plain"];
  if (!validMimeTypes.includes(mimetype)) {
    result.errors.push(`Invalid MIME type: ${mimetype}. Allowed: ${validMimeTypes.join(", ")}`);
    result.isValid = false;
  }

  // PDF specific validation
  if (mimetype === "application/pdf") {
    if (!isProbablyPDF(buffer)) {
      result.errors.push("File has PDF extension but content doesn't match PDF format");
      result.isValid = false;
    }
  }

  // Text file validation
  if (mimetype === "text/plain") {
    if (!isProbablyText(buffer)) {
      result.warnings.push("File may be binary or corrupted (contains unusual byte patterns)");
    }
  }

  // Check for filename issues
  if (!originalName || originalName.trim().length === 0) {
    result.warnings.push("Original filename is empty");
  }

  if (originalName && originalName.length > 255) {
    result.warnings.push("Filename is very long (>255 chars) - may cause issues");
  }

  return result;
}

/**
 * Validate parsed document content
 * @param {Array} chunks - Parsed document chunks
 * @returns {Object} { isValid, errors, warnings, stats }
 */
export function validateDocumentContent(chunks) {
  const result = {
    isValid: true,
    errors: [],
    warnings: [],
    stats: {
      chunkCount: chunks.length,
      totalChars: 0,
      emptyChunks: 0,
      avgChunkSize: 0,
      minChunkSize: Infinity,
      maxChunkSize: 0,
      hasMetadata: false,
    },
  };

  if (!chunks || chunks.length === 0) {
    result.errors.push("No chunks extracted from document");
    result.isValid = false;
    return result;
  }

  // Analyze chunks
  let validChunks = 0;

  chunks.forEach((chunk, index) => {
    const content = chunk.pageContent || chunk.content || "";
    const len = content.length;

    result.stats.totalChars += len;

    if (len === 0) {
      result.stats.emptyChunks++;
    } else {
      validChunks++;
      result.stats.minChunkSize = Math.min(result.stats.minChunkSize, len);
      result.stats.maxChunkSize = Math.max(result.stats.maxChunkSize, len);
    }

    if (chunk.metadata) {
      result.stats.hasMetadata = true;
    }

    // Check for suspiciously repeated content
    if (index > 0 && content === (chunks[index - 1].pageContent || chunks[index - 1].content)) {
      result.warnings.push(`Chunk ${index} appears to be duplicate of chunk ${index - 1}`);
    }
  });

  result.stats.avgChunkSize = validChunks > 0 ? result.stats.totalChars / validChunks : 0;

  // Validation rules
  if (validChunks === 0) {
    result.errors.push("All extracted chunks are empty");
    result.isValid = false;
  }

  if (result.stats.totalChars < 50) {
    result.errors.push("Total document content is less than 50 characters");
    result.isValid = false;
  }

  if (result.stats.totalChars > 10000000) {
    // 10MB of text
    result.warnings.push("Document is very large (>10MB of text) - may impact performance");
  }

  if (result.stats.emptyChunks > chunks.length * 0.5) {
    result.warnings.push("More than 50% of chunks are empty - document may be corrupted");
  }

  if (!result.stats.hasMetadata) {
    result.warnings.push("Document lacks metadata - may affect traceability");
  }

  return result;
}

/**
 * Check if buffer is probably a PDF (starts with PDF magic number)
 */
function isProbablyPDF(buffer) {
  if (buffer.length < 4) return false;
  const header = buffer.toString("ascii", 0, 4);
  return header === "%PDF";
}

/**
 * Check if buffer is probably text (mostly printable ASCII/UTF-8)
 */
function isProbablyText(buffer) {
  if (buffer.length === 0) return false;

  // Sample first 1000 bytes
  const sample = Math.min(1000, buffer.length);
  let printableCount = 0;

  for (let i = 0; i < sample; i++) {
    const byte = buffer[i];
    // Count as printable if: printable ASCII, common whitespace, or UTF-8 multibyte
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13 || byte > 127) {
      printableCount++;
    }
  }

  // If >80% of sample is printable, assume it's text
  return printableCount / sample > 0.8;
}

/**
 * Comprehensive document validation
 * @param {Buffer} buffer - Document buffer
 * @param {string} mimetype - MIME type
 * @param {string} originalName - Original file name
 * @param {Array} chunks - Parsed chunks (optional)
 * @returns {Object} Complete validation result
 */
export function validateDocument(buffer, mimetype, originalName, chunks = null) {
  const bufferValidation = validateDocumentBuffer(buffer, mimetype, originalName);

  let contentValidation = null;
  if (chunks) {
    contentValidation = validateDocumentContent(chunks);
  }

  const validation = {
    isValid: bufferValidation.isValid && (!contentValidation || contentValidation.isValid),
    bufferValidation,
    contentValidation,
    summary: {
      totalErrors: bufferValidation.errors.length + (contentValidation?.errors.length || 0),
      totalWarnings: bufferValidation.warnings.length + (contentValidation?.warnings.length || 0),
      canIndex: bufferValidation.isValid && (!contentValidation || contentValidation.isValid),
    },
  };

  return validation;
}

/**
 * Format validation result for logging
 */
export function formatValidationResult(validation) {
  const lines = [];
  lines.push(`Document Validation: ${validation.isValid ? "✓ VALID" : "✗ INVALID"}`);

  if (validation.bufferValidation.errors.length > 0) {
    lines.push("  Buffer Errors:");
    validation.bufferValidation.errors.forEach((err) => lines.push(`    - ${err}`));
  }

  if (validation.contentValidation?.errors.length > 0) {
    lines.push("  Content Errors:");
    validation.contentValidation.errors.forEach((err) => lines.push(`    - ${err}`));
  }

  if (validation.bufferValidation.warnings.length > 0) {
    lines.push("  Buffer Warnings:");
    validation.bufferValidation.warnings.forEach((warn) => lines.push(`    - ${warn}`));
  }

  if (validation.contentValidation?.warnings.length > 0) {
    lines.push("  Content Warnings:");
    validation.contentValidation.warnings.forEach((warn) => lines.push(`    - ${warn}`));
  }

  return lines.join("\n");
}
