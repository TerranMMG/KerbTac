using System.Collections.Generic;
using KerbTac;

namespace KerbTac.Recorder.Bda
{
    /// <summary>Neutral adapter used when BDArmory is absent or reflection fails.</summary>
    public sealed class NullBdaAdapter : IBdaAdapter
    {
        private static readonly BdaLockSnapshot[] NoLocks = new BdaLockSnapshot[0];
        private static readonly BdaEffectSnapshot[] NoEffects = new BdaEffectSnapshot[0];

        public bool IsAvailable
        {
            get { return false; }
        }

        public BdaVesselSnapshot Snapshot(Vessel vessel)
        {
            return new BdaVesselSnapshot
            {
                Team = null,
                Side = "neutral",
                Health = 1f,
                PrimaryWeapon = null,
                LockedTargetId = null
            };
        }

        public IReadOnlyList<BdaLockSnapshot> DrainClosedLocks()
        {
            return NoLocks;
        }

        public IReadOnlyList<BdaEffectSnapshot> DrainEffects()
        {
            return NoEffects;
        }
    }
}
