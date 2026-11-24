import { isModelEntryPath, MODELS_PATH, parseJson, type Archive } from './parse';
import type { Replay, Vec3Tuple } from './types';

export const MAX_MODEL_BYTES = 50 * 1024 * 1024;
export const MAX_MODELS_BYTES = 300 * 1024 * 1024;

export interface ModelBinding {
  vesselId: string;
  file: string;
  scale: number;
  rotation: Vec3Tuple;
  offset: Vec3Tuple;
}

export interface ModelsFile {
  version: 1;
  models: ModelBinding[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec3(value: unknown): value is Vec3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function readRows(bytes: Uint8Array): unknown[] {
  const root = parseJson(bytes, MODELS_PATH);
  if (!isObject(root) || root['version'] !== 1 || !Array.isArray(root['models'])) {
    throw new Error('expected version 1 and a models array');
  }
  return root['models'];
}

function readBinding(value: unknown): ModelBinding {
  if (!isObject(value)) throw new Error('expected a model binding object');
  const { vesselId, file, scale, rotation, offset } = value;
  if (typeof vesselId !== 'string' || !vesselId.trim()) throw new Error('invalid vessel id');
  if (typeof file !== 'string' || !isModelEntryPath(file)) {
    throw new Error('invalid model path');
  }
  if (!isFiniteNumber(scale) || scale <= 0 || !isVec3(rotation) || !isVec3(offset)) {
    throw new Error('invalid model transform');
  }
  return { vesselId, file, scale, rotation, offset };
}

export function parseModelsFile(bytes: Uint8Array): ModelsFile {
  const seen = new Set<string>();
  const models = readRows(bytes).map(value => {
    const binding = readBinding(value);
    if (seen.has(binding.vesselId)) throw new Error('duplicate vessel id');
    seen.add(binding.vesselId);
    return binding;
  });
  return { version: 1, models };
}

export function serializeModelsFile(file: ModelsFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(file));
}

/** Optional rows are isolated so one broken override cannot hide the valid ones. */
export function readArchiveModels(
  archive: Archive,
  vesselIds: ReadonlySet<string>,
  warn: (path: string, detail: string) => void,
): Pick<Replay, 'models' | 'modelFiles'> {
  const models: ModelBinding[] = [];
  const modelFiles = new Map<string, Uint8Array>();
  const result = { models, modelFiles };
  for (const [path, detail] of archive.unreadableModels ?? []) warn(path, detail);
  const metadata = archive.entries.get(MODELS_PATH);
  if (!metadata) return result;

  let rows: unknown[];
  try {
    rows = readRows(metadata);
  } catch (error) {
    warn(MODELS_PATH, error instanceof Error ? error.message : String(error));
    return result;
  }

  const seen = new Set<string>();
  let total = 0;
  rows.forEach((row, index) => {
    try {
      const binding = readBinding(row);
      if (!vesselIds.has(binding.vesselId)) throw new Error('unknown vessel id');
      if (seen.has(binding.vesselId)) throw new Error('duplicate vessel id');
      if (!modelFiles.has(binding.file)) {
        const data = archive.entries.get(binding.file);
        if (archive.unreadableModels?.has(binding.file)) return;
        if (!data?.length) throw new Error('missing or empty model file');
        if (data.length > MAX_MODEL_BYTES) throw new Error('model exceeds 50 MB');
        if (total + data.length > MAX_MODELS_BYTES) throw new Error('models exceed 300 MB');
        modelFiles.set(binding.file, data);
        total += data.length;
      }
      seen.add(binding.vesselId);
      models.push(binding);
    } catch (error) {
      warn(`${MODELS_PATH}#models[${index}]`, error instanceof Error ? error.message : String(error));
    }
  });
  return result;
}
