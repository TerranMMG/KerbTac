// Selection is the single source of truth for which object the analysis UI is
// looking at. Events follow the selected object, not the whole mission.

import type { Replay, ReplayEvent, Side, VesselTrack } from '../format/types';
import { sampleVessel, vesselActiveAt, type VesselState } from './track';

export const COMBAT_EVENT_TYPES = new Set([
  'gunfire', 'countermeasure', 'chaff', 'flare', 'weapon_release', 'impact',
  'proximity_detonation', 'hit', 'kill', 'destroyed', 'miss', 'target_lock',
]);

function eventOwners(event: ReplayEvent): Set<string | null> {
  if (event.type === 'gunfire' || event.type === 'weapon_release') return new Set([event.vessel ?? event.source]);
  if (event.type === 'miss') return new Set([event.source ?? event.vessel]);
  return new Set([event.vessel, event.source, event.target]);
}

/** First index for which `skip` is false, in an already ordered list. */
export function eventBound<T>(items: readonly T[], skip: (item: T) => boolean): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (skip(items[mid])) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class ReplayEventIndex {
  private readonly all: readonly ReplayEvent[];
  private readonly owners = new Map<string, ReplayEvent[]>();
  private readonly combat = new Map<string, ReplayEvent[]>();
  private readonly teams = new Map<string, Array<{ ut: number; side: Side }>>();
  private readonly actorEnds = new Map<string, number>();
  private readonly vesselEnds = new Map<string, number>();

  constructor(events: readonly ReplayEvent[]) {
    this.all = events.every((item, i) => i === 0 || events[i - 1].ut <= item.ut)
      ? events : events.slice().sort((a, b) => a.ut - b.ut);
    const append = <T>(map: Map<string, T[]>, id: string, item: T): void => {
      const group = map.get(id);
      if (group) group.push(item);
      else map.set(id, [item]);
    };
    for (const event of this.all) {
      const combat = COMBAT_EVENT_TYPES.has(event.type);
      for (const id of eventOwners(event)) {
        if (id === null) continue;
        append(this.owners, id, event);
        if (combat) append(this.combat, id, event);
      }
      const side = event.data?.side;
      if (event.type === 'team_change' && event.vessel !== null &&
          (side === 'blue' || side === 'red' || side === 'neutral')) {
        append(this.teams, event.vessel, { ut: event.ut, side });
      }
      if (event.type === 'kill' || event.type === 'destroyed' || event.type === 'crash') {
        if (event.vessel !== null) this.vesselEnds.set(event.vessel, event.ut);
        if (event.target !== null) this.vesselEnds.set(event.target, event.ut);
      }
      if (event.type === 'impact' || event.type === 'proximity_detonation' || event.type === 'miss') {
        const actor = event.data?.actorId;
        if (typeof actor === 'string') this.actorEnds.set(actor, event.ut);
      }
    }
  }

  forVessel(id: string | null): readonly ReplayEvent[] {
    return id === null ? this.all : this.owners.get(id) ?? [];
  }

  lastCombat(id: string, ut: number): ReplayEvent | undefined {
    const events = this.combat.get(id);
    return events?.[eventBound(events, event => event.ut <= ut + 1e-6) - 1];
  }

  terminalUt(vessel: Pick<VesselTrack, 'id' | 'transient'>): number | null {
    return (vessel.transient ? this.actorEnds : this.vesselEnds).get(vessel.id) ?? null;
  }

  sideAt(vessel: Pick<VesselTrack, 'id' | 'side'>, ut: number): Side {
    const changes = this.teams.get(vessel.id);
    return changes?.[eventBound(changes, change => change.ut <= ut) - 1]?.side ?? vessel.side ?? 'neutral';
  }
}

/** Lazily sampled once per object/UT, shared by UI and scene. */
export class ReplayFrame {
  private readonly states = new Map<VesselTrack, VesselState | null>();
  private readonly sides = new Map<VesselTrack, Side>();
  private readonly active = new Map<VesselTrack, boolean>();

  constructor(private readonly replay: Replay, readonly events: ReplayEventIndex, readonly ut: number) {}

  sample(vessel: VesselTrack): VesselState | null {
    if (!this.states.has(vessel)) this.states.set(vessel, sampleVessel(vessel, this.ut, this.replay.bodies));
    return this.states.get(vessel) ?? null;
  }

  side(vessel: VesselTrack): Side {
    let side = this.sides.get(vessel);
    if (side === undefined) {
      side = this.events.sideAt(vessel, this.ut);
      this.sides.set(vessel, side);
    }
    return side;
  }

  isActive(vessel: VesselTrack): boolean {
    let active = this.active.get(vessel);
    if (active === undefined) {
      active = vesselActiveAt(vessel, this.ut);
      this.active.set(vessel, active);
    }
    return active;
  }
}

const playback = new WeakMap<Replay, { events: ReplayEventIndex; frame?: ReplayFrame }>();

function cache(replay: Replay) {
  let entry = playback.get(replay);
  if (!entry) {
    entry = { events: new ReplayEventIndex(replay.events) };
    playback.set(replay, entry);
  }
  return entry;
}

export function replayEventIndex(replay: Replay): ReplayEventIndex {
  return cache(replay).events;
}

export function replayFrameAt(replay: Replay, ut: number): ReplayFrame {
  const entry = cache(replay);
  if (entry.frame?.ut !== ut) entry.frame = new ReplayFrame(replay, entry.events, ut);
  return entry.frame;
}

/** Current BDA side at playback time, using team_change events when present. */
export function sideAt(
  vessel: Pick<VesselTrack, 'id' | 'side'>,
  ut: number,
  events: ReplayEvent[],
): Side {
  let side: Side = vessel.side ?? 'neutral';
  for (const event of events) {
    if (event.type !== 'team_change' || event.vessel !== vessel.id || event.ut > ut) continue;
    const next = event.data?.side;
    if (next === 'blue' || next === 'red' || next === 'neutral') side = next;
  }
  return side;
}

export interface Selection {
  primaryId: string | null;
  secondaryId: string | null;
}

/**
 * Events relevant to the selected object. Actor events (gunfire, weapon
 * release) belong to the shooter; a miss belongs to the shooter even though
 * its `vessel` field is the target. Damage events stay visible on both the
 * victim and the shooter.
 */
export function eventsForSelection(events: ReplayEvent[], primaryId: string | null): ReplayEvent[] {
  if (primaryId === null) return events.slice();
  return events.filter((event) => {
    if (event.type === 'gunfire' || event.type === 'weapon_release') {
      return (event.vessel ?? event.source) === primaryId;
    }
    if (event.type === 'miss') {
      return (event.source ?? event.vessel) === primaryId;
    }
    return event.vessel === primaryId || event.source === primaryId || event.target === primaryId;
  });
}

/** Vessel to focus when an event row is activated. */
export function eventVesselId(event: ReplayEvent): string | null {
  // A miss is stored with the target as `vessel`; its actor is the shooter.
  if (event.type === 'miss') return event.source ?? event.vessel ?? null;
  return event.vessel ?? event.source ?? event.target ?? null;
}

/**
 * Weapons keep focus after impact/miss so the camera stays at the last known
 * position instead of jumping back to the launcher. Normal vessels still switch
 * away when they leave the visible window.
 */
export function shouldKeepSelection(
  vessel: { transient: boolean } | null | undefined,
  stillVisible: boolean,
): boolean {
  return stillVisible || vessel != null
}
