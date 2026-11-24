import { describe, expect, it } from 'vitest';
import { parseModelsFile, serializeModelsFile } from '../src/format/models';
import { processParseRequest } from '../src/format/parseWorkerProtocol';
import { parseArchive } from '../src/format/validate';
import { buildArchive, defaultManifest, VESSEL_ID } from './helpers/archive';

const file = `models/${'a'.repeat(64)}.obj`;
const otherFile = `models/${'b'.repeat(64)}.stl`;
const binding = { vesselId: VESSEL_ID, file, scale: 2, rotation: [0, 90, 0] as const, offset: [1, 2, 3] as const };
const modelBytes = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function replay(metadata: unknown, entries: Record<string, Uint8Array> = { [file]: modelBytes }) {
  return parseArchive(buildArchive({
    manifest: { ...defaultManifest(), formatRevision: 4 },
    extraEntries: { 'models.json': json(metadata), ...entries },
  }));
}

describe('models.json', () => {
  it('round-trips a version 1 model binding', () => {
    expect(parseModelsFile(json({ version: 1, models: [binding] }))).toEqual({ version: 1, models: [binding] });
    expect(JSON.parse(new TextDecoder().decode(serializeModelsFile({ version: 1, models: [binding] }))))
      .toEqual({ version: 1, models: [binding] });
  });

  it('loads the binding without bumping the recording revision', () => {
    const result = replay({ version: 1, models: [binding] });
    expect(result.manifest.formatRevision).toBe(4);
    expect(result.models).toEqual([binding]);
    expect(result.modelFiles.get(file)).toEqual(modelBytes);
    expect(result.warnings.filter(w => w.code === 'optionalSection')).toEqual([]);
  });

  it('does not require models.json in older recordings', () => {
    const result = parseArchive(buildArchive());
    expect(result.models).toEqual([]);
    expect(result.warnings.filter(w => w.code === 'optionalSection')).toEqual([]);
  });

  it('warns and ignores the extension if the version is missing', () => {
    expect(() => parseModelsFile(json({ models: [binding] }))).toThrow();
    const result = replay({ models: [binding] });
    expect(result.models).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'optionalSection' }));
  });

  it.each([
    ['unknown vessel', { ...binding, vesselId: 'unknown-vessel' }],
    ['duplicate vessel', { ...binding, file: otherFile }],
    ['non-positive scale', { ...binding, scale: 0 }],
    ['non-numeric rotation', { ...binding, rotation: ['90', 0, 0] }],
    ['malformed offset', { ...binding, offset: [1, 2] }],
    ['unsafe path', { ...binding, file: 'models/../unrelated.obj' }],
  ])('warns and preserves the usable model when a binding has %s', (_name, invalid) => {
    const result = replay({ version: 1, models: [binding, invalid] }, { [file]: modelBytes, [otherFile]: modelBytes });
    expect(result.models).toEqual([binding]);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'optionalSection', params: expect.objectContaining({ path: 'models.json#models[1]' }),
    }));
  });

  it('warns and falls back when the referenced file is missing', () => {
    const result = replay({ version: 1, models: [binding] }, {});
    expect(result.models).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'optionalSection' }));
    expect(result.vessels[0]?.id).toBe(VESSEL_ID);
  });

  it.each(['models.json', file])('opens the recording if ZIP member %s cannot be decoded', path => {
    const archive = buildArchive({ extraEntries: {
      'models.json': json({ version: 1, models: [binding] }),
      [file]: modelBytes,
    } });
    // Simulate an unreadable member without changing any other ZIP entry.
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const end = archive.byteLength - 22;
    let entry = view.getUint32(end + 16, true);
    let found = false;
    for (let i = 0; i < view.getUint16(end + 10, true); i++) {
      const length = view.getUint16(entry + 28, true);
      if (new TextDecoder().decode(archive.subarray(entry + 46, entry + 46 + length)) === path) {
        view.setUint16(entry + 10, 99, true);
        found = true;
        break;
      }
      entry += 46 + length + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true);
    }
    expect(found).toBe(true);
    const result = parseArchive(archive);
    expect(result.models).toEqual([]);
    expect(result.vessels[0]?.id).toBe(VESSEL_ID);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'optionalSection', params: expect.objectContaining({ path }),
    }));
  });

  it('transfers the accepted model bytes along with the replay from the parse worker', () => {
    const archive = buildArchive({ extraEntries: {
      'models.json': json({ version: 1, models: [binding] }),
      [file]: modelBytes,
      [otherFile]: modelBytes,
    } });
    const { response, transfer } = processParseRequest({ bytes: Uint8Array.from(archive).buffer });
    if (!('replay' in response)) throw new Error('Expected a playable recording');
    expect([...response.replay.modelFiles.keys()]).toEqual([file]);
    expect(transfer).toContain(response.replay.modelFiles.get(file)?.buffer);
  });
});
