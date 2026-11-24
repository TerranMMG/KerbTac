using System.Collections.Generic;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests;

public class SummaryTests
{
    private static VesselInfo Vessel(string id, string side, params VesselSample[] samples)
    {
        var v = new VesselInfo { Id = id, Name = id, Side = side };
        var segment = new TrackSegment { Body = "Kerbin" };
        segment.Samples.AddRange(samples);
        v.Segments.Add(segment);
        return v;
    }

    private static SessionInfo Session()
    {
        return new SessionInfo { StartUt = 0, EndUt = 100 };
    }

    [Fact]
    public void SummaryCountsShotsHitsKillsAndDistance()
    {
        var vessels = new List<VesselInfo>
        {
            Vessel("blue-1", "blue"),
            Vessel("red-1", "red")
        };
        var events = new List<KerbTacEvent>
        {
            new KerbTacEvent { Type = EventTypes.WeaponRelease, VesselId = "blue-1", SourceId = "blue-1" },
            new KerbTacEvent { Type = EventTypes.Hit, VesselId = "red-1", SourceId = "blue-1" },
            new KerbTacEvent { Type = EventTypes.Kill, VesselId = "red-1", SourceId = "blue-1" }
        };

        var s = SummaryBuilder.Build(Session(), vessels, events, new List<ActorInfo>());

        Assert.Equal(1, s.Sides["blue"].Shots);
        Assert.Equal(1, s.Sides["blue"].Hits);
        Assert.Equal(1, s.Sides["blue"].Kills);
        Assert.Equal(0, s.Sides["red"].Shots);
        Assert.Equal(1, s.Vessels[0].Shots);
        Assert.Equal(1, s.Vessels[0].Hits);
        Assert.Equal(1, s.Vessels[0].Kills);
        Assert.Equal(0, s.Vessels[1].Shots);
    }

    [Fact]
    public void UnknownHitAndKillSourceDoesNotCreditTheVictimOrItsSide()
    {
        var events = new List<KerbTacEvent>
        {
            new KerbTacEvent { Type = EventTypes.Hit, VesselId = "target" },
            new KerbTacEvent { Type = EventTypes.Kill, VesselId = "target", SourceId = "" },
            new KerbTacEvent { Type = EventTypes.Hit, VesselId = "target", SourceId = "not-in-archive" },
            new KerbTacEvent { Type = EventTypes.Kill, VesselId = "target", SourceId = "attacker" },
            new KerbTacEvent { Type = EventTypes.WeaponRelease, VesselId = "target" }
        };
        var summary = SummaryBuilder.Build(Session(),
            new[] { Vessel("target", "red"), Vessel("attacker", "blue") }, events, null);

        var victim = summary.Vessels[0];
        Assert.Equal(1, victim.Shots);
        Assert.Equal(0, victim.Hits);
        Assert.Equal(0, victim.Kills);
        Assert.Equal(0, summary.Sides["red"].Hits);
        Assert.Equal(0, summary.Sides["red"].Kills);
        Assert.Equal(0, summary.Sides["blue"].Hits);
        Assert.Equal(1, summary.Sides["blue"].Kills);
        Assert.False(summary.Sides.ContainsKey("neutral"));
    }

    [Fact]
    public void NeutralSummaryCountsOnlyAttributedCombatAndLeavesUnknownEventsInTheTimeline()
    {
        var events = new List<KerbTacEvent>
        {
            new KerbTacEvent { Type = EventTypes.Hit, VesselId = "neutral-target" },
            new KerbTacEvent { Type = EventTypes.Kill, VesselId = "neutral-target", SourceId = "not-in-archive" },
            new KerbTacEvent { Type = EventTypes.Hit, VesselId = "neutral-target", SourceId = "neutral-source" },
            new KerbTacEvent { Type = EventTypes.Kill, VesselId = "neutral-target", SourceId = "neutral-source" },
            new KerbTacEvent { Type = EventTypes.Hit, VesselId = "neutral-target", SourceId = "no-side" },
            new KerbTacEvent { Type = EventTypes.WeaponRelease, VesselId = "neutral-source" }
        };
        var vessels = new[]
        {
            Vessel("neutral-target", "neutral"), Vessel("neutral-source", "neutral"), Vessel("no-side", "")
        };
        string timeline = SessionSerializer.WriteEvents(events);

        var summary = SummaryBuilder.Build(Session(), vessels, events, null);

        Assert.Equal(0, summary.Vessels[0].Hits);
        Assert.Equal(0, summary.Vessels[0].Kills);
        Assert.Equal(1, summary.Vessels[1].Hits);
        Assert.Equal(1, summary.Vessels[1].Kills);
        Assert.Equal(1, summary.Vessels[2].Hits);
        Assert.Equal(1, summary.Sides["neutral"].Hits);
        Assert.Equal(1, summary.Sides["neutral"].Kills);
        Assert.Equal(1, summary.Sides["neutral"].Shots);
        Assert.Equal(timeline, SessionSerializer.WriteEvents(events));
    }

    [Fact]
    public void SummarySumsGreatCircleDistancePerVessel()
    {
        var vessel = Vessel("blue-1", "blue",
            new VesselSample { T = 1, Latitude = 0, Longitude = 0, Altitude = 1000 },
            new VesselSample { T = 2, Latitude = 0, Longitude = 1, Altitude = 1000 });
        var bodies = new Dictionary<string, BodyDef>
        {
            { "Kerbin", new BodyDef { Name = "Kerbin", Radius = 600000 } }
        };

        var s = SummaryBuilder.Build(Session(), new List<VesselInfo> { vessel },
            new List<KerbTacEvent>(), new List<ActorInfo>(), bodies);

        Assert.InRange(s.Session.DistanceKm, 10.46, 10.48);
        Assert.InRange(s.Vessels[0].DistanceKm, 10.46, 10.48);
    }

    [Fact]
    public void SummaryTakesMaxTelemetryAcrossAllSamples()
    {
        var vessel = Vessel("blue-1", "blue",
            new VesselSample { T = 1, Altitude = 1000, SurfaceSpeed = 100, Mach = 0.3, GeeForce = 1 },
            new VesselSample { T = 2, Altitude = 3000, SurfaceSpeed = 250, Mach = 0.9, GeeForce = 6 });

        var s = SummaryBuilder.Build(Session(), new List<VesselInfo> { vessel },
            new List<KerbTacEvent>(), new List<ActorInfo>());

        Assert.Equal(3000, s.Session.MaxAltitude);
        Assert.Equal(250, s.Session.MaxSpeed);
        Assert.Equal(0.9, s.Session.MaxMach);
        Assert.Equal(6, s.Session.MaxG);
        Assert.Equal(100, s.Session.Duration);
    }

    [Fact]
    public void SummaryFuelUsedIsFirstMinusLast()
    {
        var vessel = Vessel("blue-1", "blue",
            new VesselSample { T = 1, LiquidFuel = 100, Oxidizer = 50 },
            new VesselSample { T = 2, LiquidFuel = 40, Oxidizer = 20 });

        var s = SummaryBuilder.Build(Session(), new List<VesselInfo> { vessel },
            new List<KerbTacEvent>(), new List<ActorInfo>());

        Assert.Equal(90, s.Vessels[0].FuelUsed, 6);
    }

    [Fact]
    public void SummaryDoesNotTreatAnUnmeasuredResourceAsEmpty()
    {
        var stats = new VesselSummaryStats();
        stats.Observe(new VesselSample { T = 1, LiquidFuel = 10, Oxidizer = 8 }, "Kerbin", 600000);
        stats.Observe(new VesselSample { T = 2, LiquidFuel = 0 }, "Kerbin", 600000);
        Assert.Equal(10, stats.FuelUsed);
    }

    [Fact]
    public void ObservePositionAddsDistanceWithoutInventingFuelOrSpeed()
    {
        var stats = new VesselSummaryStats();
        stats.Observe(new VesselSample
        {
            T = 1,
            Latitude = 0,
            Longitude = 0,
            Altitude = 1000,
            SurfaceSpeed = 100,
            LiquidFuel = 100,
            Oxidizer = 50
        }, "Kerbin", 600000);

        stats.ObservePosition(VesselSample.PositionOnly(
            2, 0, 1, 2000, Quatd.Identity, "ORBITING"), "Kerbin", 600000);

        Assert.InRange(stats.DistanceKm, 10.46, 10.48);
        Assert.Equal(2000, stats.MaxAltitude);
        Assert.Equal(100, stats.MaxSpeed);
        Assert.Equal(0, stats.FuelUsed, 6);
    }

    [Fact]
    public void VesselWithoutSamplesStillAppearsWithZeros()
    {
        var s = SummaryBuilder.Build(Session(), new List<VesselInfo> { Vessel("red-1", "red") },
            new List<KerbTacEvent>(), new List<ActorInfo>());

        Assert.Single(s.Vessels);
        Assert.Equal(0, s.Vessels[0].DistanceKm);
        Assert.Equal(0, s.Vessels[0].FuelUsed);
    }
}
