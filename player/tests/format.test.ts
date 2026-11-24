import { describe, expect, it } from 'vitest';
import { FormatError } from '../src/format/parse';
import { parseArchive } from '../src/format/validate';
import { VESSEL_ID, buildArchive, defaultManifest, defaultTrack, sampleColumns } from './helpers/archive';

function expectError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(FormatError);
    expect((err as FormatError).code).toBe(code);
    return;
  }
  throw new Error(`expected FormatError ${code}`);
}

describe('parseArchive', () => {
  it('accepts a minimal valid archive', () => {
    const replay = parseArchive(buildArchive());
    expect(replay.manifest.generator.name).toBe('KerbTac Recorder');
    expect(replay.vessels).toHaveLength(1);
    const vessel = replay.vessels[0]!;
    expect(vessel.id).toBe(VESSEL_ID);
    expect(vessel.segments).toHaveLength(1);
    expect(vessel.segments[0]!.samples?.length).toBe(2);
    expect(replay.startUt).toBe(100);
    expect(replay.endUt).toBeCloseTo(100.1);
    expect(replay.events.map((e) => e.type)).toEqual(['flight_start', 'flight_end']);
    expect(replay.warnings).toHaveLength(0);
  });

  it('does not warn for kill events', () => {
    const replay = parseArchive(
      buildArchive({
        events: [
          { ut: 100, type: 'flight_start', vessel: VESSEL_ID },
          { ut: 100.1, type: 'kill', vessel: VESSEL_ID, source: 'attacker' },
        ],
      }),
    );
    expect(replay.warnings.some((warning) => warning.code === 'unknownEventType')).toBe(false);
  });

  it('accepts stored (uncompressed) entries', () => {
    const replay = parseArchive(buildArchive({ stored: true }));
    expect(replay.vessels[0]!.segments[0]!.samples?.length).toBe(2);
  });

  it('rejects a file that is not a ZIP', () => {
    expectError(() => parseArchive(new Uint8Array([1, 2, 3, 4])), 'notZip');
  });

  it('rejects unsupported format versions with the version number', () => {
    const manifest = { ...defaultManifest(), formatVersion: 2 };
    try {
      parseArchive(buildArchive({ manifest }));
      throw new Error('expected failure');
    } catch (err) {
      expect((err as FormatError).code).toBe('unsupportedVersion');
      expect((err as FormatError).params['version']).toBe(2);
    }
  });

  it('rejects a wrong format name', () => {
    const manifest = { ...defaultManifest(), format: 'other' };
    expectError(() => parseArchive(buildArchive({ manifest })), 'unsupportedFormat');
  });

  it('rejects a missing track entry', () => {
    expectError(
      () => parseArchive(buildArchive({ omit: [`vessels/${VESSEL_ID}.json`] })),
      'missingEntry',
    );
  });

  it('rejects unsafe entry names', () => {
    expectError(
      () => parseArchive(buildArchive({ extraEntries: { '../evil.json': new Uint8Array([1]) } })),
      'unsafePath',
    );
  });

  it('rejects a track id that does not match the manifest', () => {
    const track = { ...defaultTrack(), id: '11111111-2222-3333-4444-555555555555' };
    expectError(() => parseArchive(buildArchive({ track })), 'vesselIdMismatch');
  });

  it('rejects missing required sample columns', () => {
    const samples = sampleColumns([100, 100.1]);
    delete samples['alt'];
    const track = defaultTrack();
    (track['segments'] as Array<Record<string, unknown>>)[0]!['samples'] = samples;
    expectError(() => parseArchive(buildArchive({ track })), 'sampleShape');
  });

  it('rejects mismatched optional column lengths', () => {
    const samples = sampleColumns([100, 100.1]);
    samples['throttle'] = [0];
    const track = defaultTrack();
    (track['segments'] as Array<Record<string, unknown>>)[0]!['samples'] = samples;
    expectError(() => parseArchive(buildArchive({ track })), 'sampleLengthMismatch');
  });

  it('sorts unsorted samples and warns', () => {
    const samples = sampleColumns([100.1, 100]);
    samples['alt'] = [80, 70];
    const track = defaultTrack();
    (track['segments'] as Array<Record<string, unknown>>)[0]!['samples'] = samples;
    const replay = parseArchive(buildArchive({ track }));
    const table = replay.vessels[0]!.segments[0]!.samples!;
    expect(Array.from(table.t)).toEqual([100, 100.1]);
    expect(Array.from(table.alt)).toEqual([70, 80]);
    expect(replay.warnings.some((w) => w.code === 'unsortedSamples')).toBe(true);
  });

  it('clamps out-of-range latitude and warns', () => {
    const samples = sampleColumns([100, 100.1]);
    samples['lat'] = [95, -95];
    const track = defaultTrack();
    (track['segments'] as Array<Record<string, unknown>>)[0]!['samples'] = samples;
    const replay = parseArchive(buildArchive({ track }));
    const table = replay.vessels[0]!.segments[0]!.samples!;
    expect(Array.from(table.lat)).toEqual([90, -90]);
    expect(replay.warnings.some((w) => w.code === 'latLonClamped')).toBe(true);
  });

  it('normalizes non-unit quaternions', () => {
    const samples = sampleColumns([100, 100.1]);
    samples['q'] = [0, 0, 0, 2, 0, 0, 0, 1];
    const track = defaultTrack();
    (track['segments'] as Array<Record<string, unknown>>)[0]!['samples'] = samples;
    const replay = parseArchive(buildArchive({ track }));
    const q = replay.vessels[0]!.segments[0]!.samples!.q;
    expect(q[3]).toBeCloseTo(1, 6);
    expect(replay.warnings.some((w) => w.code === 'quatNormalized')).toBe(true);
  });

  it('sorts events by UT and keeps the written order for ties', () => {
    const events = [
      { ut: 100.2, type: 'note', data: { text: 'late' } },
      { ut: 100.0, type: 'note', data: { text: 'first' } },
      { ut: 100.0, type: 'note', data: { text: 'second' } },
    ];
    const replay = parseArchive(buildArchive({ events }));
    expect(replay.events.map((e) => e.data['text'])).toEqual(['first', 'second', 'late']);
  });

  it('reports no replayable vessels', () => {
    const track = defaultTrack();
    (track['segments'] as Array<Record<string, unknown>>)[0]!['samples'] = sampleColumns([100]);
    // Only one sample is still replayable, so make the segment empty instead.
    (track['segments'] as Array<Record<string, unknown>>)[0]!['samples'] = {
      ...sampleColumns([100]),
      t: [],
      lat: [],
      lon: [],
      alt: [],
      q: [],
    };
    expectError(() => parseArchive(buildArchive({ track })), 'emptySegment');
  });

  it('rejects a body referenced by a vessel but missing from bodies.json', () => {
    const track = { ...defaultTrack(), body: 'Mun' };
    expectError(() => parseArchive(buildArchive({ track })), 'unknownBody');
  });
});
