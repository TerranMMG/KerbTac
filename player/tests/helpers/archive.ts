// Test helper: builds a minimal but contract-valid .kerbtac archive in memory.

import { strToU8, zipSync } from 'fflate';

export const VESSEL_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

export interface TrackOverrides {
  id?: string;
  name?: string;
  type?: string;
  body?: string;
  segments?: unknown[];
}

export interface RecordingOptions {
  manifest?: Record<string, unknown>;
  bodies?: Record<string, unknown>;
  events?: unknown[];
  track?: TrackOverrides;
  omit?: string[];
  extraEntries?: Record<string, Uint8Array>;
  /** Store entries uncompressed to exercise the stored-ZIP path. */
  stored?: boolean;
}

export function sampleColumns(times: number[]): Record<string, unknown> {
  return {
    t: times,
    lat: times.map(() => 0),
    lon: times.map((_, i) => i * 0.001),
    alt: times.map(() => 70),
    q: times.flatMap(() => [0, 0, 0, 1]),
    vx: times.map(() => 0),
    vy: times.map(() => 0),
    vz: times.map(() => 0),
    throttle: times.map(() => 0),
    mass: times.map(() => 12000),
    g: times.map(() => 1),
    stage: times.map(() => 3),
    situation: times.map(() => 'LANDED'),
    hdg: times.map(() => 90),
    vs: times.map(() => 0),
    lf: times.map(() => 800),
    ox: times.map(() => 0),
    ec: times.map(() => 500),
    srfSpeed: times.map(() => 0),
  };
}

export function defaultTrack(): Record<string, unknown> {
  return {
    id: VESSEL_ID,
    name: 'Test Plane',
    type: 'Plane',
    body: 'Kerbin',
    segments: [
      {
        index: 0,
        kind: 'flight',
        body: 'Kerbin',
        startUt: 100,
        endUt: 100.1,
        source: 'active',
        samples: sampleColumns([100, 100.1]),
      },
    ],
  };
}

export function defaultManifest(): Record<string, unknown> {
  return {
    format: 'kerbtac',
    formatVersion: 1,
    generator: { name: 'KerbTac Recorder', version: '0.1.0' },
    game: { kspVersion: '1.12.5.3190', saveName: 'MNCS', scene: 'FLIGHT' },
    session: {
      id: '20261103T120000Z-abc123',
      name: 'Synthetic Test',
      startUt: 100,
      endUt: 100.1,
      startWall: '2026-11-03T12:00:00Z',
      endWall: '2026-11-03T12:00:00Z',
      duration: 0.1,
    },
    bodies: 'bodies.json',
    events: 'events.json',
    vessels: [
      {
        id: VESSEL_ID,
        name: 'Test Plane',
        type: 'Plane',
        body: 'Kerbin',
        color: '#4fc3f7',
        team: null,
        rootPart: 'mk2Cockpit_Standard',
        partCount: 42,
        crewCount: 1,
        track: `vessels/${VESSEL_ID}.json`,
      },
    ],
  };
}

export function defaultBodies(): Record<string, unknown> {
  return {
    Kerbin: {
      name: 'Kerbin',
      parent: null,
      radius: 600000,
      gravParameter: 3531600000000,
      atmosphereDepth: 70000,
      sphereOfInfluence: 84159286,
      rotation: { epochUt: 0, q0: [0, 0, 0, 1], axis: [0, 1, 0], rateDegPerSec: 0.0167083333 },
      orbit: null,
      style: 'kerbin',
    },
  };
}

export function defaultEvents(): unknown[] {
  return [
    { ut: 100, type: 'flight_start', vessel: VESSEL_ID, body: 'Kerbin', lat: 0, lon: 0, alt: 70, data: { reason: 'manual' } },
    { ut: 100.1, type: 'flight_end', vessel: VESSEL_ID, data: { reason: 'manual', duration: 0.1 } },
  ];
}

export function buildArchive(options: RecordingOptions = {}): Uint8Array {
  const manifest = options.manifest ?? defaultManifest();
  const bodies = options.bodies ?? defaultBodies();
  const events = options.events ?? defaultEvents();
  const track = { ...defaultTrack(), ...(options.track ?? {}) };
  const omit = new Set(options.omit ?? []);

  const files: Record<string, Uint8Array> = {};
  const add = (path: string, value: unknown): void => {
    if (!omit.has(path)) files[path] = strToU8(JSON.stringify(value));
  };

  add('manifest.json', manifest);
  add('bodies.json', bodies);
  add('events.json', events);
  add(`vessels/${VESSEL_ID}.json`, track);
  for (const [path, data] of Object.entries(options.extraEntries ?? {})) files[path] = data;

  return zipSync(files, { level: options.stored ? 0 : 6 });
}
