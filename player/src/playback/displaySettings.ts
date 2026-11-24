import type { HeightMetric } from './metrics';
import type { HeightWallSetting } from '../scene/heightWall';
import {
  DEFAULT_SELECTED_LABEL,
  DEFAULT_UNSELECTED_LABEL,
  type LabelSettings,
} from '../scene/labels';
import type { ModelScale } from '../scene/vectors';
import { snapModelScale } from '../scene/vectors';

export const TRAIL_MIN_SECONDS = 10;
export const TRAIL_MAX_SECONDS = 86400;
export const DEFAULT_TRAIL_SECONDS = 60;
/** Discrete trail sizes shown by the slider (seconds). */
export const TRAIL_SIZE_STEPS = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
  110, 120, 130, 140, 150, 160, 170, 180, 190, 200,
  210, 220, 230, 240, 250, 260, 270, 280, 290, 300,
  360, 420, 480, 540, 600, 720, 900, 1200, 1800, 2400, 3000, 3600,
  7200, 10800, 14400, 18000, 21600, 28800, 36000, 43200, 57600, 72000, 86400,
] as const;

export interface DisplaySettings {
  trailSeconds: number;
  heightWall: HeightWallSetting;
  heightMetric: HeightMetric;
  showVectors: boolean;
  showLabels: boolean;
  showLockLines: boolean;
  selectedLabel: LabelSettings;
  unselectedLabel: LabelSettings;
  /** Index into MODEL_SCALES; 2 = 1.0x. */
  modelScaleIndex: number;
  showEffects: boolean;
  showCountermeasures: boolean;
  showTracers: boolean;
  showHealthBars: boolean;
  showThreatCircles: boolean;
  altitudeUnit: 'm' | 'ft';
  speedDistanceUnit: 'nautical' | 'metric' | 'imperial';
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  trailSeconds: DEFAULT_TRAIL_SECONDS,
  heightWall: 'selected',
  heightMetric: 'agl',
  showVectors: false,
  showLabels: true,
  showLockLines: false,
  selectedLabel: DEFAULT_SELECTED_LABEL,
  unselectedLabel: DEFAULT_UNSELECTED_LABEL,
  modelScaleIndex: 2,
  showEffects: true,
  showCountermeasures: true,
  showTracers: true,
  showHealthBars: true,
  showThreatCircles: true,
  altitudeUnit: 'm',
  speedDistanceUnit: 'metric',
};

export function clampTrailSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_TRAIL_SECONDS;
  return Math.max(TRAIL_MIN_SECONDS, Math.min(TRAIL_MAX_SECONDS, Math.round(seconds)));
}

/** Snap arbitrary seconds to the closest slider step. */
export function snapTrailSeconds(seconds: number): number {
  const value = clampTrailSeconds(seconds);
  let nearest: number = TRAIL_SIZE_STEPS[0];
  for (const step of TRAIL_SIZE_STEPS) {
    if (Math.abs(step - value) < Math.abs(nearest - value)) nearest = step;
  }
  return nearest;
}

export function trailStepIndex(seconds: number): number {
  const value = snapTrailSeconds(seconds);
  return TRAIL_SIZE_STEPS.indexOf(value as (typeof TRAIL_SIZE_STEPS)[number]);
}

export function formatTrailDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total >= 3600) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function cloneDisplaySettings(settings: DisplaySettings): DisplaySettings {
  return {
    ...settings,
    selectedLabel: {
      ...settings.selectedLabel,
      fields: [...settings.selectedLabel.fields],
    },
    unselectedLabel: {
      ...settings.unselectedLabel,
      fields: [...settings.unselectedLabel.fields],
    },
  };
}

export function modelScaleOf(settings: DisplaySettings): ModelScale {
  return snapModelScale(settings.modelScaleIndex) as ModelScale;
}

function hasLabelFields(settings: DisplaySettings): boolean {
  return settings.selectedLabel.fields.length > 0 || settings.unselectedLabel.fields.length > 0;
}

/**
 * A label with no configured fields has no visual content. Treat that as
 * labels switched off so an empty bordered box never floats over a vessel.
 */
export function normalizeLabelVisibility(settings: DisplaySettings): DisplaySettings {
  if (settings.showLabels && !hasLabelFields(settings)) {
    return { ...settings, showLabels: false };
  }
  return settings;
}

/**
 * Toggle label rendering. Switching labels back on after every field was
 * cleared restores the default field sets instead of showing empty boxes.
 */
export function setLabelsVisible(settings: DisplaySettings, visible: boolean): DisplaySettings {
  if (!visible) return { ...settings, showLabels: false };
  if (hasLabelFields(settings)) return { ...settings, showLabels: true };
  return {
    ...settings,
    showLabels: true,
    selectedLabel: { ...DEFAULT_SELECTED_LABEL, fields: [...DEFAULT_SELECTED_LABEL.fields] },
    unselectedLabel: { ...DEFAULT_UNSELECTED_LABEL, fields: [...DEFAULT_UNSELECTED_LABEL.fields] },
  };
}
