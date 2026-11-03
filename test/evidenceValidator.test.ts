import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMagicBytes,
  sanitizeFilename,
  MAX_FILES,
  MAX_FILE_SIZE
} from '../src/evidence/validator.js';

describe('Evidence Validation & Magic Byte Inspection', () => {
  test('detects valid PNG magic bytes', () => {
    // 89 50 4E 47 0D 0A 1A 0A
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    assert.equal(detectMagicBytes(pngHeader), 'image/png');
  });

  test('detects valid JPEG magic bytes', () => {
    // FF D8 FF
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    assert.equal(detectMagicBytes(jpegHeader), 'image/jpeg');
  });

  test('detects valid WebP magic bytes', () => {
    // 'RIFF' + 4 dummy bytes + 'WEBP'
    const webpHeader = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // file size
      0x57, 0x45, 0x42, 0x50  // WEBP
    ]);
    assert.equal(detectMagicBytes(webpHeader), 'image/webp');
  });

  test('detects valid PDF magic bytes', () => {
    // %PDF
    const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
    assert.equal(detectMagicBytes(pdfHeader), 'application/pdf');
  });

  test('rejects spoofed files (e.g. text file disguised as .png)', () => {
    const fakeFile = Buffer.from('Hello, I am a plain text file pretending to be image.png');
    assert.equal(detectMagicBytes(fakeFile), null);
  });

  test('rejects empty or truncated buffers', () => {
    const shortBuffer = Buffer.from([0x89, 0x50]);
    assert.equal(detectMagicBytes(shortBuffer), null);
  });

  test('sanitizes malicious filenames and prevents path traversal', () => {
    assert.equal(sanitizeFilename('../../etc/passwd.png'), 'passwd.png');
    assert.equal(sanitizeFilename('..\\..\\Windows\\System32\\calc.exe.png'), 'calc.exe.png');
    assert.equal(sanitizeFilename('normal-evidence_01.jpg'), 'normal-evidence_01.jpg');
    assert.equal(sanitizeFilename('screenshot with spaces & [symbols].png'), 'screenshot_with_spaces____symbols_.png');
  });

  test('enforces limits: max 5 files and 10MB per file', () => {
    assert.equal(MAX_FILES, 5);
    assert.equal(MAX_FILE_SIZE, 10 * 1024 * 1024);
  });
});
