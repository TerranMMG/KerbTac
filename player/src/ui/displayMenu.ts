import {
  MODEL_SCALES,
  snapModelScale,
  type ModelScale,
} from '../scene/vectors';
import {
  HEIGHT_METRICS,
  type HeightMetric,
} from '../playback/metrics';
import type { HeightWallSetting } from '../scene/heightWall';
import type { LabelField, LabelSettings } from '../scene/labels';
import {
  DEFAULT_DISPLAY_SETTINGS,
  TRAIL_SIZE_STEPS,
  cloneDisplaySettings,
  formatTrailDuration,
  normalizeLabelVisibility,
  setLabelsVisible,
  snapTrailSeconds,
  trailStepIndex,
  type DisplaySettings,
} from '../playback/displaySettings';

const LABEL_FIELDS: Array<{ field: LabelField; label: string; key: string }> = [
  { field: 'name', label: 'Name', key: 'label.name' },
  { field: 'pilot', label: 'Pilot', key: 'label.pilot' },
  { field: 'tas', label: 'TAS', key: 'label.tas' },
  { field: 'ias', label: 'IAS', key: 'label.ias' },
  { field: 'mach', label: 'Mach', key: 'label.mach' },
  { field: 'gs', label: 'GS', key: 'label.gs' },
  { field: 'asl', label: 'ASL', key: 'label.asl' },
  { field: 'agl', label: 'AGL', key: 'label.agl' },
  { field: 'aoa', label: 'AOA', key: 'label.aoa' },
  { field: 'g', label: 'G', key: 'label.g' },
  { field: 'vs', label: 'VS', key: 'label.vs' },
  { field: 'hdg', label: 'HDG', key: 'label.hdg' },
  { field: 'fuel', label: 'Fuel', key: 'label.fuel' },
  { field: 'energy', label: 'Energy', key: 'label.energy' },
];

const METRIC_LABELS: Record<HeightMetric, string> = {
  asl: 'ASL altitude (m)',
  agl: 'AGL altitude (m)',
  tas: 'TAS (m/s)',
  aoa: 'AOA (deg)',
  g: 'G load',
  vs: 'Vertical speed (m/s)',
};

export interface DisplayMenu {
  element: HTMLElement;
  settings: DisplaySettings;
  update(next: DisplaySettings): void;
  dispose(): void;
}

function option(value: string, label: string, selected: boolean, key?: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  if (key) element.dataset.i18n = key;
  element.selected = selected;
  return element;
}

function checkbox(label: string, checked: boolean, key?: string): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'display-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const text = document.createElement('span');
  text.textContent = label;
  if (key) text.dataset.i18n = key;
  wrapper.append(input, text);
  return wrapper;
}

function fieldSet(
  title: string,
  key: string,
  getSettings: () => LabelSettings,
  onChange: (next: LabelSettings) => void,
): HTMLFieldSetElement {
  const set = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = title;
  legend.dataset.i18n = key;
  set.appendChild(legend);
  const grid = document.createElement('div');
  grid.className = 'display-field-grid';
  for (const item of LABEL_FIELDS) {
    const current = getSettings();
    const label = checkbox(item.label, current.fields.includes(item.field), item.key);
    const input = label.querySelector('input');
    if (input) input.dataset.field = item.field;
    input?.addEventListener('change', () => {
      const latest = getSettings();
      const fields = new Set(latest.fields);
      if (input.checked) fields.add(item.field);
      else fields.delete(item.field);
      onChange({ ...latest, fields: LABEL_FIELDS.map((f) => f.field).filter((f) => fields.has(f)) });
    });
    grid.appendChild(label);
  }
  set.appendChild(grid);
  return set;
}

/**
 * Tacview-style Display menu. DOM-only so it can be mounted by the shell in
 * Task 18; settings are returned through the callback and never mutate the
 * caller's object.
 */
export function createDisplayMenu(
  initial: DisplaySettings = DEFAULT_DISPLAY_SETTINGS,
  onChange: (settings: DisplaySettings) => void = () => {},
): DisplayMenu {
  let settings = cloneDisplaySettings(initial);
  const element = document.createElement('div');
  element.className = 'display-menu';
  element.hidden = true;

  const title = document.createElement('div');
  title.className = 'display-menu-title panel-head';
  const heading = document.createElement('h2');
  heading.textContent = 'Display';
  heading.dataset.i18n = 'display.title';
  title.appendChild(heading);
  element.appendChild(title);

  const trailRow = document.createElement('label');
  trailRow.className = 'display-row';
  const trailLabel = document.createElement('span');
  trailLabel.textContent = 'Trail size';
  trailLabel.dataset.i18n = 'display.trailSize';
  const trailValue = document.createElement('output');
  trailValue.className = 'display-value';
  trailValue.textContent = formatTrailDuration(settings.trailSeconds);
  const trail = document.createElement('input');
  trail.type = 'range';
  trail.min = '0';
  trail.max = String(TRAIL_SIZE_STEPS.length - 1);
  trail.step = '1';
  trail.value = String(trailStepIndex(settings.trailSeconds));
  trailRow.append(trailLabel, trailValue, trail);
  trailRow.hidden = true;
  element.appendChild(trailRow);

  const heightRow = document.createElement('label');
  heightRow.className = 'display-row';
  const heightLabel = document.createElement('span');
  heightLabel.textContent = 'Object height';
  heightLabel.dataset.i18n = 'display.objectHeight';
  const height = document.createElement('select');
  height.append(
    option('disabled', 'Disabled', settings.heightWall === 'disabled', 'display.disabled'),
    option('selected', 'Selected only', settings.heightWall === 'selected', 'display.selectedOnly'),
    option('all', 'All objects', settings.heightWall === 'all', 'display.allObjects'),
  );
  heightRow.append(heightLabel, height);
  element.appendChild(heightRow);

  const metricRow = document.createElement('label');
  metricRow.className = 'display-row';
  const metricLabel = document.createElement('span');
  metricLabel.textContent = 'Height metric';
  metricLabel.dataset.i18n = 'display.heightMetric';
  const metric = document.createElement('select');
  for (const value of HEIGHT_METRICS) {
    metric.append(option(value, METRIC_LABELS[value], settings.heightMetric === value, `metric.${value}`));
  }
  metricRow.append(metricLabel, metric);
  element.appendChild(metricRow);

  const scaleRow = document.createElement('label');
  scaleRow.className = 'display-row';
  const scaleLabel = document.createElement('span');
  scaleLabel.textContent = 'Model scale';
  scaleLabel.dataset.i18n = 'display.modelScale';
  const scale = document.createElement('select');
  MODEL_SCALES.forEach((value, index) => {
    scale.append(option(String(index), `${value}×`, settings.modelScaleIndex === index));
  });
  scaleRow.append(scaleLabel, scale);
  element.appendChild(scaleRow);

  const vectors = checkbox('Vectors', settings.showVectors, 'display.vectors')
  const labels = checkbox('Labels', settings.showLabels, 'display.labels')
  const lockLines = checkbox('Radar lock lines', settings.showLockLines, 'display.lockLines')
  const effects = checkbox('Combat effects', settings.showEffects, 'display.effects')
  const countermeasures = checkbox('Countermeasures', settings.showCountermeasures, 'display.countermeasures')
  const tracers = checkbox('Tracers', settings.showTracers, 'display.tracers')
  const healthBars = checkbox('Health bars', settings.showHealthBars, 'display.healthBars')
  const threat = checkbox('Threat circles', settings.showThreatCircles, 'display.threat')
  element.append(vectors, labels, lockLines, effects, countermeasures, tracers, healthBars, threat)

  const altitudeRow = document.createElement('label')
  altitudeRow.className = 'display-row'
  const altitudeLabel = document.createElement('span')
  altitudeLabel.textContent = 'Altitude unit'
  altitudeLabel.dataset.i18n = 'display.altitudeUnit'
  const altitudeUnit = document.createElement('select')
  altitudeUnit.append(
    option('m', 'Meters', settings.altitudeUnit === 'm', 'display.unitMeters'),
    option('ft', 'Feet', settings.altitudeUnit === 'ft', 'display.unitFeet'),
  )
  altitudeRow.append(altitudeLabel, altitudeUnit)
  element.appendChild(altitudeRow)

  const speedRow = document.createElement('label')
  speedRow.className = 'display-row'
  const speedLabel = document.createElement('span')
  speedLabel.textContent = 'Distance / speed'
  speedLabel.dataset.i18n = 'display.speedDistanceUnit'
  const speedUnit = document.createElement('select')
  speedUnit.append(
    option('nautical', 'nmi / kt', settings.speedDistanceUnit === 'nautical', 'display.unitNautical'),
    option('metric', 'm / m/s', settings.speedDistanceUnit === 'metric', 'display.unitMetric'),
    option('imperial', 'mi / mph', settings.speedDistanceUnit === 'imperial', 'display.unitImperial'),
  )
  speedRow.append(speedLabel, speedUnit)
  element.appendChild(speedRow)

  const selectedSet = fieldSet('Selected label', 'display.selectedLabel', () => settings.selectedLabel, (next) => {
    settings = { ...settings, selectedLabel: next };
    emit();
  });
  const unselectedSet = fieldSet('Unselected label', 'display.unselectedLabel', () => settings.unselectedLabel, (next) => {
    settings = { ...settings, unselectedLabel: next };
    emit();
  });
  element.append(selectedSet, unselectedSet);

  const scaleRowTwo = document.createElement('div');
  scaleRowTwo.className = 'display-row';
  const selectedScaleLabel = document.createElement('span');
  selectedScaleLabel.textContent = 'Selected label scale';
  selectedScaleLabel.dataset.i18n = 'display.selectedScale';
  const selectedScale = document.createElement('input');
  selectedScale.type = 'range';
  selectedScale.min = '0.5';
  selectedScale.max = '2';
  selectedScale.step = '0.1';
  selectedScale.value = String(settings.selectedLabel.scale ?? 1);
  scaleRowTwo.append(selectedScaleLabel, selectedScale);
  element.appendChild(scaleRowTwo);

  const unselectedScaleRow = document.createElement('div');
  unselectedScaleRow.className = 'display-row';
  const unselectedScaleLabel = document.createElement('span');
  unselectedScaleLabel.textContent = 'Unselected label scale';
  unselectedScaleLabel.dataset.i18n = 'display.unselectedScale';
  const unselectedScale = document.createElement('input');
  unselectedScale.type = 'range';
  unselectedScale.min = '0.5';
  unselectedScale.max = '2';
  unselectedScale.step = '0.1';
  unselectedScale.value = String(settings.unselectedLabel.scale ?? 0.82);
  unselectedScaleRow.append(unselectedScaleLabel, unselectedScale);
  element.appendChild(unselectedScaleRow);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn ghost small display-reset';
  reset.textContent = 'Reset display';
  reset.dataset.i18n = 'display.reset';
  element.appendChild(reset);

  function emit(): void {
    settings = normalizeLabelVisibility(settings);
    sync();
    onChange(cloneDisplaySettings(settings));
  }

  function syncFields(set: HTMLFieldSetElement, values: LabelSettings): void {
    for (const input of set.querySelectorAll<HTMLInputElement>('input[data-field]')) {
      input.checked = values.fields.includes(input.dataset.field as LabelField);
    }
  }

  function sync(): void {
    trail.value = String(trailStepIndex(settings.trailSeconds));
    trailValue.textContent = formatTrailDuration(settings.trailSeconds);
    height.value = settings.heightWall;
    metric.value = settings.heightMetric;
    scale.value = String(settings.modelScaleIndex);
    const vectorInput = vectors.querySelector('input');
    if (vectorInput) vectorInput.checked = settings.showVectors;
    const labelInput = labels.querySelector('input');
    if (labelInput) labelInput.checked = settings.showLabels;
    const lockInput = lockLines.querySelector('input')
    if (lockInput) lockInput.checked = settings.showLockLines
    const effectInput = effects.querySelector('input')
    if (effectInput) effectInput.checked = settings.showEffects
    const cmInput = countermeasures.querySelector('input')
    if (cmInput) cmInput.checked = settings.showCountermeasures
    const tracerInput = tracers.querySelector('input')
    if (tracerInput) tracerInput.checked = settings.showTracers
    const healthInput = healthBars.querySelector('input')
    if (healthInput) healthInput.checked = settings.showHealthBars
    const threatInput = threat.querySelector('input')
    if (threatInput) threatInput.checked = settings.showThreatCircles
    altitudeUnit.value = settings.altitudeUnit
    speedUnit.value = settings.speedDistanceUnit
    syncFields(selectedSet, settings.selectedLabel);
    syncFields(unselectedSet, settings.unselectedLabel);
    selectedScale.value = String(settings.selectedLabel.scale ?? 1);
    unselectedScale.value = String(settings.unselectedLabel.scale ?? 1);
  }

  trail.addEventListener('input', () => {
    const seconds = snapTrailSeconds(
      TRAIL_SIZE_STEPS[Math.max(0, Math.min(TRAIL_SIZE_STEPS.length - 1, Number(trail.value)))],
    );
    trailValue.textContent = formatTrailDuration(seconds);
    settings = { ...settings, trailSeconds: seconds };
    emit();
  });
  height.addEventListener('change', () => {
    settings = { ...settings, heightWall: height.value as HeightWallSetting };
    emit();
  });
  metric.addEventListener('change', () => {
    settings = { ...settings, heightMetric: metric.value as HeightMetric };
    emit();
  });
  scale.addEventListener('change', () => {
    settings = {
      ...settings,
      modelScaleIndex: Math.max(0, Math.min(MODEL_SCALES.length - 1, Number(scale.value))),
    };
    emit();
  });
  vectors.querySelector('input')?.addEventListener('change', (event) => {
    settings = { ...settings, showVectors: (event.target as HTMLInputElement).checked };
    emit();
  });
  labels.querySelector('input')?.addEventListener('change', (event) => {
    settings = setLabelsVisible(settings, (event.target as HTMLInputElement).checked);
    emit();
  });
  lockLines.querySelector('input')?.addEventListener('change', (event) => {
    settings = { ...settings, showLockLines: (event.target as HTMLInputElement).checked };
    emit();
  });
  effects.querySelector('input')?.addEventListener('change', (event) => {
    settings = { ...settings, showEffects: (event.target as HTMLInputElement).checked };
    emit();
  });
  countermeasures.querySelector('input')?.addEventListener('change', (event) => {
    settings = { ...settings, showCountermeasures: (event.target as HTMLInputElement).checked };
    emit();
  });
  tracers.querySelector('input')?.addEventListener('change', (event) => {
    settings = { ...settings, showTracers: (event.target as HTMLInputElement).checked };
    emit();
  });
  healthBars.querySelector('input')?.addEventListener('change', (event) => {
    settings = { ...settings, showHealthBars: (event.target as HTMLInputElement).checked };
    emit();
  });
  threat.querySelector('input')?.addEventListener('change', (event) => {
    settings = { ...settings, showThreatCircles: (event.target as HTMLInputElement).checked };
    emit();
  });
  altitudeUnit.addEventListener('change', () => {
    settings = {
      ...settings,
      altitudeUnit: altitudeUnit.value === 'ft' ? 'ft' : 'm',
    };
    emit();
  });
  speedUnit.addEventListener('change', () => {
    const value = speedUnit.value;
    settings = {
      ...settings,
      speedDistanceUnit:
        value === 'nautical' ? 'nautical' : value === 'imperial' ? 'imperial' : 'metric',
    };
    emit();
  });
  selectedScale.addEventListener('input', () => {
    settings = {
      ...settings,
      selectedLabel: { ...settings.selectedLabel, scale: Number(selectedScale.value) },
    };
    emit();
  });
  unselectedScale.addEventListener('input', () => {
    settings = {
      ...settings,
      unselectedLabel: { ...settings.unselectedLabel, scale: Number(unselectedScale.value) },
    };
    emit();
  });
  reset.addEventListener('click', () => {
    settings = cloneDisplaySettings(DEFAULT_DISPLAY_SETTINGS);
    sync();
    emit();
  });

  return {
    element,
    get settings() {
      return settings;
    },
    update(next: DisplaySettings) {
      settings = cloneDisplaySettings(next);
      sync();
    },
    dispose() {
      element.remove();
    },
  };
}

/** Actual multiplier for the selected menu step. */
export function menuModelScale(menu: DisplayMenu): ModelScale {
  return snapModelScale(menu.settings.modelScaleIndex) as ModelScale;
}
