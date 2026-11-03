import { createHash } from 'node:crypto';

export interface ValidatedFile {
  buffer: Buffer;
  originalFilename: string;
  sanitizedFilename: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256Hash: string;
}

export interface AttachmentInput {
  url: string;
  filename: string;
  size?: number;
  contentType?: string | null;
}

export const MAX_FILES = 5;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Sanitizes a filename to prevent path traversal or malformed characters.
 */
export function sanitizeFilename(filename: string): string {
  // Strip path traversal and slashes
  const basename = filename.replace(/^.*[\\/]/, '');
  // Replace non-alphanumeric (except dot, dash, underscore)
  const cleaned = basename.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Avoid empty or hidden files
  if (!cleaned || cleaned.startsWith('.')) {
    return `evidence_${Date.now()}_file`;
  }
  return cleaned.slice(0, 100);
}

/**
 * Validates magic byte signatures from the first bytes of a buffer.
 * Returns the verified MIME type, or null if the signature is unsupported/invalid.
 */
export function detectMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 8) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 && // 'P'
    buffer[2] === 0x4e && // 'N'
    buffer[3] === 0x47 && // 'G'
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 && // 'RIFF'
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50 // 'WEBP'
  ) {
    return 'image/webp';
  }

  // PDF: %PDF (25 50 44 46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'application/pdf';
  }

  return null;
}

/**
 * In-memory validation and fetching of uploaded attachments.
 * Never persists buffers to disk.
 */
export async function validateAndFetchAttachments(
  attachments: AttachmentInput[]
): Promise<ValidatedFile[]> {
  if (attachments.length > MAX_FILES) {
    throw new Error(`Exceeded maximum allowed files. Allowed: ${MAX_FILES}, received: ${attachments.length}`);
  }

  const results: ValidatedFile[] = [];

  for (const att of attachments) {
    if (att.size && att.size > MAX_FILE_SIZE) {
      throw new Error(`File ${att.filename} exceeds maximum size of 10MB (${att.size} bytes).`);
    }

    // Download in-memory buffer via native fetch
    const response = await fetch(att.url);
    if (!response.ok) {
      throw new Error(`Failed to download ephemeral attachment ${att.filename}: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File ${att.filename} exceeds maximum size of 10MB (${buffer.length} bytes).`);
    }

    // Magic byte signature validation
    const detectedMimeType = detectMagicBytes(buffer);
    if (!detectedMimeType) {
      throw new Error(
        `File ${att.filename} has an invalid or unsupported file signature. Only verified PNG, JPEG, WebP, and PDF files are accepted.`
      );
    }

    // Compute SHA-256 for integrity verification
    const sha256Hash = createHash('sha256').update(buffer).digest('hex');
    const sanitizedFilename = sanitizeFilename(att.filename);

    results.push({
      buffer,
      originalFilename: att.filename,
      sanitizedFilename,
      detectedMimeType,
      sizeBytes: buffer.length,
      sha256Hash
    });
  }

  return results;
}
