// Normalized data model for a parsed .kerbtac archive.
// The raw JSON shapes are validated in validate.ts; everything downstream of
// that point uses the types in this file.

import type { ModelBinding } from './models';

export type QuatTuple = readonly [number, number, number, number]; // x, y, z, w
export type Vec3Tuple = readonly [number, number, number];

export type SegmentKind = 'flight' | 'surface' | 'orbit' | 'static';
export type Side = 'blue' | 'red' | 'neutral';

export interface MissionInfo {
  title: string;
  category: string | null;
  briefing: string | null;
  debriefing: string | null;
  theater: string | null;
  author: string | null;
  tags: string[];
  notes: string | null;
}

export interface SessionGap {
  startUt: number;
  endUt: number;
  reason: string | null;
}

export interface ChapterInfo {
  id: string;
  name: string;
  startUt: number;
  endUt: number;
  reason: string | null;
}

export interface EffectEvent {
  ut: number;
  kind: string;
  body: string | null;
  lat: number;
  lon: number;
  alt: number;
  count: number;
  seed: number;
  life: number;
  source: string | null;
  target: string | null;
  vx: number;
  vy: number;
  vz: number;
  spread: number;
}

export interface RadarLock {
  source: string;
  target: string;
  sensor: string | null;
  mode: string | null;
  startUt: number;
  endUt: number;
}

export interface ActorTrack {
  id: string;
  name: string;
  kind: string;
  side: Side;
  parent: string | null;
  target: string | null;
  weapon: string | null;
  body: string;
  startUt: number;
  endUt: number;
  samples: SampleTable;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface OrbitBodyRotation {
  kind: 'ksp-zup-spin-v1';
  epochUt: number;
  angleDeg: number;
  rateDegPerSec: number;
}

export interface OrbitElements {
  epoch: number;
  semiMajorAxis: number;
  eccentricity: number;
  inclinationDeg: number;
  lanDeg: number;
  argPeDeg: number;
  meanAnomalyDeg: number;
  /** Absent for legacy; null when a present extension is unusable. */
  bfRotation?: OrbitBodyRotation | null;
}

/** Frozen air-defence ranges written in format v1.3. */
export interface ThreatRanges {
  missileRangeM: number;
  radarRangeM: number;
  threatRadiusM: number;
}

export interface BodyRotation {
  epochUt: number;
  q0: QuatTuple;
  axis: Vec3Tuple;
  rateDegPerSec: number;
}

export interface CelestialBodyDef {
  name: string;
  parent: string | null;
  radius: number;
  gravParameter: number;
  atmosphereDepth: number;
  sphereOfInfluence: number | null;
  rotation: BodyRotation;
  orbit: OrbitElements | null;
  style: string | null;
}

/**
 * Columnar sample table. `t`, `lat`, `lon`, `alt`, and `q` are mandatory;
 * every other column is optional and `null` when the recorder did not write it.
 * Optional columns must never be silently replaced by zeroes: the UI shows
 * "unknown" instead.
 */
export interface SampleTable {
  length: number;
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
  /** 4 * length flat quaternions, model space -> body-fixed. */
  q: Float32Array;
  // For optional columns, null means no column; NaN (or null for strings)
  // marks a missing row. Typed-array views transfer with the replay worker.
  vx: Float32Array | null;
  vy: Float32Array | null;
  vz: Float32Array | null;
  throttle: Float32Array | null;
  mass: Float32Array | null;
  gee: Float32Array | null;
  /** Integer values, stored in Float64Array so NaN cannot alias any stage. */
  stage: Float64Array | null;
  situation: (string | null)[] | null;
  hdg: Float32Array | null;
  vs: Float32Array | null;
  lf: Float32Array | null;
  ox: Float32Array | null;
  ec: Float32Array | null;
  mp: Float32Array | null;
  srfSpeed: Float32Array | null;
  ias: Float32Array | null;
  mach: Float32Array | null;
  aoa: Float32Array | null;
  aos: Float32Array | null;
  agl: Float32Array | null;
  dynPress: Float32Array | null;
  pitch: Float32Array | null;
  roll: Float32Array | null;
  yaw: Float32Array | null;
  gear: Float32Array | null;
  flaps: Float32Array | null;
  brakes: Float32Array | null;
  health: Float32Array | null;
}

export interface TrackSegment {
  index: number;
  /** Logical flight segment; chunks of one flight share this value. */
  logicalIndex: number;
  /** 0-based storage chunk within a logical segment. */
  chunkIndex: number;
  kind: SegmentKind;
  body: string;
  startUt: number;
  endUt: number;
  source: string | null;
  boundary: boolean;
  samples: SampleTable | null;
  orbit: OrbitElements | null;
}

export interface VesselTrack {
  id: string;
  name: string;
  type: string;
  body: string;
  color: string | null;
  team: string | null;
  rootPart: string | null;
  partCount: number | null;
  crewCount: number | null;
  side: Side;
  callsign: string | null;
  kind: string;
  health: number | null;
  loadout: string[];
  transient: boolean;
  /** Format v1.3 stage lineage and model role; null in older recordings. */
  role?: string | null;
  parentId?: string | null;
  stageIndex?: number | null;
  separatedUt?: number | null;
  modelRole?: string | null;
  threat?: ThreatRanges | null;
  segments: TrackSegment[];
}

export interface ReplayEvent {
  ut: number;
  type: string;
  vessel: string | null;
  target: string | null;
  body: string | null;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  source: string | null;
  weapon: string | null;
  outcome: string | null;
  range: number | null;
  aspect: number | null;
  damage: number | null;
  data: Record<string, JsonValue>;
}

export interface ManifestSummary {
  id: string;
  name: string | null;
  type: string;
  body: string;
  color: string | null;
  team: string | null;
  rootPart: string | null;
  partCount: number | null;
  crewCount: number | null;
  side: Side;
  callsign: string | null;
  kind: string;
  health: number | null;
  loadout: string[];
  role: string | null;
  parentId: string | null;
  stageIndex: number | null;
  separatedUt: number | null;
  modelRole: string | null;
  threat: ThreatRanges | null;
  track: string;
}

export interface SessionManifest {
  format: 'kerbtac';
  formatVersion: number;
  formatRevision: number;
  mission: MissionInfo | null;
  generator: { name: string; version: string };
  game: {
    kspVersion: string;
    unityVersion: string | null;
    saveName: string | null;
    scene: string | null;
  };
  session: {
    id: string;
    name: string | null;
    startUt: number;
    endUt: number;
    startWall: string | null;
    endWall: string | null;
    duration: number | null;
    ut0: number | null;
    /** "space" or "combat"; null in recordings made before format v1.3. */
    recordingMode: 'combat' | 'space' | null;
    gaps: SessionGap[];
    chapters: ChapterInfo[];
  };
  vessels: ManifestSummary[];
  actors: string | null;
  effects: string | null;
  locks: string | null;
  summary: string | null;
}

export type WarningCode =
  | 'unsortedSamples'
  | 'duplicateSampleTime'
  | 'latLonClamped'
  | 'timeOutOfRange'
  | 'unknownEventType'
  | 'unknownSegmentKind'
  | 'unknownVesselType'
  | 'missingOptionalColumn'
  | 'orbitNotSupported'
  | 'emptySegment'
  | 'bodyFallback'
  | 'companionBodyMissing'
  | 'trackPathMismatch'
  | 'quatNormalized'
  | 'optionalSection'
  | 'optionalColumn'
  | 'chunkOverlap';

export interface ReplayWarning {
  code: WarningCode;
  params: Record<string, string | number>;
}

export type ErrorCode =
  | 'notZip'
  | 'zipError'
  | 'unsafePath'
  | 'entryTooLarge'
  | 'archiveTooLarge'
  | 'tooManyEntries'
  | 'missingEntry'
  | 'badJson'
  | 'manifestShape'
  | 'unsupportedFormat'
  | 'unsupportedVersion'
  | 'bodiesShape'
  | 'rootBodyMissing'
  | 'unknownBody'
  | 'eventsShape'
  | 'eventShape'
  | 'vesselShape'
  | 'vesselIdMismatch'
  | 'segmentShape'
  | 'segmentOrder'
  | 'sampleShape'
  | 'sampleLengthMismatch'
  | 'sampleTimeOrder'
  | 'sampleNonFinite'
  | 'sampleRange'
  | 'emptySegment'
  | 'noReplayableVessels';

export interface Replay {
  /** Archive file name shown in the UI. */
  fileName: string;
  manifest: SessionManifest;
  bodies: Map<string, CelestialBodyDef>;
  vessels: VesselTrack[];
  models: ModelBinding[];
  /** Only model files referenced by accepted bindings. */
  modelFiles: Map<string, Uint8Array>;
  actors: ActorTrack[];
  effects: EffectEvent[];
  locks: RadarLock[];
  mission: MissionInfo | null;
  gaps: SessionGap[];
  chapters: ChapterInfo[];
  events: ReplayEvent[];
  /** Effective playback range, covering both manifest and actual samples. */
  startUt: number;
  endUt: number;
  warnings: ReplayWarning[];
  /** Total decompressed size in bytes, for the file info panel. */
  totalBytes: number;
}

export function vesselColorFromPalette(index: number): string {
  const palette = ['#4fc3f7', '#ffb74d', '#81c784', '#e57373', '#ba68c8', '#4db6ac', '#f06292', '#dce775'];
  return palette[((index % palette.length) + palette.length) % palette.length] as string;
}

export function sideColorHex(side: Side | string | null | undefined): string | null {
  if (side === 'blue') return '#4da3ff';
  if (side === 'red') return '#ff5f6d';
  return null;
}

/** Team colour wins over the archive's legacy per-vessel colour. */
export function displayColorHex(
  vessel: Pick<VesselTrack, 'side' | 'color'>,
  index: number,
): string {
  const side = sideColorHex(vessel.side);
  if (side) return side;
  if (vessel.color && /^#[0-9a-f]{6}$/i.test(vessel.color)) return vessel.color;
  return vesselColorFromPalette(index);
}

/** KSP spawns spent stages as Debris; the player shows them with the debris preset. */
export function isDebrisVessel(
  vessel: Pick<VesselTrack, 'type' | 'kind'> & { name?: string | null },
): boolean {
  const type = (vessel.type ?? '').toLowerCase()
  const name = vessel.name ?? ''
  return (
    type === 'debris' ||
    type.includes('debris') ||
    vessel.kind === 'debris' ||
    name.toLowerCase().includes('debris') ||
    ((type === 'probe' || type === 'relay' || type === 'station') &&
      vessel.kind !== 'sea/ship' &&
      !/^#autoLOC_\d+$/i.test(name) &&
      /_\d+$/.test(name))
  )
}
