// Playback clock: the single source of truth for replay time.

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 10, 20, 60, 120, 1000] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];

export interface ClockState {
  ut: number;
  playing: boolean;
  speed: number;
  startUt: number;
  endUt: number;
}

/** A recording hole. Playback jumps across it instead of interpolating. */
export interface TimeGap {
  startUt: number;
  endUt: number;
  reason?: string | null;
}

/** If `ut` is inside a gap, return the end of the merged gap chain. */
export function nextOutsideGap(gaps: readonly TimeGap[], ut: number): number {
  let result = ut;
  let changed = true;
  while (changed) {
    changed = false;
    for (const gap of gaps) {
      if (result >= gap.startUt - 1e-9 && result < gap.endUt - 1e-9) {
        result = gap.endUt;
        changed = true;
      }
    }
  }
  return result;
}

/**
 * Advances UT from wall-clock deltas. Frame-rate independent: the scene renders
 * whenever it wants, and only `tick(dt)` moves time.
 */
export class PlaybackClock {
  startUt: number;
  endUt: number;
  ut: number;
  playing = false;
  speed = 1;
  /** Loop back to the start instead of pausing at the end. */
  loop = false;
  gaps: readonly TimeGap[] = [];

  constructor(startUt: number, endUt: number, ut = startUt) {
    this.startUt = startUt;
    this.endUt = Math.max(startUt, endUt);
    this.ut = clamp(ut, this.startUt, this.endUt);
  }

  get duration(): number {
    return this.endUt - this.startUt;
  }

  get progress(): number {
    return this.duration > 0 ? (this.ut - this.startUt) / this.duration : 0;
  }

  setRange(startUt: number, endUt: number): void {
    this.startUt = startUt;
    this.endUt = Math.max(startUt, endUt);
    this.ut = clamp(this.ut, this.startUt, this.endUt);
  }

  seek(ut: number): void {
    this.ut = clamp(ut, this.startUt, this.endUt);
  }

  seekProgress(progress: number): void {
    this.seek(this.startUt + clamp(progress, 0, 1) * this.duration);
  }

  seekRelative(seconds: number): void {
    this.seek(this.ut + seconds);
  }

  play(): void {
    if (this.ut >= this.endUt - 1e-9) this.ut = this.startUt;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.speed = clamp(speed, 0.05, 1000);
  }

  /** Gaps in the recorded samples; playback jumps to the far edge. */
  setGaps(gaps: readonly TimeGap[]): void {
    this.gaps = gaps;
  }

  /** Advance by a wall-clock delta in seconds. Returns true if the clock moved. */
  tick(deltaSeconds: number): boolean {
    if (!this.playing || deltaSeconds <= 0) return false;
    let next = this.ut + deltaSeconds * this.speed;
    next = nextOutsideGap(this.gaps, next);
    if (next >= this.endUt) {
      if (this.loop && this.duration > 0) {
        this.ut = this.startUt + ((next - this.startUt) % this.duration);
      } else {
        this.ut = this.endUt;
        this.playing = false;
      }
    } else {
      this.ut = next;
    }
    return true;
  }

  snapshot(): ClockState {
    return {
      ut: this.ut,
      playing: this.playing,
      speed: this.speed,
      startUt: this.startUt,
      endUt: this.endUt,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** KSP UT -> "T+ 00:12:34" style mission time. */
export function formatMissionTime(ut: number, startUt = 0): string {
  const elapsed = ut - startUt;
  const total = Math.abs(elapsed);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const sign = elapsed < 0 ? '-' : '+';
  return `T${sign} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** KSP UT -> "Y1 D042 03:07:12" (6-hour Kerbin days not assumed; 24 h clock). */
export function formatKspTime(ut: number): string {
  const seconds = Math.max(0, ut);
  const days = Math.floor(seconds / 86400);
  const years = Math.floor(days / 426) + 1;
  const dayOfYear = days % 426;
  const rest = seconds % 86400;
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor((rest % 3600) / 60);
  const secs = Math.floor(rest % 60);
  return `Y${years} D${String(dayOfYear).padStart(3, '0')} ${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

/** Seconds -> "1:23.4" for durations under an hour, "1:02:03" above. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(Math.floor(secs))}`;
  return `${minutes}:${secs.toFixed(1).padStart(4, '0')}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
