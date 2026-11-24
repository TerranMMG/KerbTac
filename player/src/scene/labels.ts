import type { VesselTrack } from '../format/types';
import type { VesselState } from '../playback/track';

export type LabelField =
  | 'name'
  | 'callsign'
  | 'pilot'
  | 'tas'
  | 'ias'
  | 'mach'
  | 'gs'
  | 'asl'
  | 'agl'
  | 'aoa'
  | 'g'
  | 'vs'
  | 'hdg'
  | 'fuel'
  | 'energy';

export interface LabelSettings {
  fields: readonly LabelField[];
  /** Independent label scale; 1 is the normal size. */
  scale?: number;
}

/** Projected screen rectangle used for decluttering. */
export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Camera distance in metres; nearer labels win collisions. */
  distance: number;
  id?: string;
  selected?: boolean;
}

export const IDENTITY_FIELDS: readonly LabelField[] = ['name', 'callsign', 'pilot'];

export const DEFAULT_SELECTED_LABEL: LabelSettings = {
  fields: ['name', 'tas', 'mach', 'asl', 'g'],
  scale: 1,
};

export const DEFAULT_UNSELECTED_LABEL: LabelSettings = {
  fields: ['name', 'tas', 'asl'],
  scale: 1,
};

function integer(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

function signed(value: number, digits = 0): string {
  const text = Math.abs(value).toFixed(digits);
  return value < 0 ? `-${text}` : `+${text}`;
}

function heading(value: number): number {
  return ((value % 360) + 360) % 360;
}

export interface LabelUnits {
  altitude: 'm' | 'ft';
  speedDistance: 'nautical' | 'metric' | 'imperial';
}

const METRIC_UNITS: LabelUnits = { altitude: 'm', speedDistance: 'metric' };

const FEET_PER_METER = 3.280839895;
const MPS_TO_KNOTS = 1.943844492;
const MPS_TO_MPH = 2.236936292;

function formatAltitude(value: number, units: LabelUnits): string {
  return units.altitude === 'ft'
    ? `${integer(value * FEET_PER_METER)} ft`
    : `${integer(value)} m`;
}

function formatSpeed(value: number, units: LabelUnits): string {
  if (units.speedDistance === 'nautical') return `${integer(value * MPS_TO_KNOTS)} kn`;
  if (units.speedDistance === 'imperial') return `${integer(value * MPS_TO_MPH)} mph`;
  return `${integer(value)} m/s`;
}

function formatVerticalSpeed(value: number, units: LabelUnits): string {
  if (units.speedDistance === 'nautical') return `${signed(value * 196.8503937)} ft/min`;
  if (units.speedDistance === 'imperial') return `${signed(value * 196.8503937)} ft/min`;
  return `${signed(value)} m/s`;
}

function fieldText(
  field: LabelField,
  vessel: VesselTrack,
  state: VesselState,
  units: LabelUnits,
): string {
  switch (field) {
    case 'name':
      return vessel.name;
    case 'callsign':
      return vessel.callsign ?? '';
    case 'pilot':
      return vessel.crewCount && vessel.crewCount > 0
        ? `${vessel.crewCount} crew`
        : '';
    case 'tas':
      return state.speed === null ? '' : `TAS ${formatSpeed(state.speed, units)}`;
    case 'ias':
      return state.ias === null || state.ias === undefined
        ? ''
        : `IAS ${formatSpeed(state.ias, units)}`;
    case 'mach':
      return state.mach === null || state.mach === undefined
        ? ''
        : `M ${fixed(state.mach, 2)}`;
    case 'gs': {
      const speed = state.surfaceSpeed ?? state.speed;
      return speed === null || speed === undefined ? '' : `GS ${formatSpeed(speed, units)}`;
    }
    case 'asl':
      return `ASL ${formatAltitude(state.alt, units)}`;
    case 'agl':
      return state.agl === null || state.agl === undefined
        ? ''
        : `AGL ${formatAltitude(state.agl, units)}`;
    case 'aoa':
      return state.aoa === null || state.aoa === undefined
        ? ''
        : `AOA ${fixed(state.aoa, 1)}°`;
    case 'g':
      return state.gee === null ? '' : `${fixed(state.gee, 1)} G`;
    case 'vs':
      return state.verticalSpeed === null
        ? ''
        : `VS ${formatVerticalSpeed(state.verticalSpeed, units)}`;
    case 'hdg':
      return state.heading === null ? '' : `HDG ${integer(heading(state.heading))}°`;
    case 'fuel': {
      if (state.lf === null && state.ox === null) return '';
      return `FUEL ${integer((state.lf ?? 0) + (state.ox ?? 0))}`;
    }
    case 'energy': {
      const speed = state.speed ?? 0;
      const specific = (0.5 * speed * speed) / 1000 + (9.80665 * state.alt) / 1000;
      return `Em ${integer(specific)} kJ/kg`;
    }
    default:
      return '';
  }
}

/**
 * Format the configured fields into at most two lines: identity first,
 * telemetry second. Empty/missing fields are omitted rather than shown as 0.
 */
export function labelLines(
  vessel: VesselTrack,
  state: VesselState,
  settings: LabelSettings,
  units: LabelUnits = METRIC_UNITS,
): string[] {
  const identity: string[] = [];
  const telemetry: string[] = [];
  for (const field of settings.fields) {
    const text = fieldText(field, vessel, state, units).trim();
    if (!text) continue;
    if (IDENTITY_FIELDS.includes(field)) identity.push(text);
    else telemetry.push(text);
  }
  const lines: string[] = [];
  if (identity.length > 0) lines.push(identity.join(' · '));
  if (telemetry.length > 0) lines.push(telemetry.join(' · '));
  return lines;
}

/**
 * Labels are allowed to overlap in principle, but a global decluttering pass
 * moves the lower-priority label vertically until it clears every other
 * label. Selection wins first, then stable vessel order. This is global across
 * teams and neutral vessels because the label layer has no team grouping, and
 * stable order avoids labels swapping slots while aircraft move.
 */
export function resolveLabelOverlaps(
  labels: LabelBox[],
  viewportWidth: number,
  viewportHeight: number,
  gap = 4,
): void {
  const width = Math.max(1, viewportWidth)
  const height = Math.max(1, viewportHeight)
  const order = labels
    .map((label, index) => ({ label, index }))
    .sort((a, b) => {
      const selected = Number(Boolean(b.label.selected)) - Number(Boolean(a.label.selected))
      if (selected !== 0) return selected
      return a.index - b.index
    })

  const placed: LabelBox[] = []
  for (const { label } of order) {
    const boxWidth = Math.max(1, label.width)
    const boxHeight = Math.max(1, label.height)
    const maxX = Math.max(4, width - boxWidth - 4)
    const x = Math.min(Math.max(4, label.x), maxX)
    const baseY = Math.min(Math.max(4, label.y), Math.max(4, height - boxHeight - 4))
    const step = boxHeight + Math.max(2, gap)
    let chosenY = baseY

    // Try the natural position first, then alternate above/below. Moving up
    // is preferred because the leader starts at the lower-left corner.
    for (let attempt = 0; attempt <= 24; attempt += 1) {
      const offset = attempt === 0
        ? 0
        : attempt % 2 === 1
          ? -(attempt + 1) / 2
          : attempt / 2
      const y = baseY + offset * step
      if (y < 4 || y + boxHeight > height - 4) continue
      const candidate: LabelBox = { ...label, x, y }
      if (!placed.some((other) => overlaps(candidate, other, gap))) {
        chosenY = y
        break
      }
    }

    label.x = x
    label.y = chosenY
    placed.push(label)
  }
}

function overlaps(a: LabelBox, b: LabelBox, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  )
}

/**
 * Labels are allowed to overlap. The old decluttering pass hid far labels
 * behind near ones, which made whole flights disappear when zoomed out.
 */
export function shouldShowLabel(
  _label: LabelBox,
  _others: LabelBox[],
  _selected: boolean,
): boolean {
  return true;
}
