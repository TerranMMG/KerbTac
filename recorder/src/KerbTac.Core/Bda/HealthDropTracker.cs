using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>
    /// Converts a sequence of BDA health ratios into hit signals. Small drops
    /// accumulate against the last reported baseline, and reports are throttled
    /// so a burst of bullet hits does not create one event per physics frame.
    /// </summary>
    public sealed class HealthDropTracker
    {
        public const float MinimumDrop = 0.002f;
        public const double MinimumIntervalSeconds = 0.5;

        private sealed class State
        {
            public bool Initialized;
            public float Baseline;
            public double LastEmitUt;
        }

        private readonly Dictionary<string, State> _states = new Dictionary<string, State>();

        /// <summary>Drops all baseline state, e.g. when a new recording starts.</summary>
        public void Clear()
        {
            _states.Clear();
        }
        private readonly List<HealthDropSignal> _drops = new List<HealthDropSignal>();

        public IReadOnlyList<HealthDropSignal> Poll(IEnumerable<HealthInput> inputs, double ut)
        {
            _drops.Clear();
            if (inputs == null)
            {
                return _drops;
            }

            foreach (HealthInput input in inputs)
            {
                if (input.VesselId == null || float.IsNaN(input.Health) || float.IsInfinity(input.Health))
                {
                    continue;
                }

                float health = Clamp01(input.Health);
                State state;
                if (!_states.TryGetValue(input.VesselId, out state))
                {
                    _states[input.VesselId] = new State
                    {
                        Initialized = true,
                        Baseline = health,
                        LastEmitUt = double.NegativeInfinity
                    };
                    continue;
                }

                if (health > state.Baseline)
                {
                    state.Baseline = health;
                    continue;
                }

                if (state.Baseline - health < MinimumDrop)
                {
                    continue;
                }

                if (ut - state.LastEmitUt < MinimumIntervalSeconds)
                {
                    continue;
                }

                _drops.Add(new HealthDropSignal
                {
                    VesselId = input.VesselId,
                    Ut = ut,
                    Before = state.Baseline,
                    After = health,
                    Damage = state.Baseline - health
                });
                state.Baseline = health;
                state.LastEmitUt = ut;
            }

            return _drops;
        }

        public void Remove(string vesselId)
        {
            if (vesselId != null)
            {
                _states.Remove(vesselId);
            }
        }

        private static float Clamp01(float value)
        {
            if (value < 0f) return 0f;
            if (value > 1f) return 1f;
            return value;
        }
    }
}
