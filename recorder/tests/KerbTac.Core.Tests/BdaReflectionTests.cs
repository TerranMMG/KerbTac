using System;
using System.Collections.Generic;
using KerbTac.Core.Bda;
using KerbTac.Recorder.Bda;
using Xunit;

namespace KerbTac.Core.Tests;

public class BdaReflectionTests
{
    private sealed class FakeMissileFire
    {
        public string team = "Blue";
        public object currentTarget = "red-1";

        public string Throwing
        {
            get { throw new InvalidOperationException("cannot read"); }
        }
    }

    [Fact]
    public void ReflectionCacheReadsFirstExistingName()
    {
        var fake = new FakeMissileFire { team = "Blue", currentTarget = "red-1" };
        Assert.Equal("Blue", BdaReflectionCache.Get(fake, "team", "Team"));
        Assert.Equal("red-1", BdaReflectionCache.Get(fake, "guardTarget", "currentTarget"));
    }

    [Fact]
    public void ReflectionCacheFallsBackWhenAMemberThrows()
    {
        var fake = new FakeMissileFire();
        Assert.Equal("Blue", BdaReflectionCache.Get(fake, "Throwing", "team"));
    }

    [Fact]
    public void AdapterWithoutBdaTypesIsUnavailable()
    {
        var a = new BdaReflectionAdapter(new[] { typeof(Uri).Assembly });
        Assert.False(a.IsAvailable);
        var snapshot = a.Snapshot(null!);
        Assert.Equal("neutral", snapshot.Side);
        Assert.Equal(1f, snapshot.Health);
        Assert.Equal(-1, snapshot.FiredMissiles);
        Assert.Empty(a.DrainClosedLocks());
        Assert.Empty(a.DrainEffects());
    }

    [Fact]
    public void AdapterReadsTeamWeaponHealthAndRadarLock()
    {
        double now = 100.0;
        var adapter = new BdaReflectionAdapter(
            new[] { typeof(MissileFire).Assembly }, () => now, null);

        var target = new Vessel { vesselName = "target" };
        var radar = new VesselRadarData
        {
            locked = true,
            lockedTargetData = new RadarDisplayData { vessel = target }
        };
        var fire = new MissileFire
        {
            teamString = "A",
            CurrentMissile = new FakeWeapon { name = "AIM-120" },
            firedMissiles = 2
        };
        var hitpoints = new HitpointTracker { Hitpoints = 50, maxHitpoints = 100 };
        var vessel = new Vessel { vesselName = "shooter" };
        vessel.parts.Add(new FakePart { Modules = { fire, radar, hitpoints } });

        var snapshot = adapter.Snapshot(vessel);

        Assert.Equal("A", snapshot.Team);
        Assert.Equal("blue", snapshot.Side);
        Assert.Equal(0.5f, snapshot.Health);
        Assert.Equal("AIM-120", snapshot.PrimaryWeapon);
        Assert.Equal(2, snapshot.FiredMissiles);
        Assert.Equal(target.id.ToString(), snapshot.LockedTargetId);

        now = 110.0;
        radar.locked = false;
        adapter.Snapshot(vessel);

        var locks = adapter.DrainClosedLocks();
        Assert.Single(locks);
        Assert.Equal(vessel.id.ToString(), locks[0].SourceId);
        Assert.Equal(target.id.ToString(), locks[0].TargetId);
        Assert.Equal("stt", locks[0].Mode);
        Assert.Equal(100.0, locks[0].StartUt);
        Assert.Equal(110.0, locks[0].EndUt);
    }

    [Fact]
    public void AvailableAdapterDistinguishesMissingHitpointsFromMeasuredZero()
    {
        var adapter = new BdaReflectionAdapter(new[] { typeof(MissileFire).Assembly });
        var vessel = new Vessel();
        Assert.True(adapter.IsAvailable);
        Assert.True(float.IsNaN(adapter.Snapshot(vessel).Health));

        var hitpoints = new HitpointTracker { Hitpoints = 0, maxHitpoints = 100 };
        vessel.parts.Add(new FakePart { Modules = { hitpoints } });
        Assert.Equal(0f, adapter.Snapshot(vessel).Health);
    }

    [Fact]
    public void AdapterFallsBackToGuardTargetAndTrackModeWithoutRadarLock()
    {
        var adapter = new BdaReflectionAdapter(
            new[] { typeof(MissileFire).Assembly }, () => 5.0, null);
        var target = new Vessel { vesselName = "guard target" };
        var fire = new MissileFire { teamString = "A" };
        fire.SetGuardTarget(target);
        var vessel = new Vessel();
        vessel.parts.Add(new FakePart { Modules = { fire } });

        Assert.Equal(target.id.ToString(), adapter.Snapshot(vessel).LockedTargetId);

        adapter.Stop();
        var locks = adapter.DrainClosedLocks();
        Assert.Single(locks);
        Assert.Equal("track", locks[0].Mode);
    }

    [Fact]
    public void AdapterMapsTeamBToRed()
    {
        var adapter = new BdaReflectionAdapter(
            new[] { typeof(MissileFire).Assembly }, () => 1.0, null);
        var vessel = new Vessel();
        vessel.parts.Add(new FakePart
        {
            Modules = { new MissileFire { teamString = "B" } }
        });

        Assert.Equal("red", adapter.Snapshot(vessel).Side);
    }
}

internal sealed class FakePart
{
    public List<object> Modules = new List<object>();
}

internal sealed class FakeWeapon
{
    public string name = "AIM-120";
}

// These names must match BDArmory's type names: the adapter locates them by
// simple name through reflection, exactly as it does in the game.
public sealed class MissileFire
{
    public string teamString = "Neutral";
    public object CurrentMissile;
    public int firedMissiles;
    private Vessel guardTarget;

    public void SetGuardTarget(Vessel target)
    {
        guardTarget = target;
    }
}

public struct RadarDisplayData
{
    public Vessel vessel;
}

public sealed class VesselRadarData
{
    public bool locked;
    public RadarDisplayData lockedTargetData;
}

public sealed class HitpointTracker
{
    public double Hitpoints;
    public double maxHitpoints;
}
