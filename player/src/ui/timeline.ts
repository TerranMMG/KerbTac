import type { Replay, ReplayEvent, SessionGap } from '../format/types';
import { eventBound, replayEventIndex } from '../playback/selection';
import { formatMissionTime } from '../playback/clock';

/** Map absolute UT to a pixel offset inside a time range. */
export function timeToX(ut: number, start: number, end: number, width: number): number {
  if (!(end > start) || !(width > 0)) return 0;
  return ((ut - start) / (end - start)) * width;
}

/** Map a pixel offset back to absolute UT. */
export function xToTime(x: number, start: number, end: number, width: number): number {
  if (!(end > start) || !(width > 0)) return start;
  return start + (x / width) * (end - start);
}

/** Whole seconds as an unsigned `HH:MM:SS`; hours may exceed two digits. */
export function formatTimelineOffset(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Elapsed and remaining readouts around the playhead, like Tacview. */
export function timelineOffsets(
  ut: number,
  startUt: number,
  endUt: number,
): { elapsed: string; remaining: string } {
  const elapsed = ut - startUt;
  const remaining = Math.max(0, endUt - ut);
  return {
    elapsed: `${elapsed < 0 ? '-' : '+'}${formatTimelineOffset(Math.abs(elapsed))}`,
    remaining: `-${formatTimelineOffset(remaining)}`,
  };
}

/** Nearest event marker within a few pixels of the cursor. */
export function eventAtX(
  events: readonly ReplayEvent[],
  x: number,
  start: number,
  end: number,
  width: number,
  threshold = 6,
): ReplayEvent | null {
  let nearest: ReplayEvent | null = null;
  let best = Math.max(0, threshold) + 1e-9;
  for (const event of events) {
    const distance = Math.abs(timeToX(event.ut, start, end, width) - x);
    if (distance < best) {
      best = distance;
      nearest = event;
    }
  }
  return nearest;
}

const WEAPON_TYPES = new Set([
  'weapon_release',
  'gunfire',
  'countermeasure',
  'chaff',
  'flare',
  'missile',
  'missile_launch',
]);

const HIT_TYPES = new Set([
  'hit',
  'kill',
  'miss',
  'impact',
  'proximity_detonation',
  'shrapnel',
  'crash',
  'destroyed',
]);

const PHASE_TYPES = new Set([
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
  'soi_change',
  'scene_exit',
  'game_paused',
  'game_resumed',
]);

/**
 * Timeline lanes, top to bottom: weapons, hits, locks, flight phases, notes.
 * Unknown event types fall into the note lane so nothing is silently lost.
 */
export function laneForEvent(type: string): number {
  if (WEAPON_TYPES.has(type)) return 0;
  if (HIT_TYPES.has(type)) return 1;
  if (type === 'target_lock') return 2;
  if (PHASE_TYPES.has(type)) return 3;
  return 4;
}

/** Visible [start, end] after zooming around `center`, clamped to the session. */
export function visibleRange(start: number, end: number, zoom: number, center: number): [number, number] {
  if (!(end > start)) return [start, end];
  const factor = Math.min(1000, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  const span = (end - start) / factor;
  if (!Number.isFinite(center)) center = (start + end) / 2;
  const half = span / 2;
  let viewStart = center - half;
  let viewEnd = center + half;
  if (viewStart < start) {
    viewStart = start;
    viewEnd = start + span;
  }
  if (viewEnd > end) {
    viewEnd = end;
    viewStart = end - span;
  }
  return [viewStart, viewEnd];
}

export interface TimelineOptions {
  onSeek?: (ut: number, inputTime: number) => void;
  onHover?: (event: ReplayEvent | null, ut: number) => void;
}

interface Viewport {
  start: number;
  end: number;
}

/**
 * Canvas timeline. It shows only the events that belong to the selected
 * vessel, shades recording gaps, marks chapters, and supports seek + zoom.
 */
export class TimelineView {
  readonly element: HTMLCanvasElement;
  readonly tooltip: HTMLElement;

  private readonly host: HTMLElement;
  private readonly options: TimelineOptions;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly background = document.createElement('canvas');
  private readonly backgroundContext = this.background.getContext('2d');
  private readonly resize: ResizeObserver;
  private readonly listeners = new AbortController();
  private backgroundDirty = true;
  private replay: Replay | null = null;
  private selectionId: string | null = null;
  private events: readonly ReplayEvent[] = [];
  private zoom = 1;
  private center = 0;
  private time = 0;
  private width = 0;
  private height = 0;
  private pointerId: number | null = null;
  private hoverEvent: ReplayEvent | null = null;

  constructor(host: HTMLElement, options: TimelineOptions = {}) {
    const { signal } = this.listeners;
    this.host = host;
    this.options = options;
    this.element = document.createElement('canvas');
    this.element.className = 'timeline-canvas';
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'timeline-tooltip';
    this.tooltip.hidden = true;
    host.appendChild(this.element);
    host.appendChild(this.tooltip);
    this.context = this.element.getContext('2d');
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(host);

    this.element.addEventListener('pointerdown', (event) => {
      if (!this.replay || event.button !== 0 || this.pointerId !== null) return;
      const hit = this.eventAtPointer(event);
      if (hit) {
        this.options.onSeek?.(hit.ut, event.timeStamp);
        return;
      }
      this.pointerId = event.pointerId;
      try {
        this.element.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers and lost pointers cannot be captured; seeking still works.
      }
      this.seek(event);
    }, { signal });
    this.element.addEventListener('pointermove', (event) => {
      this.updateHover(event);
      if (event.pointerId !== this.pointerId) return;
      if ((event.buttons & 1) === 0) this.stopDrag();
      else this.seek(event);
    }, { signal });
    const stop = (event: PointerEvent): void => {
      if (event.pointerId === this.pointerId) this.stopDrag();
    };
    this.element.addEventListener('lostpointercapture', stop, { signal });
    window.addEventListener('pointerup', stop, { signal, capture: true });
    window.addEventListener('pointercancel', stop, { signal, capture: true });
    window.addEventListener('blur', () => this.stopDrag(), { signal });
    this.element.addEventListener('pointerleave', () => {
      this.hoverEvent = null;
      this.tooltip.hidden = true;
    }, { signal });
    this.element.addEventListener(
      'wheel',
      (event) => {
        if (!this.replay) return;
        event.preventDefault();
        const rect = this.element.getBoundingClientRect();
        if (rect.width <= 0) return;
        const view = this.view();
        const cursorX = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
        const cursorTime = xToTime(cursorX, view.start, view.end, rect.width);
        const nextZoom = Math.min(1000, Math.max(1, this.zoom * (event.deltaY < 0 ? 1.25 : 0.8)));
        const span = (this.replay.endUt - this.replay.startUt) / nextZoom;
        const fraction = cursorX / rect.width;
        this.zoom = nextZoom;
        this.backgroundDirty = true;
        this.center = cursorTime + (0.5 - fraction) * span;
        this.draw();
      },
      { passive: false, signal },
    );
  }

  setReplay(replay: Replay): void {
    if (this.listeners.signal.aborted) return;
    this.stopDrag();
    this.replay = replay;
    this.events = replayEventIndex(replay).forVessel(this.selectionId);
    this.hoverEvent = null;
    this.backgroundDirty = true;
    this.zoom = 1;
    this.center = (replay.startUt + replay.endUt) / 2;
    this.time = replay.startUt;
    this.draw();
  }

  setSelection(id: string | null): void {
    if (id === this.selectionId) return;
    this.selectionId = id;
    this.events = this.replay ? replayEventIndex(this.replay).forVessel(id) : [];
    this.hoverEvent = null;
    this.backgroundDirty = true;
    this.draw();
  }

  setTime(ut: number): void {
    if (ut === this.time) return;
    this.time = ut;
    this.draw();
  }

  get zoomLevel(): number {
    return this.zoom;
  }

  dispose(): void {
    this.listeners.abort();
    this.stopDrag();
    this.resize.disconnect();
    this.replay = null;
    this.events = [];
    this.hoverEvent = null;
    this.selectionId = null;
    this.background.width = this.element.width = 0;
    this.element.remove();
    this.tooltip.remove();
  }

  private stopDrag(): void {
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null && this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
  }

  draw(): void {
    if (!this.replay) return;
    const rect = this.element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.host.clientWidth || 300));
    const height = Math.max(1, Math.round(rect.height || this.host.clientHeight || 48));
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.element.width !== pixelWidth || this.element.height !== pixelHeight) {
      this.element.width = pixelWidth;
      this.element.height = pixelHeight;
      this.backgroundDirty = true;
    }
    this.width = width;
    this.height = height;
    const context = this.context;
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const view = this.view();
    const drawBackground = (target: CanvasRenderingContext2D) => {
      target.fillStyle = '#0b1420';
      target.fillRect(0, 0, width, height);
      this.drawGaps(target, view);
      this.drawChapters(target, view);
      this.drawEvents(target, view);
    };
    if (this.backgroundContext) {
      if (this.backgroundDirty) {
        this.background.width = pixelWidth;
        this.background.height = pixelHeight;
        this.backgroundContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBackground(this.backgroundContext);
        this.backgroundDirty = false;
      }
      context.drawImage(this.background, 0, 0, width, height);
    } else drawBackground(context);
    this.drawPlayhead(context, view);
    this.updateHoverReadout();
  }

  private view(): Viewport {
    if (!this.replay) return { start: 0, end: 1 };
    const [start, end] = visibleRange(this.replay.startUt, this.replay.endUt, this.zoom, this.center);
    return { start, end };
  }

  private seek(event: PointerEvent): void {
    if (!this.replay) return;
    const rect = this.element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const view = this.view();
    const ut = xToTime(event.clientX - rect.left, view.start, view.end, rect.width);
    this.options.onSeek?.(Math.min(this.replay.endUt, Math.max(this.replay.startUt, ut)), event.timeStamp);
  }

  private eventAtPointer(event: PointerEvent): ReplayEvent | null {
    // With no selection the timeline shows every event as grey context, but
    // does not hijack a seek click: only the selected-vessel flags jump.
    if (!this.replay || this.selectionId === null) return null;
    const rect = this.element.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const view = this.view();
    return eventAtX(
      this.eventsNearPointer(event.clientX - rect.left, rect.width, view),
      event.clientX - rect.left,
      view.start,
      view.end,
      rect.width,
    );
  }

  private updateHover(event: PointerEvent): void {
    if (!this.replay || this.selectionId === null) return;
    const rect = this.element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const view = this.view();
    const ut = xToTime(event.clientX - rect.left, view.start, view.end, rect.width);
    const x = event.clientX - rect.left;
    const nearest = eventAtX(this.eventsNearPointer(x, rect.width, view), x, view.start, view.end, rect.width, 7);
    this.hoverEvent = nearest;
    this.options.onHover?.(nearest, ut);
    this.updateHoverReadout();
  }

  private updateHoverReadout(): void {
    const event = this.hoverEvent;
    if (!event) {
      this.tooltip.hidden = true;
      return;
    }
    const view = this.view();
    const x = timeToX(event.ut, view.start, view.end, this.width);
    if (!this.replay) return;
    const missionTime = formatMissionTime(event.ut, this.replay.manifest.session.ut0 ?? this.replay.startUt);
    this.tooltip.textContent = `${missionTime} · ${event.type}`;
    this.tooltip.style.left = `${Math.min(Math.max(70, x), Math.max(70, this.width - 70))}px`;
    this.tooltip.hidden = false;
  }

  private eventsNearPointer(x: number, width: number, view: Viewport): readonly ReplayEvent[] {
    const before = xToTime(x - 8, view.start, view.end, width);
    const after = xToTime(x + 8, view.start, view.end, width);
    return this.events.slice(eventBound(this.events, event => event.ut < before),
      eventBound(this.events, event => event.ut <= after));
  }

  private drawGaps(context: CanvasRenderingContext2D, view: Viewport): void {
    if (!this.replay) return;
    context.fillStyle = 'rgba(255, 95, 109, 0.16)';
    for (const gap of this.replay.gaps) {
      this.fillSpan(context, gap, view, 'rgba(255, 95, 109, 0.16)');
    }
  }

  private drawChapters(context: CanvasRenderingContext2D, view: Viewport): void {
    if (!this.replay) return;
    context.fillStyle = '#ff9f43';
    for (const chapter of this.replay.chapters) {
      const x = timeToX(chapter.startUt, view.start, view.end, this.width);
      if (x < 0 || x > this.width) continue;
      context.fillRect(Math.round(x), 0, 1, 4);
      const endX = timeToX(chapter.endUt, view.start, view.end, this.width);
      if (endX > x) context.fillRect(Math.round(x), 3, Math.max(1, endX - x), 1);
    }
  }

  private drawEvents(context: CanvasRenderingContext2D, view: Viewport): void {
    const events = this.events;
    const colors = ['#ff9f43', '#ff5f6d', '#c9d4e0', '#4da3ff', '#8aa0b8'];
    // With no selection, every event is context only: all flags are grey and
    // clicks fall through to normal timeline seeking.
    const contextOnly = this.selectionId === null;
    // Tacview keeps all event flags on one row; colours still identify the
    // event class without stealing vertical space from the compact bar.
    for (const event of events) {
      const x = timeToX(event.ut, view.start, view.end, this.width);
      if (x < -2 || x > this.width + 2) continue;
      const lane = laneForEvent(event.type);
      context.fillStyle = contextOnly ? 'rgba(150, 166, 184, 0.48)' : (colors[lane] ?? colors[4]);
      context.fillRect(Math.round(x), 2, 2, Math.max(3, this.height - 4));
    }
  }

  private drawPlayhead(context: CanvasRenderingContext2D, view: Viewport): void {
    const x = timeToX(this.time, view.start, view.end, this.width);
    if (x < -1 || x > this.width + 1) return;
    context.fillStyle = '#ff9f43';
    context.fillRect(Math.round(x), 0, 1, this.height);
  }

  private fillSpan(context: CanvasRenderingContext2D, span: SessionGap, view: Viewport, color: string): void {
    const start = Math.max(view.start, span.startUt);
    const end = Math.min(view.end, span.endUt);
    if (!(end > start)) return;
    const x = timeToX(start, view.start, view.end, this.width);
    const width = timeToX(end, view.start, view.end, this.width) - x;
    context.fillStyle = color;
    context.fillRect(x, 0, Math.max(1, width), this.height);
  }
}
