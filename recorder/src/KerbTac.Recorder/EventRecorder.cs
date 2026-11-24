using System;
using System.Collections.Generic;
using KerbTac.Core;
using UnityEngine;

namespace KerbTac.Recorder
{
    /// <summary>Collects session events and normalizes their order.</summary>
    internal sealed class EventRecorder
    {
        private readonly List<KerbTacEvent> _events = new List<KerbTacEvent>();

        public int Count
        {
            get { return _events.Count; }
        }

        public void Clear()
        {
            _events.Clear();
        }

        public void Add(KerbTacEvent evt)
        {
            if (evt == null)
            {
                return;
            }
            _events.Add(evt);
        }

        public KerbTacEvent Add(string type, double ut, Vessel vessel)
        {
            KerbTacEvent evt = new KerbTacEvent
            {
                Ut = ut,
                Type = type,
                VesselId = vessel != null ? vessel.id.ToString() : null
            };

            if (vessel != null && vessel.mainBody != null)
            {
                try
                {
                    evt.WithPosition(
                        BodyCatalog.BodyName(vessel.mainBody),
                        vessel.latitude,
                        vessel.longitude,
                        vessel.altitude);
                }
                catch (Exception ex)
                {
                    // A vessel that is being destroyed may no longer expose a
                    // valid transform; the event itself is still worth keeping.
                    Log.Warn("Could not capture event position: " + ex.Message);
                }
            }

            _events.Add(evt);
            return evt;
        }

        public KerbTacEvent AddNote(string text, double ut)
        {
            KerbTacEvent evt = new KerbTacEvent
            {
                Ut = ut,
                Type = EventTypes.Note
            };
            evt.WithData("text", JsonValue.Str(text));
            _events.Add(evt);
            return evt;
        }

        /// <summary>
        /// Records a hard impact. This is deliberately not a crash: the vessel
        /// may survive, and only the loss of a vessel ends the timeline.
        /// </summary>
        public KerbTacEvent RecordImpact(Vessel vessel, double impactSpeed, string partId)
        {
            KerbTacEvent evt = Add(EventTypes.Impact, Planetarium.GetUniversalTime(), vessel);
            evt.WithData("speed", JsonValue.Num(impactSpeed));
            if (!string.IsNullOrEmpty(partId))
            {
                evt.WithData("partId", JsonValue.Str(partId));
            }
            return evt;
        }

        /// <summary>
        /// Records a destroyed vessel: "crash" for the active vessel and
        /// "destroyed" for another tracked vessel.
        /// </summary>
        public KerbTacEvent RecordDestroyed(Vessel vessel, bool active, string reason)
        {
            string type = CrashClassifier.Classify(true, active, vessel != null ? vessel.srfSpeed : 0);
            KerbTacEvent evt = Add(type, Planetarium.GetUniversalTime(), vessel);
            evt.WithData("reason", JsonValue.Str(reason));
            return evt;
        }

        /// <summary>Records a destroyed vessel with combat attribution when possible.</summary>
        public KerbTacEvent RecordKill(Vessel vessel, string attackerId, string weapon, string actorId)
        {
            KerbTacEvent evt = Add(EventTypes.Kill, Planetarium.GetUniversalTime(), vessel);
            if (!string.IsNullOrEmpty(attackerId))
            {
                evt.WithSource(attackerId);
            }
            if (!string.IsNullOrEmpty(weapon))
            {
                evt.WithWeapon(weapon);
            }
            evt.WithOutcome("killed");
            if (!string.IsNullOrEmpty(actorId))
            {
                evt.WithData("actorId", JsonValue.Str(actorId));
            }
            return evt;
        }

        /// <summary>
        /// Drops a stale miss for a weapon that later produced a kill, and
        /// coalesces engine ignition/shutdown bursts caused by jet mode changes.
        /// </summary>
        public void NormalizeCombat()
        {
            HashSet<string> killedActors = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < _events.Count; i++)
            {
                KerbTacEvent evt = _events[i];
                if (evt.Type != EventTypes.Kill) continue;
                string actor = DataText(evt, "actorId");
                if (!string.IsNullOrEmpty(actor)) killedActors.Add(actor);
            }

            for (int i = _events.Count - 1; i >= 0; i--)
            {
                KerbTacEvent evt = _events[i];
                if (evt.Type != EventTypes.Miss) continue;
                string actor = DataText(evt, "actorId");
                if (!string.IsNullOrEmpty(actor) && killedActors.Contains(actor))
                {
                    _events.RemoveAt(i);
                }
            }

            _events.Sort((a, b) => a.Ut.CompareTo(b.Ut));
            List<KerbTacEvent> merged = new List<KerbTacEvent>(_events.Count);
            List<KerbTacEvent> group = new List<KerbTacEvent>();
            string groupKey = null;
            double groupStartUt = 0.0;

            Action flush = delegate
            {
                if (group.Count == 0) return;
                int ignitions = 0;
                int shutdowns = 0;
                for (int g = 0; g < group.Count; g++)
                {
                    if (group[g].Type == EventTypes.EngineIgnition) ignitions++;
                    else if (group[g].Type == EventTypes.EngineShutdown) shutdowns++;
                }
                if (ignitions > 0 && shutdowns > 0)
                {
                    KerbTacEvent mode = group[0];
                    mode.Type = EventTypes.EngineModeChange;
                    mode.WithData("count", JsonValue.Num(ignitions + shutdowns));
                    mode.WithData("ignitions", JsonValue.Num(ignitions));
                    mode.WithData("shutdowns", JsonValue.Num(shutdowns));
                    merged.Add(mode);
                }
                else
                {
                    KerbTacEvent first = group[0];
                    first.WithData("count", JsonValue.Num(group.Count));
                    merged.Add(first);
                }
                group.Clear();
                groupKey = null;
            };

            for (int i = 0; i < _events.Count; i++)
            {
                KerbTacEvent evt = _events[i];
                bool engine = evt.Type == EventTypes.EngineIgnition ||
                              evt.Type == EventTypes.EngineShutdown;
                if (!engine)
                {
                    flush();
                    merged.Add(evt);
                    continue;
                }

                // Merge all engine modules on the vessel, not just one part:
                // twin-engine aircraft often toggle two separate engine parts.
                string key = evt.VesselId ?? "";
                if (group.Count > 0 &&
                    (string.Equals(groupKey, key, StringComparison.Ordinal) == false ||
                     evt.Ut - groupStartUt > 2.0))
                {
                    flush();
                }
                if (group.Count == 0)
                {
                    groupKey = key;
                    groupStartUt = evt.Ut;
                }
                group.Add(evt);
            }
            flush();
            _events.Clear();
            _events.AddRange(merged);
        }

        private static string DataText(KerbTacEvent evt, string name)
        {
            for (int i = 0; i < evt.Data.Count; i++)
            {
                if (string.Equals(evt.Data[i].Name, name, StringComparison.Ordinal) &&
                    evt.Data[i].Value.Kind == EventValueKind.String)
                {
                    return evt.Data[i].Value.StringValue;
                }
            }
            return null;
        }

        private static double? DataNumber(KerbTacEvent evt, string name)
        {
            for (int i = 0; i < evt.Data.Count; i++)
            {
                if (string.Equals(evt.Data[i].Name, name, StringComparison.Ordinal) &&
                    evt.Data[i].Value.Kind == EventValueKind.Number)
                {
                    return evt.Data[i].Value.NumberValue;
                }
            }
            return null;
        }

        /// <summary>Stable sort by UT so equal timestamps keep insertion order.</summary>
        public List<KerbTacEvent> Sorted()
        {
            List<KerbTacEvent> copy = new List<KerbTacEvent>(_events);
            copy.Sort((a, b) => a.Ut.CompareTo(b.Ut));
            return copy;
        }
    }
}
