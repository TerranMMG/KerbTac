// Validation and normalization of a .kerbtac archive.
// Implements docs/format-v1.md §10. Recoverable problems become warnings and
// are repaired; contract violations throw FormatError with a message code.

import { FormatError, isSafeEntryPath, parseJson, readArchive, requireEntry } from './parse';
import { readArchiveModels } from './models';
import type {
  ActorTrack,
  CelestialBodyDef,
  ChapterInfo,
  EffectEvent,
  JsonValue,
  ManifestSummary,
  MissionInfo,
  OrbitBodyRotation,
  OrbitElements,
  QuatTuple,
  RadarLock,
  Replay,
  ReplayEvent,
  ReplayWarning,
  SampleTable,
  SegmentKind,
  SessionGap,
  SessionManifest,
  ThreatRanges,
  TrackSegment,
  Vec3Tuple,
  VesselTrack,
  WarningCode,
} from './types';

const SUPPORTED_FORMAT_VERSION = 1;
const VALID_SEGMENT_KINDS: readonly SegmentKind[] = ['flight', 'surface', 'orbit', 'static'];

type Obj = Record<string, unknown>;

function isRecord(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: ConstructorParameters<typeof FormatError>[0], path: string, expected?: string): never {
  throw new FormatError(code, expected ? { path, expected } : { path });
}

function record(value: unknown, path: string, code: ConstructorParameters<typeof FormatError>[0] = 'manifestShape'): Obj {
  if (!isRecord(value)) fail(code, path, 'object');
  return value;
}

function str(value: unknown, path: string, code: ConstructorParameters<typeof FormatError>[0] = 'manifestShape'): string {
  if (typeof value !== 'string') fail(code, path, 'string');
  return value;
}

function optStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown, path: string, code: ConstructorParameters<typeof FormatError>[0] = 'manifestShape'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(code, path, 'finite number');
  return value;
}

function optNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function array(value: unknown, path: string, code: ConstructorParameters<typeof FormatError>[0] = 'manifestShape'): unknown[] {
  if (!Array.isArray(value)) fail(code, path, 'array');
  return value;
}

function tuple3(value: unknown, path: string, code: ConstructorParameters<typeof FormatError>[0]): Vec3Tuple {
  const arr = array(value, path, code);
  if (arr.length !== 3) fail(code, path, '3 numbers');
  return [num(arr[0], `${path}[0]`, code), num(arr[1], `${path}[1]`, code), num(arr[2], `${path}[2]`, code)];
}

function tuple4(value: unknown, path: string, code: ConstructorParameters<typeof FormatError>[0]): QuatTuple {
  const arr = array(value, path, code);
  if (arr.length !== 4) fail(code, path, '4 numbers');
  return [
    num(arr[0], `${path}[0]`, code),
    num(arr[1], `${path}[1]`, code),
    num(arr[2], `${path}[2]`, code),
    num(arr[3], `${path}[3]`, code),
  ];
}

function readOrbitBodyRotation(value: unknown): OrbitBodyRotation | null {
  if (!isRecord(value) || value['kind'] !== 'ksp-zup-spin-v1') return null;
  const epochUt = optNum(value['epochUt']);
  const angleDeg = optNum(value['angleDeg']);
  const rateDegPerSec = optNum(value['rateDegPerSec']);
  if (epochUt === null || angleDeg === null || rateDegPerSec === null) return null;
  return { kind: 'ksp-zup-spin-v1', epochUt, angleDeg, rateDegPerSec };
}

function readOrbit(value: unknown, path: string, vesselOrbit = false): OrbitElements | null {
  if (value === undefined || value === null) return null;
  const o = record(value, path, 'bodiesShape');
  return {
    epoch: num(o['epoch'], `${path}.epoch`, 'bodiesShape'),
    semiMajorAxis: num(o['semiMajorAxis'], `${path}.semiMajorAxis`, 'bodiesShape'),
    eccentricity: num(o['eccentricity'], `${path}.eccentricity`, 'bodiesShape'),
    inclinationDeg: num(o['inclinationDeg'], `${path}.inclinationDeg`, 'bodiesShape'),
    lanDeg: num(o['lanDeg'], `${path}.lanDeg`, 'bodiesShape'),
    argPeDeg: num(o['argPeDeg'], `${path}.argPeDeg`, 'bodiesShape'),
    meanAnomalyDeg: num(o['meanAnomalyDeg'], `${path}.meanAnomalyDeg`, 'bodiesShape'),
    ...(vesselOrbit && Object.hasOwn(o, 'bfRotation') ? { bfRotation: readOrbitBodyRotation(o['bfRotation']) } : {}),
  };
}

// ---------------------------------------------------------------------------
// manifest.json
// ---------------------------------------------------------------------------

function normalizeSide(value: unknown): 'blue' | 'red' | 'neutral' {
  return value === 'blue' || value === 'red' ? value : 'neutral';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readMission(value: unknown): MissionInfo | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return null;
  return {
    title: optStr(value['title']) ?? '',
    category: optStr(value['category']),
    briefing: optStr(value['briefing']),
    debriefing: optStr(value['debriefing']),
    theater: optStr(value['theater']),
    author: optStr(value['author']),
    tags: readStringArray(value['tags']),
    notes: optStr(value['notes']),
  };
}

function readGaps(value: unknown): SessionGap[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  const out: SessionGap[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const startUt = optNum(entry['startUt']);
    const endUt = optNum(entry['endUt']);
    if (startUt === null || endUt === null || endUt < startUt) continue;
    out.push({ startUt, endUt, reason: optStr(entry['reason']) });
  }
  return out;
}

function readChapters(value: unknown): ChapterInfo[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  const out: ChapterInfo[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (!isRecord(entry)) continue;
    const startUt = optNum(entry['startUt']);
    const endUt = optNum(entry['endUt']);
    if (startUt === null || endUt === null || endUt < startUt) continue;
    out.push({
      id: optStr(entry['id']) ?? `ch${i}`,
      name: optStr(entry['name']) ?? `Chapter ${i + 1}`,
      startUt,
      endUt,
      reason: optStr(entry['reason']),
    });
  }
  return out;
}

function readRecordingMode(value: unknown): 'combat' | 'space' | null {
  if (value === 'space') return 'space';
  if (value === 'combat') return 'combat';
  return null;
}

function readThreat(value: unknown, path: string): ThreatRanges | null {
  if (value === undefined || value === null) return null;
  const o = record(value, path);
  return {
    missileRangeM: Math.max(0, optNum(o['missileRangeM']) ?? 0),
    radarRangeM: Math.max(0, optNum(o['radarRangeM']) ?? 0),
    threatRadiusM: Math.max(0, optNum(o['threatRadiusM']) ?? 0),
  };
}

function readManifest(value: unknown): SessionManifest {
  const root = record(value, 'manifest.json');
  if (root['format'] !== 'kerbtac') {
    throw new FormatError('unsupportedFormat', { format: String(root['format'] ?? '') });
  }
  const rawVersion = root['formatVersion'];
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion)) {
    fail('manifestShape', 'manifest.formatVersion', 'integer');
  }
  if (rawVersion > SUPPORTED_FORMAT_VERSION) {
    throw new FormatError('unsupportedVersion', { version: rawVersion, supported: SUPPORTED_FORMAT_VERSION });
  }
  if (rawVersion < 1) fail('manifestShape', 'manifest.formatVersion', '>= 1');

  // v1 fixes these entry names; reject a manifest that points elsewhere so a
  // crafted archive cannot redirect reads.
  if (root['bodies'] !== undefined && root['bodies'] !== 'bodies.json') {
    fail('manifestShape', 'manifest.bodies', '"bodies.json"');
  }
  if (root['events'] !== undefined && root['events'] !== 'events.json') {
    fail('manifestShape', 'manifest.events', '"events.json"');
  }
  for (const [key, expected] of [
    ['actors', 'actors.json'],
    ['effects', 'effects.json'],
    ['locks', 'locks.json'],
    ['summary', 'summary.json'],
  ] as const) {
    if (root[key] !== undefined && root[key] !== expected) {
      fail('manifestShape', `manifest.${key}`, `"${expected}"`);
    }
  }

  const generator = record(root['generator'], 'manifest.generator');
  const game = record(root['game'], 'manifest.game', 'manifestShape');
  const session = record(root['session'], 'manifest.session');

  const startUt = num(session['startUt'], 'manifest.session.startUt');
  const endUt = num(session['endUt'], 'manifest.session.endUt');
  if (startUt > endUt) fail('manifestShape', 'manifest.session.startUt', 'startUt <= endUt');

  const rawVessels = array(root['vessels'], 'manifest.vessels');
  const vessels: ManifestSummary[] = rawVessels.map((entry, i) => {
    const path = `manifest.vessels[${i}]`;
    const v = record(entry, path);
    const color = optStr(v['color']);
    return {
      id: str(v['id'], `${path}.id`),
      name: str(v['name'], `${path}.name`),
      type: str(v['type'], `${path}.type`),
      body: str(v['body'], `${path}.body`),
      color: color !== null && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null,
      team: optStr(v['team']),
      rootPart: optStr(v['rootPart']),
      partCount: optInt(v['partCount']),
      crewCount: optInt(v['crewCount']),
      side: normalizeSide(v['side']),
      callsign: optStr(v['callsign']),
      kind: optStr(v['kind']) ?? 'unknown',
      health: optNum(v['health']) ?? 1,
      loadout: readStringArray(v['loadout']),
      role: optStr(v['role']),
      parentId: optStr(v['parentId']),
      stageIndex: optInt(v['stageIndex']),
      separatedUt: optNum(v['separatedUt']),
      modelRole: optStr(v['modelRole']),
      threat: readThreat(v['threat'], `${path}.threat`),
      track: str(v['track'], `${path}.track`),
    };
  });

  return {
    format: 'kerbtac',
    formatVersion: rawVersion,
    formatRevision: optInt(root['formatRevision']) ?? 1,
    mission: readMission(root['mission']),
    generator: {
      name: str(generator['name'], 'manifest.generator.name'),
      version: str(generator['version'], 'manifest.generator.version'),
    },
    game: {
      kspVersion: str(game['kspVersion'], 'manifest.game.kspVersion'),
      unityVersion: optStr(game['unityVersion']),
      saveName: optStr(game['saveName']),
      scene: optStr(game['scene']),
    },
    session: {
      id: str(session['id'], 'manifest.session.id'),
      name: optStr(session['name']),
      startUt,
      endUt,
      startWall: optStr(session['startWall']),
      endWall: optStr(session['endWall']),
      duration: optNum(session['duration']),
      ut0: optNum(session['ut0']),
      recordingMode: readRecordingMode(session['recordingMode']),
      gaps: readGaps(session['gaps']),
      chapters: readChapters(session['chapters']),
    },
    vessels,
    actors: root['actors'] === undefined ? null : 'actors.json',
    effects: root['effects'] === undefined ? null : 'effects.json',
    locks: root['locks'] === undefined ? null : 'locks.json',
    summary: root['summary'] === undefined ? null : 'summary.json',
  };
}

// ---------------------------------------------------------------------------
// bodies.json
// ---------------------------------------------------------------------------

function readBodies(value: unknown): Map<string, CelestialBodyDef> {
  const root = record(value, 'bodies.json', 'bodiesShape');
  const bodies = new Map<string, CelestialBodyDef>();

  for (const [key, raw] of Object.entries(root)) {
    const path = `bodies.${key}`;
    const o = record(raw, path, 'bodiesShape');
    const name = optStr(o['name']) ?? key;
    if (name !== key) fail('bodiesShape', `${path}.name`, `"${key}"`);
    const radius = num(o['radius'], `${path}.radius`, 'bodiesShape');
    const mu = num(o['gravParameter'], `${path}.gravParameter`, 'bodiesShape');
    if (radius <= 0) fail('bodiesShape', `${path}.radius`, '> 0');
    if (mu <= 0) fail('bodiesShape', `${path}.gravParameter`, '> 0');

    const rotation = record(o['rotation'], `${path}.rotation`, 'bodiesShape');
    const parent = o['parent'] === null || o['parent'] === undefined ? null : str(o['parent'], `${path}.parent`, 'bodiesShape');

    bodies.set(key, {
      name,
      parent,
      radius,
      gravParameter: mu,
      atmosphereDepth: Math.max(0, optNum(o['atmosphereDepth']) ?? 0),
      sphereOfInfluence: optNum(o['sphereOfInfluence']),
      rotation: {
        epochUt: num(rotation['epochUt'], `${path}.rotation.epochUt`, 'bodiesShape'),
        q0: tuple4(rotation['q0'], `${path}.rotation.q0`, 'bodiesShape'),
        axis: tuple3(rotation['axis'], `${path}.rotation.axis`, 'bodiesShape'),
        rateDegPerSec: num(rotation['rateDegPerSec'], `${path}.rotation.rateDegPerSec`, 'bodiesShape'),
      },
      orbit: readOrbit(o['orbit'], `${path}.orbit`),
      style: optStr(o['style']),
    });
  }

  const roots = [...bodies.values()].filter((b) => b.parent === null);
  if (roots.length === 0) throw new FormatError('rootBodyMissing');

  // Every parent reference must resolve, and every chain must terminate.
  for (const body of bodies.values()) {
    const seen = new Set<string>();
    let cursor: CelestialBodyDef | undefined = body;
    while (cursor && cursor.parent !== null) {
      if (seen.has(cursor.name)) fail('bodiesShape', `bodies.${body.name}.parent`, 'acyclic');
      seen.add(cursor.name);
      const parentName: string = cursor.parent;
      const parent = bodies.get(parentName);
      if (!parent) throw new FormatError('unknownBody', { body: parentName, referencedBy: cursor.name });
      cursor = parent;
    }
  }
  return bodies;
}

function assertBodyExists(bodies: Map<string, CelestialBodyDef>, name: string, path: string): void {
  if (!bodies.has(name)) throw new FormatError('unknownBody', { body: name, path });
}

// ---------------------------------------------------------------------------
// events.json
// ---------------------------------------------------------------------------

function readJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('eventShape', path, 'finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => readJsonValue(item, `${path}[${i}]`));
  if (isRecord(value)) {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = readJsonValue(v, `${path}.${k}`);
    return out;
  }
  fail('eventShape', path, 'JSON value');
}

function readEvents(value: unknown, warn: (code: WarningCode, params: Record<string, string | number>) => void): ReplayEvent[] {
  const raw = array(value, 'events.json', 'eventsShape');
  const events: ReplayEvent[] = raw.map((entry, i) => {
    const path = `events[${i}]`;
    const o = record(entry, path, 'eventShape');
    const type = str(o['type'], `${path}.type`, 'eventShape');
    const data: Record<string, JsonValue> = {};
    if (isRecord(o['data'])) {
      for (const [k, v] of Object.entries(o['data'])) data[k] = readJsonValue(v, `${path}.data.${k}`);
    }
    if (!KNOWN_EVENT_TYPES.has(type)) warn('unknownEventType', { type });
    return {
      ut: num(o['ut'], `${path}.ut`, 'eventShape'),
      type,
      vessel: optStr(o['vessel']),
      target: optStr(o['target']),
      body: optStr(o['body']),
      lat: optNum(o['lat']),
      lon: optNum(o['lon']),
      alt: optNum(o['alt']),
      source: optStr(o['source']),
      weapon: optStr(o['weapon']),
      outcome: optStr(o['outcome']),
      range: optNum(o['range']),
      aspect: optNum(o['aspect']),
      damage: optNum(o['damage']),
      data,
    };
  });

  // Stable sort by UT; equal timestamps keep the written order.
  return events
    .map((event, order) => ({ event, order }))
    .sort((a, b) => a.event.ut - b.event.ut || a.order - b.order)
    .map((item) => item.event);
}

const KNOWN_EVENT_TYPES = new Set([
  'flight_start',
  'flight_end',
  'takeoff',
  'touchdown',
  'landing',
  'gear_up',
  'gear_down',
  'stage',
  'engine_ignition',
  'engine_shutdown',
  'crash',
  'destroyed',
  'soi_change',
  'scene_exit',
  'note',
  'decouple',
  'undock',
  'dock',
  'vessel_split',
  'vessel_merge',
  'weapon_release',
  'hit',
  'proximity_detonation',
  'gunfire',
  'countermeasure',
  'target_lock',
  'parachute_deploy',
  'parachute_cut',
  'fairing_jettison',
  'cargo_bay',
  'light',
  'rcs',
  'time_jump',
  'revert',
  'quickload',
  'recovery',
  'impact',
  'proximity_detonation',
  'miss',
  'kill',
  'chaff',
  'flare',
  'shrapnel',
  'team_change',
  'engine_mode_change',
]);

// ---------------------------------------------------------------------------
// vessels/<id>.json
// ---------------------------------------------------------------------------

interface ColumnReader {
  count: number;
  path: string;
  code: 'sampleShape' | 'sampleLengthMismatch';
}

function optFloatColumn(samples: Obj, name: string, ctx: ColumnReader): Float32Array | null {
  const raw = samples[name];
  if (raw === undefined) return null;
  const arr = array(raw, `${ctx.path}.${name}`, ctx.code);
  if (arr.length !== ctx.count) throw new FormatError('sampleLengthMismatch', { path: `${ctx.path}.${name}`, expected: ctx.count, got: arr.length });
  const out = new Float32Array(ctx.count);
  let known = false;
  for (let i = 0; i < arr.length; i++) {
    const value = arr[i];
    if (value === null) {
      out[i] = NaN;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new FormatError('sampleNonFinite', { path: `${ctx.path}.${name}[${i}]` });
    }
    out[i] = value;
    if (!Number.isFinite(out[i])) throw new FormatError('sampleNonFinite', { path: `${ctx.path}.${name}[${i}]` });
    known = true;
  }
  return known ? out : null;
}

function optDoubleColumn(samples: Obj, name: string, ctx: ColumnReader): Float64Array | null {
  const raw = samples[name];
  if (raw === undefined) return null;
  const arr = array(raw, `${ctx.path}.${name}`, ctx.code);
  if (arr.length !== ctx.count) throw new FormatError('sampleLengthMismatch', { path: `${ctx.path}.${name}`, expected: ctx.count, got: arr.length });
  const out = new Float64Array(ctx.count);
  for (let i = 0; i < arr.length; i++) {
    const value = arr[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new FormatError('sampleNonFinite', { path: `${ctx.path}.${name}[${i}]` });
    }
    out[i] = value;
  }
  return out;
}

function optStageColumn(samples: Obj, ctx: ColumnReader): Float64Array | null {
  const raw = samples['stage'];
  if (raw === undefined) return null;
  const arr = array(raw, `${ctx.path}.stage`, ctx.code);
  if (arr.length !== ctx.count) throw new FormatError('sampleLengthMismatch', { path: `${ctx.path}.stage`, expected: ctx.count, got: arr.length });
  const out = new Float64Array(ctx.count);
  let known = false;
  for (let i = 0; i < arr.length; i++) {
    const value = arr[i];
    if (value === null) {
      out[i] = NaN;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new FormatError('sampleNonFinite', { path: `${ctx.path}.stage[${i}]` });
    }
    out[i] = Math.trunc(value);
    known = true;
  }
  return known ? out : null;
}

function readSamples(
  value: unknown,
  path: string,
  warn: (code: WarningCode, params: Record<string, string | number>) => void,
  allowMissingQ = false,
): SampleTable {
  const o = record(value, path, 'sampleShape');
  const tRaw = array(o['t'], `${path}.t`, 'sampleShape');
  const n = tRaw.length;
  if (n === 0) throw new FormatError('emptySegment', { path });
  const ctx: ColumnReader = { count: n, path, code: 'sampleLengthMismatch' };

  const t = optDoubleColumn(o, 't', ctx);
  const lat = optDoubleColumn(o, 'lat', ctx);
  const lon = optDoubleColumn(o, 'lon', ctx);
  const alt = optDoubleColumn(o, 'alt', ctx);
  if (!t || !lat || !lon || !alt) fail('sampleShape', path, 't/lat/lon/alt columns');

  let qArr: ArrayLike<number>
  if (o['q'] === undefined && allowMissingQ) {
    const identity = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) identity[i * 4 + 3] = 1
    qArr = identity
  } else {
    qArr = array(o['q'], `${path}.q`, 'sampleShape') as unknown as ArrayLike<number>
    if (qArr.length !== n * 4) throw new FormatError('sampleLengthMismatch', { path: `${path}.q`, expected: n * 4, got: qArr.length })
  }

  // Sort by time when needed, keeping every column in step. KSP writes samples
  // monotonically, but hand-edited or merged files may not.
  let sorted = true;
  for (let i = 1; i < n; i++) {
    if (!(t[i - 1] < t[i])) {
      sorted = false;
      break;
    }
  }

  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  if (!sorted) {
    indices.sort((a, b) => t[a] - t[b] || a - b);
    let duplicates = 0;
    for (let i = 1; i < n; i++) if (t[indices[i]] === t[indices[i - 1]]) duplicates += 1;
    warn(duplicates > 0 ? 'duplicateSampleTime' : 'unsortedSamples', { path, count: n, duplicates });
  }

  const outT = new Float64Array(n);
  const outLat = new Float64Array(n);
  const outLon = new Float64Array(n);
  const outAlt = new Float64Array(n);
  const outQ = new Float32Array(n * 4);
  let quatNonUnit = 0;
  let clamped = 0;

  for (let dst = 0; dst < n; dst++) {
    const src = indices[dst];
    outT[dst] = t[src];
    let la = lat[src];
    let lo = lon[src];
    if (la < -90 || la > 90) {
      la = Math.max(-90, Math.min(90, la));
      clamped += 1;
    }
    if (lo < -180 || lo > 180) {
      // Wrap into [-180, 180).
      lo = ((((lo + 180) % 360) + 360) % 360) - 180;
      clamped += 1;
    }
    outLat[dst] = la;
    outLon[dst] = lo;
    outAlt[dst] = alt[src];

    let qx = qArr[src * 4] as number;
    let qy = qArr[src * 4 + 1] as number;
    let qz = qArr[src * 4 + 2] as number;
    let qw = qArr[src * 4 + 3] as number;
    for (const component of [qx, qy, qz, qw]) {
      if (typeof component !== 'number' || !Number.isFinite(component)) {
        throw new FormatError('sampleNonFinite', { path: `${path}.q[${src * 4}]` });
      }
    }
    const lengthSq = qx * qx + qy * qy + qz * qz + qw * qw;
    if (!(lengthSq > 1e-12) || !Number.isFinite(lengthSq)) {
      qx = 0;
      qy = 0;
      qz = 0;
      qw = 1;
    } else {
      const inv = 1 / Math.sqrt(lengthSq);
      if (Math.abs(lengthSq - 1) > 0.02) quatNonUnit += 1;
      qx *= inv;
      qy *= inv;
      qz *= inv;
      qw *= inv;
    }
    outQ[dst * 4] = qx;
    outQ[dst * 4 + 1] = qy;
    outQ[dst * 4 + 2] = qz;
    outQ[dst * 4 + 3] = qw;
  }

  if (clamped > 0) warn('latLonClamped', { path, count: clamped });
  if (quatNonUnit > 0) warn('quatNormalized', { path, count: quatNonUnit });

  // Optional columns keep their original order in the common case.
  const reordered = <T extends Float32Array | Float64Array>(col: T | null): T | null => {
    if (sorted || !col) return col;
    const out = new (col.constructor as new (len: number) => T)(n);
    for (let dst = 0; dst < n; dst++) out[dst] = col[indices[dst]];
    return out;
  };

  const stage = optStageColumn(o, ctx);
  const situationRaw = o['situation'];
  let situation: (string | null)[] | null = null;
  if (situationRaw !== undefined) {
    const arr = array(situationRaw, `${path}.situation`, 'sampleShape');
    if (arr.length !== n) throw new FormatError('sampleLengthMismatch', { path: `${path}.situation`, expected: n, got: arr.length });
    situation = new Array<string | null>(n);
    for (let dst = 0; dst < n; dst++) {
      const value = arr[indices[dst]];
      situation[dst] = typeof value === 'string' ? value : null;
    }
    if (!situation.some(value => value !== null)) situation = null;
  }

  return {
    length: n,
    t: outT,
    lat: outLat,
    lon: outLon,
    alt: outAlt,
    q: outQ,
    vx: reordered(optFloatColumn(o, 'vx', ctx)),
    vy: reordered(optFloatColumn(o, 'vy', ctx)),
    vz: reordered(optFloatColumn(o, 'vz', ctx)),
    throttle: reordered(optFloatColumn(o, 'throttle', ctx)),
    mass: reordered(optFloatColumn(o, 'mass', ctx)),
    gee: reordered(optFloatColumn(o, 'g', ctx)),
    stage: reordered(stage),
    situation,
    hdg: reordered(optFloatColumn(o, 'hdg', ctx)),
    vs: reordered(optFloatColumn(o, 'vs', ctx)),
    lf: reordered(optFloatColumn(o, 'lf', ctx)),
    ox: reordered(optFloatColumn(o, 'ox', ctx)),
    ec: reordered(optFloatColumn(o, 'ec', ctx)),
    mp: reordered(optFloatColumn(o, 'mp', ctx)),
    srfSpeed: reordered(optFloatColumn(o, 'srfSpeed', ctx)),
    ias: reordered(optFloatColumn(o, 'ias', ctx)),
    mach: reordered(optFloatColumn(o, 'mach', ctx)),
    aoa: reordered(optFloatColumn(o, 'aoa', ctx)),
    aos: reordered(optFloatColumn(o, 'aos', ctx)),
    agl: reordered(optFloatColumn(o, 'agl', ctx)),
    dynPress: reordered(optFloatColumn(o, 'dynPress', ctx)),
    pitch: reordered(optFloatColumn(o, 'pitch', ctx)),
    roll: reordered(optFloatColumn(o, 'roll', ctx)),
    yaw: reordered(optFloatColumn(o, 'yaw', ctx)),
    gear: reordered(optFloatColumn(o, 'gear', ctx)),
    flaps: reordered(optFloatColumn(o, 'flaps', ctx)),
    brakes: reordered(optFloatColumn(o, 'brakes', ctx)),
    health: reordered(optFloatColumn(o, 'health', ctx)),
  };
}

function readSegment(
  value: unknown,
  path: string,
  bodies: Map<string, CelestialBodyDef>,
  warn: (code: WarningCode, params: Record<string, string | number>) => void,
): TrackSegment {
  const o = record(value, path, 'segmentShape');
  const rawKind = str(o['kind'], `${path}.kind`, 'segmentShape');
  let kind: SegmentKind;
  if ((VALID_SEGMENT_KINDS as readonly string[]).includes(rawKind)) {
    kind = rawKind as SegmentKind;
  } else {
    kind = 'static';
    warn('unknownSegmentKind', { path, kind: rawKind });
  }

  const body = str(o['body'], `${path}.body`, 'segmentShape');
  assertBodyExists(bodies, body, `${path}.body`);

  const startUt = num(o['startUt'], `${path}.startUt`, 'segmentShape');
  const endUt = num(o['endUt'], `${path}.endUt`, 'segmentShape');
  if (startUt > endUt) fail('segmentShape', path, 'startUt <= endUt');

  const index = num(o['index'], `${path}.index`, 'segmentShape');
  // v1 has no chunk metadata: every segment is then an independent logical
  // segment, which preserves the old behaviour exactly.
  const logicalIndex = optNum(o['logicalIndex']) ?? index;
  const chunkIndex = optNum(o['chunkIndex']) ?? 0;

  const samplesRaw = o['samples'];
  const hasSamples = samplesRaw !== undefined && samplesRaw !== null;
  if (kind === 'orbit') {
    const orbit = readOrbit(o['orbit'], `${path}.orbit`, true);
    if (!orbit) {
      if (hasSamples) warn('orbitNotSupported', { path });
      else fail('segmentShape', `${path}.orbit`, 'orbit elements');
    }
    return {
      index,
      logicalIndex,
      chunkIndex,
      kind: 'orbit',
      body,
      startUt,
      endUt,
      source: optStr(o['source']),
      boundary: o['boundary'] === true,
      orbit,
      samples: hasSamples ? readSamples(samplesRaw, `${path}.samples`, warn) : null,
    };
  }

  if (!hasSamples) fail('segmentShape', `${path}.samples`, 'sample table');
  const samples = readSamples(samplesRaw, `${path}.samples`, warn);

  return {
    index,
    logicalIndex,
    chunkIndex,
    kind,
    body,
    startUt,
    endUt,
    source: optStr(o['source']),
    boundary: o['boundary'] === true,
    orbit: null,
    samples,
  };
}

function sliceTable(table: SampleTable, start: number, end: number): SampleTable {
  const n = Math.max(0, end - start);
  const slice = <T extends Float64Array | Float32Array>(column: T | null): T | null => {
    const view = column?.subarray(start, end) as T | undefined;
    return view?.some(Number.isFinite) ? view : null;
  };
  const situation = table.situation?.slice(start, end) ?? null;
  return {
    length: n,
    t: table.t.subarray(start, end),
    lat: table.lat.subarray(start, end),
    lon: table.lon.subarray(start, end),
    alt: table.alt.subarray(start, end),
    q: table.q.subarray(start * 4, end * 4),
    vx: slice(table.vx),
    vy: slice(table.vy),
    vz: slice(table.vz),
    throttle: slice(table.throttle),
    mass: slice(table.mass),
    gee: slice(table.gee),
    stage: slice(table.stage),
    situation: situation?.some(value => value !== null) ? situation : null,
    hdg: slice(table.hdg),
    vs: slice(table.vs),
    lf: slice(table.lf),
    ox: slice(table.ox),
    ec: slice(table.ec),
    mp: slice(table.mp),
    srfSpeed: slice(table.srfSpeed),
    ias: slice(table.ias),
    mach: slice(table.mach),
    aoa: slice(table.aoa),
    aos: slice(table.aos),
    agl: slice(table.agl),
    dynPress: slice(table.dynPress),
    pitch: slice(table.pitch),
    roll: slice(table.roll),
    yaw: slice(table.yaw),
    gear: slice(table.gear),
    flaps: slice(table.flaps),
    brakes: slice(table.brakes),
    health: slice(table.health),
  };
}

function joinNumeric<T extends Float64Array | Float32Array>(
  a: T | null,
  b: T | null,
  aLength: number,
  bLength: number,
  create: (length: number) => T,
): T | null {
  if (!a && !b) return null;
  const out = create(aLength + bLength);
  if (a) out.set(a, 0);
  else out.fill(NaN, 0, aLength);
  if (b) out.set(b, aLength);
  else out.fill(NaN, aLength);
  return out;
}

function appendTable(a: SampleTable, b: SampleTable): SampleTable {
  const n = a.length + b.length;
  const joinF64 = (x: Float64Array | null, y: Float64Array | null) =>
    joinNumeric(x, y, a.length, b.length, (length) => new Float64Array(length));
  const joinF32 = (x: Float32Array | null, y: Float32Array | null) =>
    joinNumeric(x, y, a.length, b.length, (length) => new Float32Array(length));
  const q = new Float32Array(n * 4);
  q.set(a.q, 0);
  q.set(b.q, a.q.length);
  return {
    length: n,
    t: joinF64(a.t, b.t) as Float64Array,
    lat: joinF64(a.lat, b.lat) as Float64Array,
    lon: joinF64(a.lon, b.lon) as Float64Array,
    alt: joinF64(a.alt, b.alt) as Float64Array,
    q,
    vx: joinF32(a.vx, b.vx),
    vy: joinF32(a.vy, b.vy),
    vz: joinF32(a.vz, b.vz),
    throttle: joinF32(a.throttle, b.throttle),
    mass: joinF32(a.mass, b.mass),
    gee: joinF32(a.gee, b.gee),
    stage: joinF64(a.stage, b.stage),
    situation: a.situation || b.situation
      ? [...(a.situation ?? Array<null>(a.length).fill(null)), ...(b.situation ?? Array<null>(b.length).fill(null))]
      : null,
    hdg: joinF32(a.hdg, b.hdg),
    vs: joinF32(a.vs, b.vs),
    lf: joinF32(a.lf, b.lf),
    ox: joinF32(a.ox, b.ox),
    ec: joinF32(a.ec, b.ec),
    mp: joinF32(a.mp, b.mp),
    srfSpeed: joinF32(a.srfSpeed, b.srfSpeed),
    ias: joinF32(a.ias, b.ias),
    mach: joinF32(a.mach, b.mach),
    aoa: joinF32(a.aoa, b.aoa),
    aos: joinF32(a.aos, b.aos),
    agl: joinF32(a.agl, b.agl),
    dynPress: joinF32(a.dynPress, b.dynPress),
    pitch: joinF32(a.pitch, b.pitch),
    roll: joinF32(a.roll, b.roll),
    yaw: joinF32(a.yaw, b.yaw),
    gear: joinF32(a.gear, b.gear),
    flaps: joinF32(a.flaps, b.flaps),
    brakes: joinF32(a.brakes, b.brakes),
    health: joinF32(a.health, b.health),
  };
}

/** Group storage chunks by logicalIndex, sort by chunkIndex, and concatenate. */
function normalizeSegments(
  segments: TrackSegment[],
  path: string,
  warn: (code: WarningCode, params: Record<string, string | number>) => void,
): TrackSegment[] {
  const groups = new Map<number, TrackSegment[]>();
  for (const segment of segments) {
    const group = groups.get(segment.logicalIndex);
    if (group) group.push(segment);
    else groups.set(segment.logicalIndex, [segment]);
  }

  const out: TrackSegment[] = [];
  for (const logicalIndex of [...groups.keys()].sort((a, b) => a - b)) {
    const chunks = groups.get(logicalIndex) as TrackSegment[];
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex || a.index - b.index);
    if (chunks.length === 1) {
      out.push(chunks[0] as TrackSegment);
      continue;
    }

    const first = chunks[0] as TrackSegment;
    let merged = first.samples;
    for (let i = 1; i < chunks.length; i++) {
      const next = (chunks[i] as TrackSegment).samples;
      if (!merged || !next) {
        // Orbit/static entries cannot be sample-concatenated; keep them as-is.
        out.push(...chunks);
        merged = null;
        break;
      }
      const firstTime = next.t[0] as number;
      const lastTime = merged.t[merged.length - 1] as number;
      if (firstTime <= lastTime) {
        // The later chunk owns the overlap; drop older samples at or after it.
        let keep = 0;
        while (keep < merged.length && (merged.t[keep] as number) < firstTime) keep += 1;
        merged = sliceTable(merged, 0, keep);
        warn('chunkOverlap', { path, logicalIndex, ut: firstTime });
      }
      merged = appendTable(merged, next);
    }
    if (!merged) continue;

    const last = chunks[chunks.length - 1] as TrackSegment;
    out.push({
      ...first,
      index: first.index,
      logicalIndex,
      chunkIndex: 0,
      startUt: first.startUt,
      endUt: last.endUt,
      samples: merged,
    });
  }
  return out;
}

function readVessel(
  value: unknown,
  path: string,
  summary: ManifestSummary,
  bodies: Map<string, CelestialBodyDef>,
  warn: (code: WarningCode, params: Record<string, string | number>) => void,
): VesselTrack {
  const o = record(value, path, 'vesselShape');
  const id = str(o['id'], `${path}.id`, 'vesselShape');
  const expectedFile = summary.track.split('/').pop();
  if (id !== summary.id || (expectedFile !== undefined && expectedFile !== `${summary.id}.json`)) {
    throw new FormatError('vesselIdMismatch', { path, id, expected: summary.id });
  }
  const body = str(o['body'], `${path}.body`, 'vesselShape');
  assertBodyExists(bodies, body, `${path}.body`);

  const segmentsRaw = array(o['segments'], `${path}.segments`, 'vesselShape');
  if (segmentsRaw.length === 0) fail('vesselShape', `${path}.segments`, 'at least one segment');

  const parsedSegments = segmentsRaw.map((entry, i) =>
    readSegment(entry, `${path}.segments[${i}]`, bodies, warn),
  );
  const segments = normalizeSegments(parsedSegments, path, warn);

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1] as TrackSegment;
    const cur = segments[i] as TrackSegment;
    // An orbit span deliberately covers the same interval as its sparse
    // flight keyframes; that is not a storage overlap.
    if (prev.kind === 'orbit' || cur.kind === 'orbit') continue;
    // Time-warp transitions can leave the dense active segment overlapping a
    // new lower-rate active segment. The player keeps the denser one, so this
    // is a recording cadence detail rather than a broken timeline.
    if (prev.source === 'active' && cur.source === 'active') continue;
    if (prev.endUt > cur.startUt + 1e-6) warn('timeOutOfRange', { path, detail: 'segment overlap' });
  }

  return {
    id,
    name: str(o['name'], `${path}.name`, 'vesselShape'),
    type: str(o['type'], `${path}.type`, 'vesselShape'),
    body,
    color: summary.color,
    team: summary.team,
    rootPart: summary.rootPart,
    partCount: summary.partCount,
    crewCount: summary.crewCount,
    side: summary.side,
    callsign: summary.callsign,
    kind: summary.kind,
    health: summary.health,
    loadout: summary.loadout,
    role: summary.role,
    parentId: summary.parentId,
    stageIndex: summary.stageIndex,
    separatedUt: summary.separatedUt,
    modelRole: summary.modelRole,
    threat: summary.threat,
    transient: false,
    segments,
  };
}

// ---------------------------------------------------------------------------
// Optional actors.json / effects.json / locks.json
// ---------------------------------------------------------------------------

export interface ActorsResult {
  actors: ActorTrack[];
  vessels: VesselTrack[];
}

function firstBodyName(bodies: Map<string, CelestialBodyDef>): string {
  const first = bodies.keys().next();
  return first.done ? 'Kerbin' : String(first.value);
}

export function readActors(
  value: unknown,
  bodies: Map<string, CelestialBodyDef>,
  existingIds: Set<string>,
  warn: (code: WarningCode, params: Record<string, string | number>) => void,
  onDuplicate?: (id: string) => void,
): ActorsResult {
  const out: ActorsResult = { actors: [], vessels: [] };
  if (!isRecord(value)) {
    warn('optionalSection', { path: 'actors.json', detail: 'root is not an object' });
    return out;
  }
  const raw = value['actors'];
  if (!Array.isArray(raw)) {
    warn('optionalSection', { path: 'actors.json', detail: 'actors is not an array' });
    return out;
  }

  for (let i = 0; i < raw.length; i++) {
    const path = `actors[${i}]`;
    try {
      const o = record(raw[i], path, 'vesselShape');
      const id = str(o['id'], `${path}.id`, 'vesselShape');
      if (existingIds.has(id)) {
        warn('optionalSection', { path, detail: 'duplicate actor id; replacing vessel track' });
        onDuplicate?.(id)
      }
      const bodyRaw = optStr(o['body']);
      let body = bodyRaw ?? firstBodyName(bodies);
      if (!bodies.has(body)) {
        warn('bodyFallback', { path: `${path}.body`, body });
        body = firstBodyName(bodies);
      }
      if (!isRecord(o['samples'])) {
        throw new FormatError('sampleShape', { path: `${path}.samples`, expected: 'object' });
      }
      const samples = readSamples(o['samples'], `${path}.samples`, warn, true);
      const startUt = optNum(o['startUt']) ?? (samples.t[0] as number);
      const endUt = optNum(o['endUt']) ?? (samples.t[samples.length - 1] as number);
      const actor: ActorTrack = {
        id,
        name: optStr(o['name']) ?? id,
        kind: optStr(o['kind']) ?? 'unknown',
        side: normalizeSide(o['side']),
        parent: optStr(o['parent']),
        target: optStr(o['target']),
        weapon: optStr(o['weapon']),
        body,
        startUt,
        endUt,
        samples,
      };
      out.actors.push(actor);
      existingIds.add(id);
      out.vessels.push({
        id,
        name: actor.name,
        type: actor.kind,
        body,
        color: null,
        team: null,
        rootPart: null,
        partCount: null,
        crewCount: null,
        side: actor.side,
        callsign: null,
        kind: actor.kind,
        health: null,
        loadout: [],
        role: null,
        parentId: null,
        stageIndex: null,
        separatedUt: null,
        modelRole: null,
        threat: null,
        transient: true,
        segments: [
          {
            index: 0,
            logicalIndex: 0,
            chunkIndex: 0,
            kind: 'flight',
            body,
            startUt,
            endUt,
            source: 'actor',
            boundary: false,
            samples,
            orbit: null,
          },
        ],
      });
    } catch (err) {
      warn('optionalSection', {
        path,
        detail: err instanceof FormatError ? err.code : String(err),
      });
    }
  }
  return out;
}

export function readEffects(
  value: unknown,
  bodies: Map<string, CelestialBodyDef>,
  warn: (code: WarningCode, params: Record<string, string | number>) => void,
): EffectEvent[] {
  const out: EffectEvent[] = [];
  if (!isRecord(value) || !Array.isArray(value['effects'])) {
    warn('optionalSection', { path: 'effects.json', detail: 'effects is not an array' });
    return out;
  }

  for (let i = 0; i < value['effects'].length; i++) {
    const path = `effects[${i}]`;
    try {
      const o = record(value['effects'][i], path, 'eventShape');
      const bodyRaw = optStr(o['body']);
      let body = bodyRaw;
      if (bodyRaw !== null && !bodies.has(bodyRaw)) {
        warn('bodyFallback', { path: `${path}.body`, body: bodyRaw });
        body = null;
      }
      let count = optInt(o['count']) ?? 1;
      count = Math.max(1, Math.min(512, count));
      out.push({
        ut: num(o['ut'], `${path}.ut`, 'eventShape'),
        kind: str(o['kind'], `${path}.kind`, 'eventShape'),
        body,
        lat: optNum(o['lat']) ?? 0,
        lon: optNum(o['lon']) ?? 0,
        alt: optNum(o['alt']) ?? 0,
        count,
        seed: optInt(o['seed']) ?? 0,
        life: Math.max(0.001, optNum(o['life']) ?? 1),
        source: optStr(o['source']),
        target: optStr(o['target']),
        vx: optNum(o['vx']) ?? 0,
        vy: optNum(o['vy']) ?? 0,
        vz: optNum(o['vz']) ?? 0,
        spread: optNum(o['spread']) ?? 0,
      });
    } catch (err) {
      warn('optionalSection', {
        path,
        detail: err instanceof FormatError ? err.code : String(err),
      });
    }
  }
  return out;
}

export function readLocks(
  value: unknown,
  warn: (code: WarningCode, params: Record<string, string | number>) => void,
): RadarLock[] {
  const out: RadarLock[] = [];
  if (!isRecord(value) || !Array.isArray(value['locks'])) {
    warn('optionalSection', { path: 'locks.json', detail: 'locks is not an array' });
    return out;
  }

  for (let i = 0; i < value['locks'].length; i++) {
    const path = `locks[${i}]`;
    try {
      const o = record(value['locks'][i], path, 'eventShape');
      const source = str(o['source'], `${path}.source`, 'eventShape');
      const target = str(o['target'], `${path}.target`, 'eventShape');
      const startUt = num(o['startUt'], `${path}.startUt`, 'eventShape');
      const endUt = num(o['endUt'], `${path}.endUt`, 'eventShape');
      if (endUt < startUt) throw new FormatError('eventShape', { path, expected: 'startUt <= endUt' });
      out.push({
        source,
        target,
        sensor: optStr(o['sensor']),
        mode: optStr(o['mode']),
        startUt,
        endUt,
      });
    } catch (err) {
      warn('optionalSection', {
        path,
        detail: err instanceof FormatError ? err.code : String(err),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ParseOptions {
  /** Archive display name (usually the dropped file name). */
  fileName?: string;
}

export function parseArchive(bytes: Uint8Array, options: ParseOptions = {}): Replay {
  const warnings: ReplayWarning[] = [];
  const warn = (code: WarningCode, params: Record<string, string | number>): void => {
    warnings.push({ code, params });
  };

  const archive = readArchive(bytes);
  const manifestBytes = requireEntry(archive, 'manifest.json');
  const manifest = readManifest(parseJson(manifestBytes, 'manifest.json'));

  const bodiesPath = 'bodies.json';
  const eventsPath = 'events.json';
  const bodies = readBodies(parseJson(requireEntry(archive, bodiesPath), bodiesPath));
  const events = readEvents(parseJson(requireEntry(archive, eventsPath), eventsPath), warn);

  const vessels: VesselTrack[] = manifest.vessels.map((summary, i) => {
    if (!isSafeEntryPath(summary.track)) throw new FormatError('unsafePath', { path: summary.track });
    const trackPath = `vessels/${summary.id}.json`;
    const raw = parseJson(requireEntry(archive, trackPath), trackPath);
    const vessel = readVessel(raw, `vessels[${i}]`, summary, bodies, warn);
    if (summary.track !== trackPath) {
      // The manifest points somewhere else; keep the file we actually loaded.
      warn('trackPathMismatch', { path: summary.track, used: trackPath });
    }
    return vessel;
  });

  const existingIds = new Set(vessels.map((vessel) => vessel.id));
  const actors: ActorTrack[] = [];
  if (manifest.actors !== null) {
    try {
      const data = parseJson(requireEntry(archive, 'actors.json'), 'actors.json');
      const parsed = readActors(data, bodies, existingIds, warn, (id) => {
        const index = vessels.findIndex((vessel) => vessel.id === id);
        if (index >= 0) vessels.splice(index, 1);
        existingIds.delete(id);
      });
      actors.push(...parsed.actors);
      vessels.push(...parsed.vessels);
    } catch (err) {
      warn('optionalSection', {
        path: 'actors.json',
        detail: err instanceof FormatError ? err.code : String(err),
      });
    }
  }

  let effects: EffectEvent[] = [];
  if (manifest.effects !== null) {
    try {
      effects = readEffects(parseJson(requireEntry(archive, 'effects.json'), 'effects.json'), bodies, warn);
    } catch (err) {
      warn('optionalSection', {
        path: 'effects.json',
        detail: err instanceof FormatError ? err.code : String(err),
      });
    }
  }

  let locks: RadarLock[] = [];
  if (manifest.locks !== null) {
    try {
      locks = readLocks(parseJson(requireEntry(archive, 'locks.json'), 'locks.json'), warn);
    } catch (err) {
      warn('optionalSection', {
        path: 'locks.json',
        detail: err instanceof FormatError ? err.code : String(err),
      });
    }
  }

  let startUt = manifest.session.startUt;
  let endUt = manifest.session.endUt;
  let sampleCount = 0;
  for (const vessel of vessels) {
    for (const segment of vessel.segments) {
      if (segment.samples) {
        sampleCount += segment.samples.length;
        const first = segment.samples.t[0] as number;
        const last = segment.samples.t[segment.samples.length - 1] as number;
        startUt = Math.min(startUt, first);
        endUt = Math.max(endUt, last);
      }
    }
  }
  if (sampleCount === 0) throw new FormatError('noReplayableVessels');

  for (const event of events) {
    if (event.ut < startUt - 1 || event.ut > endUt + 1) {
      warn('timeOutOfRange', { path: `event ${event.type}`, ut: event.ut });
    }
  }

  return {
    fileName: options.fileName ?? 'recording.kerbtac',
    manifest,
    bodies,
    vessels,
    ...readArchiveModels(archive, new Set(vessels.map(vessel => vessel.id)),
      (path, detail) => warn('optionalSection', { path, detail })),
    actors,
    effects,
    locks,
    mission: manifest.mission,
    gaps: manifest.session.gaps,
    chapters: manifest.session.chapters,
    events,
    startUt,
    endUt,
    warnings,
    totalBytes: archive.totalBytes,
  };
}

export function findBody(replay: Replay, name: string): CelestialBodyDef {
  const body = replay.bodies.get(name);
  if (!body) throw new FormatError('unknownBody', { body: name });
  return body;
}
