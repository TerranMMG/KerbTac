// Low-level archive access: ZIP container handling and UTF-8 JSON decoding.
// All size and path checks from docs/format-v1.md §2.2/§2.3/§10 live here.

import { unzipSync } from 'fflate';
import type { ErrorCode } from './types';

export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_ENTRIES = 10_000;
export const MODELS_PATH = 'models.json';

export function isModelEntryPath(path: string): boolean {
  return /^models\/[0-9a-f]{64}\.(obj|stl)$/.test(path);
}

export class FormatError extends Error {
  readonly code: ErrorCode;
  readonly params: Record<string, string | number>;

  constructor(code: ErrorCode, params: Record<string, string | number> = {}) {
    super(`${code} ${JSON.stringify(params)}`);
    this.name = 'FormatError';
    this.code = code;
    this.params = params;
  }
}

export interface Archive {
  entries: Map<string, Uint8Array>;
  totalBytes: number;
  unreadableModels?: Map<string, string>;
}

export function isZipHeader(data: Uint8Array): boolean {
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) return false;
  const a = data[2];
  const b = data[3];
  // Local file header 03 04, or empty archive end-of-central-directory 05 06.
  return (a === 0x03 && b === 0x04) || (a === 0x05 && b === 0x06);
}

/** Rejects absolute paths, `..` segments, backslashes, and drive letters. */
export function isSafeEntryPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes('\\')) return false;
  if (path.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return false;
  }
  return true;
}

export function readArchive(bytes: Uint8Array): Archive {
  if (!isZipHeader(bytes)) throw new FormatError('notZip');

  let entryCount = 0;
  let declaredTotal = 0;
  const optional = new Set<string>();
  const unreadableModels = new Map<string, string>();
  const optionalEntry = (name: string) => name === MODELS_PATH || isModelEntryPath(name);
  const detail = (err: unknown) => err instanceof Error ? err.message : String(err);
  const countEntry = (file: { name: string; originalSize: number }) => {
    entryCount += 1;
    declaredTotal += file.originalSize;
    if (!isSafeEntryPath(file.name)) throw new FormatError('unsafePath', { path: file.name });
    if (entryCount > MAX_ENTRIES) throw new FormatError('tooManyEntries', { count: entryCount });
    if (declaredTotal > MAX_TOTAL_BYTES) throw new FormatError('archiveTooLarge', { size: declaredTotal });
    if (file.originalSize > MAX_ENTRY_BYTES) {
      throw new FormatError('entryTooLarge', { path: file.name, size: file.originalSize });
    }
    const isOptional = optionalEntry(file.name);
    if (isOptional) optional.add(file.name);
    return isOptional;
  };
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter(file) {
        countEntry(file);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof FormatError) throw err;
    if (!optional.size) throw new FormatError('zipError', { detail: detail(err) });

    // fflate's synchronous extractor fails the entire batch. Retry only on
    // error, retaining the normal single pass for sound archives.
    optional.clear();
    entryCount = declaredTotal = 0;
    try {
      entries = unzipSync(bytes, { filter: file => !countEntry(file) });
    } catch (requiredError) {
      if (requiredError instanceof FormatError) throw requiredError;
      throw new FormatError('zipError', { detail: detail(requiredError) });
    }
    function recover(paths: string[]): void {
      const wanted = new Set(paths);
      try {
        Object.assign(entries, unzipSync(bytes, { filter: file => wanted.has(file.name) }));
      } catch (optionalError) {
        if (paths.length === 1) unreadableModels.set(paths[0]!, detail(optionalError));
        else {
          const middle = Math.floor(paths.length / 2);
          recover(paths.slice(0, middle));
          recover(paths.slice(middle));
        }
      }
    }
    recover([...optional]);
  }

  const map = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const [name, data] of Object.entries(entries)) {
    if (!isSafeEntryPath(name)) throw new FormatError('unsafePath', { path: name });
    if (data.length > MAX_ENTRY_BYTES) {
      throw new FormatError('entryTooLarge', { path: name, size: data.length });
    }
    totalBytes += data.length;
    // Ignore directory markers and anything that is not a regular file entry.
    if (name.endsWith('/')) continue;
    map.set(name, data);
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new FormatError('archiveTooLarge', { size: totalBytes });
  }
  return { entries: map, totalBytes, ...(unreadableModels.size ? { unreadableModels } : {}) };
}

export function requireEntry(archive: Archive, path: string): Uint8Array {
  const entry = archive.entries.get(path);
  if (!entry) throw new FormatError('missingEntry', { path });
  return entry;
}

export function decodeUtf8(data: Uint8Array, path: string): string {
  let text: string;
  try {
    // `fatal` turns malformed byte sequences into an error instead of U+FFFD.
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new FormatError('badJson', { path, detail: 'invalid UTF-8' });
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

export function parseJson(data: Uint8Array, path: string): unknown {
  const text = decodeUtf8(data, path);
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new FormatError('badJson', {
      path,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
