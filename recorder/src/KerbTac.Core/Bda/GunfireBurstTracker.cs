using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>
    /// Groups individual ModuleWeapon shots into short bursts. A burst ends when
    /// the weapon has not fired for <see cref="GapSeconds"/>, when the muzzle
    /// direction changes by more than <see cref="MaxDirectionChangeDeg"/>, or
    /// after <see cref="MaxBurstSeconds"/> so replay tracers stay manageable.
    /// </summary>
    public sealed class GunfireBurstTracker
    {
        public const double GapSeconds = 0.4;
        public const double MaxBurstSeconds = 0.75;
        public const double MaxDirectionChangeDeg = 8.0;

        private sealed class WeaponState
        {
            public bool Initialized;
            public double LastTimeFired;
            public int LastRoundsRemaining;
            public double LastSeenUt;
            public Burst Active;
        }

        private sealed class Burst
        {
            public string VesselId;
            public string PartId;
            public int ModuleIndex;
            public double StartUt;
            public double LastShotUt;
            public int Rounds;
            public Vec3d PositionBf;
            public Vec3d DirectionBf;
            public Vec3d EndDirectionBf;
            public double RoundsPerMinute;
            public string WeaponType;
            public string Ammo;
            public double Caliber;
            public double MuzzleSpeed;
            public string TracerColor;
        }

        private readonly Dictionary<string, WeaponState> _states = new Dictionary<string, WeaponState>();

        /// <summary>Drops all baseline state, e.g. when a new recording starts.</summary>
        public void Reset()
        {
            _states.Clear();
        }
        private readonly List<GunfireBurstSignal> _completed = new List<GunfireBurstSignal>();

        public IReadOnlyList<GunfireBurstSignal> Poll(IEnumerable<GunfireInput> inputs)
        {
            _completed.Clear();
            if (inputs != null)
            {
                foreach (GunfireInput input in inputs)
                {
                    Observe(input);
                }
            }
            return _completed;
        }

        /// <summary>Closes bursts whose last shot is older than the gap.</summary>
        public IReadOnlyList<GunfireBurstSignal> FlushStale(double ut)
        {
            _completed.Clear();
            List<string> keys = new List<string>(_states.Keys);
            for (int i = 0; i < keys.Count; i++)
            {
                WeaponState state;
                if (!_states.TryGetValue(keys[i], out state) || state.Active == null)
                {
                    continue;
                }
                if (ut - state.Active.LastShotUt > GapSeconds)
                {
                    Flush(state);
                }
            }
            return _completed;
        }

        /// <summary>Closes every active burst; call when recording stops.</summary>
        public IReadOnlyList<GunfireBurstSignal> FlushAll()
        {
            _completed.Clear();
            List<string> keys = new List<string>(_states.Keys);
            for (int i = 0; i < keys.Count; i++)
            {
                WeaponState state;
                if (_states.TryGetValue(keys[i], out state))
                {
                    Flush(state);
                }
            }
            return _completed;
        }

        private void Observe(GunfireInput input)
        {
            string key = input.VesselId + "|" + input.PartId + "|" + input.ModuleIndex;
            WeaponState state;
            if (!_states.TryGetValue(key, out state))
            {
                state = new WeaponState();
                _states[key] = state;
            }

            if (!state.Initialized)
            {
                state.Initialized = true;
                state.LastTimeFired = input.TimeFired;
                state.LastRoundsRemaining = input.RoundsRemaining;
                state.LastSeenUt = input.Ut;
                return;
            }

            double dt = input.Ut - state.LastSeenUt;
            state.LastSeenUt = input.Ut;

            if (Math.Abs(input.TimeFired - state.LastTimeFired) < 1e-4)
            {
                return;
            }

            if (dt < 0)
            {
                dt = 0;
            }

            int rounds = EstimateRounds(input, state.LastRoundsRemaining, dt);
            if (input.IsReloading || input.RoundsRemaining < state.LastRoundsRemaining)
            {
                Flush(state);
                rounds = 1;
            }

            if (state.Active == null)
            {
                state.Active = Start(input, rounds);
            }
            else
            {
                bool tooLong = input.Ut - state.Active.StartUt >= MaxBurstSeconds;
                bool gap = input.Ut - state.Active.LastShotUt > GapSeconds;
                bool turned = state.Active.DirectionBf.AngleDegrees(input.DirectionBf) > MaxDirectionChangeDeg;
                if (tooLong || gap || turned)
                {
                    Flush(state);
                    state.Active = Start(input, rounds);
                }
                else
                {
                    state.Active.Rounds += rounds;
                    state.Active.LastShotUt = input.Ut;
                    state.Active.EndDirectionBf = input.DirectionBf;
                    state.Active.RoundsPerMinute = input.RoundsPerMinute;
                }
            }

            state.LastTimeFired = input.TimeFired;
            state.LastRoundsRemaining = input.RoundsRemaining;
        }

        private static int EstimateRounds(GunfireInput input, int lastRounds, double dt)
        {
            if (input.IsReloading || input.RoundsRemaining < lastRounds)
            {
                return 1;
            }

            int delta = input.RoundsRemaining - lastRounds;
            double expected = input.RoundsPerMinute > 0 ? input.RoundsPerMinute * dt / 60.0 : 1;
            int maxReasonable = (int)Math.Ceiling(expected * 3.0) + 2;
            if (delta > 0 && delta <= maxReasonable)
            {
                return delta;
            }

            int estimate = (int)Math.Round(expected);
            return estimate < 1 ? 1 : estimate;
        }

        private static Burst Start(GunfireInput input, int rounds)
        {
            return new Burst
            {
                VesselId = input.VesselId,
                PartId = input.PartId,
                ModuleIndex = input.ModuleIndex,
                StartUt = input.Ut,
                LastShotUt = input.Ut,
                Rounds = rounds < 1 ? 1 : rounds,
                PositionBf = input.PositionBf,
                DirectionBf = input.DirectionBf,
                EndDirectionBf = input.DirectionBf,
                RoundsPerMinute = input.RoundsPerMinute,
                WeaponType = input.WeaponType,
                Ammo = input.Ammo,
                Caliber = input.Caliber,
                MuzzleSpeed = input.MuzzleSpeed,
                TracerColor = input.TracerColor
            };
        }

        private void Flush(WeaponState state)
        {
            Burst burst = state.Active;
            if (burst == null)
            {
                return;
            }

            state.Active = null;
            _completed.Add(new GunfireBurstSignal
            {
                VesselId = burst.VesselId,
                PartId = burst.PartId,
                ModuleIndex = burst.ModuleIndex,
                StartUt = burst.StartUt,
                EndUt = burst.LastShotUt,
                Rounds = burst.Rounds,
                PositionBf = burst.PositionBf,
                DirectionBf = burst.DirectionBf,
                EndDirectionBf = burst.EndDirectionBf,
                RoundsPerMinute = burst.RoundsPerMinute,
                WeaponType = burst.WeaponType,
                Ammo = burst.Ammo,
                Caliber = burst.Caliber,
                MuzzleSpeed = burst.MuzzleSpeed,
                TracerColor = burst.TracerColor
            });
        }
    }
}
