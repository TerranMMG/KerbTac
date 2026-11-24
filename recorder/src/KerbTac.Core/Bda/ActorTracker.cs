using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>
    /// Tracks BDA missile/bomb/rocket vessels across polls. The first sighting
    /// becomes a weapon_release, and HasExploded/HasMissed or a disappearance
    /// closes the actor. This replaces the unreliable MissileFire.firedMissiles
    /// counter, which is the number of missiles currently in flight.
    /// </summary>
    public sealed class ActorTracker
    {
        public const double MissingTimeoutSeconds = 2.0;

        private sealed class State
        {
            public ActorInput Last;
            public double LastSeenUt;
        }

        private readonly Dictionary<string, State> _states = new Dictionary<string, State>();
        private readonly HashSet<string> _ended = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>Drops all baseline state, e.g. when a new recording starts.</summary>
        public void Reset()
        {
            _states.Clear();
            _ended.Clear();
        }

        public ActorPollResult Poll(IEnumerable<ActorInput> inputs, double ut)
        {
            ActorPollResult result = new ActorPollResult();

            if (inputs != null)
            {
                foreach (ActorInput input in inputs)
                {
                    if (string.IsNullOrEmpty(input.ActorId) || _ended.Contains(input.ActorId))
                    {
                        continue;
                    }

                    State state;
                    if (!_states.TryGetValue(input.ActorId, out state))
                    {
                        state = new State { Last = input, LastSeenUt = ut };
                        _states[input.ActorId] = state;
                        result.Spawns.Add(new ActorSpawnSignal
                        {
                            ActorId = input.ActorId,
                            Name = input.Name,
                            Kind = BdaCombatKinds.ActorKind(input.ActorClass),
                            Side = input.Side,
                            ParentId = input.ParentId,
                            TargetId = input.TargetId,
                            Weapon = input.Weapon,
                            Ut = input.Ut,
                            ActorClass = input.ActorClass
                        });
                    }
                    else
                    {
                        state.Last = input;
                        state.LastSeenUt = ut;
                    }

                    if (input.HasExploded || input.HasMissed)
                    {
                        Finish(input, ut, input.HasExploded ? "exploded" : "missed", result);
                    }
                }
            }

            List<string> lost = new List<string>();
            foreach (KeyValuePair<string, State> pair in _states)
            {
                if (ut - pair.Value.LastSeenUt > MissingTimeoutSeconds)
                {
                    lost.Add(pair.Key);
                }
            }

            for (int i = 0; i < lost.Count; i++)
            {
                Finish(_states[lost[i]].Last, ut, "lost", result);
            }

            return result;
        }

        public bool Contains(string actorId)
        {
            return actorId != null && _states.ContainsKey(actorId);
        }

        private void Finish(ActorInput input, double ut, string reason, ActorPollResult result)
        {
            _states.Remove(input.ActorId);
            _ended.Add(input.ActorId);
            result.Ends.Add(EndOf(input, ut, reason));
        }

        private static ActorEndSignal EndOf(ActorInput input, double ut, string reason)
        {
            return new ActorEndSignal
            {
                ActorId = input.ActorId,
                ParentId = input.ParentId,
                TargetId = input.TargetId,
                Weapon = input.Weapon,
                Body = input.Body,
                Lat = input.Lat,
                Lon = input.Lon,
                Alt = input.Alt,
                Ut = ut,
                Reason = reason,
                ActorClass = input.ActorClass,
                TntMass = input.TntMass,
                Warhead = input.Warhead,
                ExplosionSource = input.ExplosionSource
            };
        }
    }
}
