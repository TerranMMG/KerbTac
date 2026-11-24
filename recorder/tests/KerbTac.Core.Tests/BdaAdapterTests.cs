using KerbTac;
using KerbTac.Recorder.Bda;
using Xunit;

namespace KerbTac.Core.Tests;

public class BdaAdapterTests
{
    [Fact]
    public void NullAdapterIsSafeAndNeutral()
    {
        var a = new NullBdaAdapter();
        Assert.False(a.IsAvailable);
        var s = a.Snapshot(null!);
        Assert.Equal("neutral", s.Side);
        Assert.Equal(1f, s.Health);
        Assert.Null(s.Team);
        Assert.Null(s.PrimaryWeapon);
        Assert.Null(s.LockedTargetId);
        Assert.Empty(a.DrainClosedLocks());
        Assert.Empty(a.DrainEffects());
    }

    [Fact]
    public void SampleHealthTracksBdaAndOmitsColumnWithoutBda()
    {
        var sample = new VesselSample { Health = 1.0 };
        BdaSampleHealth.Apply(ref sample, true, 0.42);
        Assert.Equal(0.42, sample.Health!.Value, 6);

        BdaSampleHealth.Apply(ref sample, true, 0.0);
        Assert.Equal(0.0, sample.Health);

        BdaSampleHealth.Apply(ref sample, false, 1.0);
        Assert.Null(sample.Health);

        BdaSampleHealth.Apply(ref sample, true, 1.5);
        Assert.Null(sample.Health);
    }
}
