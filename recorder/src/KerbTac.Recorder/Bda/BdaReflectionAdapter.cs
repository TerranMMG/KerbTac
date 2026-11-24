using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using KerbTac.Core.Bda;

// This file is compiled by net472 (nullable disabled) and by the net8 test
// project (nullable enabled). The annotations are meaningful only in the
// latter, where KSP-facing nullability is intentionally open.
#pragma warning disable CS8600, CS8601, CS8602, CS8603, CS8604, CS8618, CS8619, CS8625

namespace KerbTac.Recorder.Bda
{
    /// <summary>
    /// Best-effort, reflection-only bridge to BDArmory. No BDA assembly is
    /// referenced at compile time; if any type or member is missing the
    /// adapter stays unavailable and recording continues normally.
    /// </summary>
    public sealed class BdaReflectionAdapter : IBdaAdapter
    {
        private sealed class ActiveLock
        {
            public string TargetId;
            public string Sensor;
            public string Mode;
            public double StartUt;
        }

        private static readonly BdaEffectSnapshot[] NoEffects = new BdaEffectSnapshot[0];
        private static readonly BdaLockSnapshot[] NoLocks = new BdaLockSnapshot[0];

        private readonly Type _missileFireType;
        private readonly Type _radarType;
        private readonly Type _hitpointType;
        private readonly Func<double> _utProvider;
        private readonly Action<string> _warn;
        private readonly Dictionary<string, ActiveLock> _activeLocks = new Dictionary<string, ActiveLock>();
        private readonly List<BdaLockSnapshot> _closedLocks = new List<BdaLockSnapshot>();
        private readonly HashSet<string> _warned = new HashSet<string>();
        private bool _stopped;

        public BdaReflectionAdapter(IEnumerable<Assembly> assemblies)
            : this(assemblies, null, null)
        {
        }

        public BdaReflectionAdapter(IEnumerable<Assembly> assemblies, Func<double> utProvider, Action<string> warn)
        {
            _utProvider = utProvider;
            _warn = warn;
            _missileFireType = FindType(assemblies, "MissileFire");
            _radarType = FindType(assemblies, "VesselRadarData");
            _hitpointType = FindType(assemblies, "HitpointTracker");
        }

        public bool IsAvailable
        {
            get { return _missileFireType != null || _radarType != null || _hitpointType != null; }
        }

        public BdaVesselSnapshot Snapshot(Vessel vessel)
        {
            BdaVesselSnapshot snapshot = Neutral();
            if (!IsAvailable || vessel == null)
            {
                return snapshot;
            }

            // Availability says BDA types exist, not that this vessel has HP data.
            snapshot.Health = float.NaN;
            try
            {
                object fire = FindModule(vessel, _missileFireType);
                object teamValue = BdaReflectionCache.Get(fire, "teamString", "TeamName", "team", "Team");
                string team = AsString(teamValue);
                if (team == null)
                {
                    team = NameOf(teamValue);
                }
                snapshot.Team = team;
                snapshot.Side = NormalizeSide(team);

                snapshot.Health = ReadHealth(vessel);

                object weapon = BdaReflectionCache.Get(
                    fire, "CurrentMissile", "currentWeapon", "selectedWeapon", "weaponName");
                snapshot.PrimaryWeapon = NameOf(weapon);
                snapshot.FiredMissiles = (int)ToDouble(
                    BdaReflectionCache.Get(fire, "firedMissiles", "FiredMissiles"), -1.0);

                object radar = FindModule(vessel, _radarType);
                string targetId = null;
                bool radarLock = false;
                if (radar != null)
                {
                    bool locked = ToBool(BdaReflectionCache.Get(radar, "locked", "Locked"), false);
                    if (locked)
                    {
                        object lockedData = BdaReflectionCache.Get(
                            radar, "lockedTargetData", "LockedTargetData");
                        object lockedVessel = BdaReflectionCache.Get(lockedData, "vessel", "Vessel");
                        targetId = TargetIdOf(lockedVessel);
                        radarLock = targetId != null;
                    }
                }
                if (targetId == null)
                {
                    object tracked = BdaReflectionCache.Get(
                        fire, "guardTarget", "currentTarget", "targetOverride",
                        "lockedVessel", "lockedTarget");
                    targetId = TargetIdOf(tracked);
                }
                snapshot.LockedTargetId = targetId;

                if (!_stopped)
                {
                    UpdateLock(IdOf(vessel), targetId, Now(), radarLock ? "stt" : "track");
                }
            }
            catch (Exception ex)
            {
                WarnOnce("snapshot", "snapshot failed: " + ex.Message);
            }

            return snapshot;
        }

        /// <summary>Re-arms the adapter for a new recording.</summary>
        public void Reset()
        {
            _stopped = false;
            _activeLocks.Clear();
            _closedLocks.Clear();
        }

        /// <summary>Closes all open lock intervals; called when recording stops.</summary>
        public void Stop()
        {
            if (_stopped)
            {
                return;
            }

            double now = Now();
            List<string> sources = new List<string>(_activeLocks.Keys);
            for (int i = 0; i < sources.Count; i++)
            {
                CloseLock(sources[i], now);
            }
            _stopped = true;
        }

        public IReadOnlyList<BdaLockSnapshot> DrainClosedLocks()
        {
            if (_closedLocks.Count == 0)
            {
                return NoLocks;
            }

            BdaLockSnapshot[] result = _closedLocks.ToArray();
            _closedLocks.Clear();
            return result;
        }

        /// <summary>
        /// Countermeasure/effect counters cannot be read reliably across BDA
        /// versions, so effects are simply not emitted rather than guessed.
        /// </summary>
        public IReadOnlyList<BdaEffectSnapshot> DrainEffects()
        {
            return NoEffects;
        }

        private void UpdateLock(string sourceId, string targetId, double now, string mode)
        {
            if (string.IsNullOrEmpty(sourceId) || sourceId == targetId)
            {
                if (sourceId != null)
                {
                    CloseLock(sourceId, now);
                }
                return;
            }

            ActiveLock active;
            _activeLocks.TryGetValue(sourceId, out active);

            if (active != null && string.Equals(active.TargetId, targetId, StringComparison.Ordinal))
            {
                return;
            }

            if (active != null)
            {
                CloseLock(sourceId, now);
            }

            if (targetId == null || _stopped)
            {
                return;
            }

            _activeLocks[sourceId] = new ActiveLock
            {
                TargetId = targetId,
                Sensor = "radar",
                Mode = mode,
                StartUt = now
            };
        }

        private void CloseLock(string sourceId, double now)
        {
            ActiveLock active;
            if (!_activeLocks.TryGetValue(sourceId, out active))
            {
                return;
            }

            _activeLocks.Remove(sourceId);
            _closedLocks.Add(new BdaLockSnapshot
            {
                SourceId = sourceId,
                TargetId = active.TargetId,
                Sensor = active.Sensor,
                Mode = active.Mode,
                StartUt = active.StartUt,
                EndUt = Math.Max(active.StartUt, now)
            });
        }

        private double Now()
        {
            if (_utProvider == null)
            {
                return 0.0;
            }

            try
            {
                return _utProvider();
            }
            catch
            {
                return 0.0;
            }
        }

        private static BdaVesselSnapshot Neutral()
        {
            return new BdaVesselSnapshot
            {
                Team = null,
                Side = "neutral",
                Health = 1f,
                PrimaryWeapon = null,
                LockedTargetId = null,
                FiredMissiles = -1
            };
        }

        private object FindModule(Vessel vessel, Type moduleType)
        {
            if (vessel == null || moduleType == null)
            {
                return null;
            }

            try
            {
                object partsValue = BdaReflectionCache.Get(vessel, "parts", "Parts");
                IEnumerable parts = partsValue as IEnumerable;
                if (parts == null)
                {
                    return null;
                }

                foreach (object part in parts)
                {
                    if (part == null)
                    {
                        continue;
                    }

                    object modulesValue = BdaReflectionCache.Get(part, "Modules", "modules");
                    IEnumerable modules = modulesValue as IEnumerable;
                    if (modules == null)
                    {
                        continue;
                    }

                    foreach (object module in modules)
                    {
                        if (module != null && moduleType.IsAssignableFrom(module.GetType()))
                        {
                            return module;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                WarnOnce("modules", "module scan failed: " + ex.Message);
            }

            return null;
        }

        private float ReadHealth(Vessel vessel)
        {
            if (vessel == null || _hitpointType == null)
            {
                return float.NaN;
            }

            double current = 0.0;
            double max = 0.0;
            bool found = false;
            try
            {
                object partsValue = BdaReflectionCache.Get(vessel, "parts", "Parts");
                IEnumerable parts = partsValue as IEnumerable;
                if (parts == null) return float.NaN;
                foreach (object part in parts)
                {
                    if (part == null) continue;
                    object modulesValue = BdaReflectionCache.Get(part, "Modules", "modules");
                    IEnumerable modules = modulesValue as IEnumerable;
                    if (modules == null) continue;
                    foreach (object module in modules)
                    {
                        if (module == null || !_hitpointType.IsAssignableFrom(module.GetType())) continue;
                        double partCurrent = ToDouble(Get(module, "Hitpoints", "hitPoints", "hitpoints"), double.NaN);
                        double partMax = ToDouble(Get(module, "maxHitPoints", "maxHitpoints", "MaxHitpoints"), double.NaN);
                        if (double.IsNaN(partCurrent) || double.IsInfinity(partCurrent) ||
                            double.IsNaN(partMax) || double.IsInfinity(partMax) || partMax <= 0) continue;
                        current += Math.Max(0.0, partCurrent);
                        max += partMax;
                        found = true;
                    }
                }
            }
            catch (Exception ex)
            {
                WarnOnce("health", "health scan failed: " + ex.Message);
                return float.NaN;
            }

            if (!found || max <= 0) return float.NaN;
            double ratio = current / max;
            if (ratio < 0) return 0f;
            if (ratio > 1) return 1f;
            return (float)ratio;
        }

        private object Get(object instance, params string[] names)
        {
            object value = BdaReflectionCache.Get(instance, names);
            if (value == null && instance != null)
            {
                WarnOnce("field:" + names[0],
                    "field '" + names[0] + "' not found on " + instance.GetType().Name);
            }
            return value;
        }

        private static double ToDouble(object value, double fallback)
        {
            if (value == null)
            {
                return fallback;
            }

            try
            {
                return Convert.ToDouble(value);
            }
            catch
            {
                return fallback;
            }
        }

        private static string AsString(object value)
        {
            return value as string;
        }

        private static bool ToBool(object value, bool fallback)
        {
            if (value == null)
            {
                return fallback;
            }

            if (value is bool)
            {
                return (bool)value;
            }

            bool parsed;
            return bool.TryParse(value.ToString(), out parsed) ? parsed : fallback;
        }

        private static string NameOf(object value)
        {
            if (value == null)
            {
                return null;
            }

            string text = value as string;
            if (text != null)
            {
                return text;
            }

            string name = BdaReflectionCache.Get(
                value, "name", "Name", "DisplayName", "shortName", "weaponName") as string;
            if (name != null)
            {
                return name;
            }

            try
            {
                return value.ToString();
            }
            catch
            {
                return null;
            }
        }

        private static string TargetIdOf(object value)
        {
            if (value == null)
            {
                return null;
            }

            string direct = IdOf(value);
            if (direct != null)
            {
                return direct;
            }

            object nested = BdaReflectionCache.Get(value, "Vessel", "vessel");
            return IdOf(nested);
        }

        private static string IdOf(object value)
        {
            if (value == null)
            {
                return null;
            }

            string text = value as string;
            if (text != null)
            {
                return text;
            }

            object id = BdaReflectionCache.Get(value, "id", "Id", "flightID", "FlightID");
            if (id == null)
            {
                return null;
            }

            Guid guid;
            if (id is Guid)
            {
                guid = (Guid)id;
                return guid.ToString();
            }

            return id.ToString();
        }

        private static string NormalizeSide(string team)
        {
            if (string.IsNullOrEmpty(team))
            {
                return "neutral";
            }

            string lower = team.Trim().ToLowerInvariant();
            if (lower == "a")
            {
                return "blue";
            }
            if (lower == "b")
            {
                return "red";
            }

            if (lower.Contains("blue") || lower.Contains("friendly") ||
                lower.Contains("ally") || lower.Contains("allied"))
            {
                return "blue";
            }

            if (lower.Contains("red") || lower.Contains("enemy") ||
                lower.Contains("hostile"))
            {
                return "red";
            }

            return "neutral";
        }

        private void WarnOnce(string key, string message)
        {
            if (_warn == null || !_warned.Add(key))
            {
                return;
            }

            try
            {
                _warn("BDA " + message);
            }
            catch
            {
                // Logging must never break recording.
            }
        }

        private static Type FindType(IEnumerable<Assembly> assemblies, string name)
        {
            if (assemblies == null)
            {
                return null;
            }

            foreach (Assembly assembly in assemblies)
            {
                if (assembly == null)
                {
                    continue;
                }

                Type[] types;
                try
                {
                    types = assembly.GetTypes();
                }
                catch (ReflectionTypeLoadException ex)
                {
                    types = ex.Types;
                }
                catch
                {
                    continue;
                }

                if (types == null)
                {
                    continue;
                }

                for (int i = 0; i < types.Length; i++)
                {
                    Type type = types[i];
                    if (type != null && string.Equals(type.Name, name, StringComparison.Ordinal))
                    {
                        return type;
                    }
                }
            }

            return null;
        }
    }
}
