using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>
    /// Detects countermeasure releases by watching CMDropper.cmCount decrease.
    /// BDA does not decrement the count in infinite-countermeasure mode, so that
    /// mode is a documented limitation.
    /// </summary>
    public sealed class CountermeasureTracker
    {
        private sealed class State
        {
            public bool Initialized;
            public int LastCount;
        }

        private readonly Dictionary<string, State> _states = new Dictionary<string, State>();

        /// <summary>Drops all baseline state, e.g. when a new recording starts.</summary>
        public void Reset()
        {
            _states.Clear();
        }
        private readonly List<CountermeasureReleaseSignal> _released = new List<CountermeasureReleaseSignal>();

        public IReadOnlyList<CountermeasureReleaseSignal> Poll(IEnumerable<CountermeasureInput> inputs)
        {
            _released.Clear();
            if (inputs == null)
            {
                return _released;
            }

            foreach (CountermeasureInput input in inputs)
            {
                string key = input.VesselId + "|" + input.PartId + "|" + input.ModuleIndex;
                State state;
                if (!_states.TryGetValue(key, out state))
                {
                    state = new State { Initialized = true, LastCount = input.Count };
                    _states[key] = state;
                    continue;
                }

                int previous = state.LastCount;
                state.LastCount = input.Count;
                if (input.Count >= previous)
                {
                    // Reload (or no change). Do not report a release.
                    continue;
                }

                int count = previous - input.Count;
                if (count > 128)
                {
                    // A suspicious jump is more likely a reload/refresh artefact
                    // than 128 countermeasures in one physics frame.
                    count = 1;
                }

                BdaCountermeasureKind kind = BdaCombatKinds.CountermeasureKind(input.CountermeasureType);
                _released.Add(new CountermeasureReleaseSignal
                {
                    VesselId = input.VesselId,
                    PartId = input.PartId,
                    ModuleIndex = input.ModuleIndex,
                    Ut = input.Ut,
                    EndUt = input.Ut,
                    Count = count,
                    Kind = kind,
                    CountermeasureType = input.CountermeasureType,
                    EjectVelocity = input.EjectVelocity,
                    PositionBf = input.PositionBf,
                    DirectionBf = input.DirectionBf,
                    VelocityBf = input.VesselVelocityBf + input.DirectionBf.Normalized() * input.EjectVelocity
                });
            }

            return _released;
        }
    }
}
