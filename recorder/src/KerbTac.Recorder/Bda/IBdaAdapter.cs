using System.Collections.Generic;
using KerbTac;

namespace KerbTac.Recorder.Bda
{
    /// <summary>
    /// Optional bridge to BDArmory. Implementations must never throw: a missing or
    /// changed BDA installation degrades to <see cref="NullBdaAdapter"/> behaviour.
    /// </summary>
    public interface IBdaAdapter
    {
        bool IsAvailable { get; }
        BdaVesselSnapshot Snapshot(Vessel vessel);
        IReadOnlyList<BdaLockSnapshot> DrainClosedLocks();
        IReadOnlyList<BdaEffectSnapshot> DrainEffects();
    }
}
