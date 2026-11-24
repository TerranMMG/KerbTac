using System.Reflection;
using System.Text.Json;
using KerbTac.Core;
using KerbTac.Recorder;

public class OrbitCaptureTests
{
    [Fact]
    public void ArchiveAnglesMatchTheKspOrbitUnits()
    {
        var vessel = new Vessel { orbit = new Orbit { referenceBody = new CelestialBody(),
            semiMajorAxis = 700000, inclination = 35, LAN = 120,
            argumentOfPeriapsis = 88, meanAnomalyAtEpoch = Math.PI / 2 } };
        var capture = typeof(RecordingSession).GetMethod("CaptureOrbit",
            BindingFlags.NonPublic | BindingFlags.Static);
        var value = (OrbitDef)capture.Invoke(null, new object[] { vessel, 1234.5 });
        Assert.Equal(35, value.InclinationDeg);
        Assert.Equal(120, value.LanDeg);
        Assert.Equal(88, value.ArgPeDeg);
        Assert.Equal(90, value.MeanAnomalyDeg, 10);
    }

    [Fact]
    public void WritesAbsolutePhaseAtTheCaptureUtNotAtTheOrbitEpochOrSceneYaw()
    {
        var body = new CelestialBody { rotates = true, rotationPeriod = 1440, initialRotation = 322.875, rotationAngle = 271.5 };
        using var json = CaptureJson(body, body, 1234.5);
        var orbit = json.RootElement.GetProperty("orbit");
        Assert.Equal(1000, orbit.GetProperty("epoch").GetDouble());
        var frame = orbit.GetProperty("bfRotation");
        Assert.Equal("ksp-zup-spin-v1", frame.GetProperty("kind").GetString());
        Assert.Equal(1234.5, frame.GetProperty("epochUt").GetDouble());
        Assert.Equal(271.5, frame.GetProperty("angleDeg").GetDouble());
        Assert.Equal(0.25, frame.GetProperty("rateDegPerSec").GetDouble());
    }

    [Fact]
    public void EvaluatesTheKspPhaseAtTheCurrentUtIfTheCachedFieldIsFromAnotherTick()
    {
        var body = new CelestialBody { rotates = true, rotationPeriod = -1440, initialRotation = 20, rotationAngle = 18 };
        using var json = CaptureJson(body, body, 48);
        var frame = json.RootElement.GetProperty("orbit").GetProperty("bfRotation");
        Assert.Equal(48, frame.GetProperty("epochUt").GetDouble());
        Assert.Equal(8, frame.GetProperty("angleDeg").GetDouble());
        Assert.Equal(-0.25, frame.GetProperty("rateDegPerSec").GetDouble());
    }

    [Theory]
    [InlineData(false, 1440, 271.5, 1234.5, true)]
    [InlineData(true, 0, 271.5, 1234.5, true)]
    [InlineData(true, double.PositiveInfinity, 271.5, 1234.5, true)]
    [InlineData(true, 1440, double.NaN, 1234.5, true)]
    [InlineData(true, 1440, 271.5, double.NaN, true)]
    [InlineData(true, 1440, 271.5, 1234.5, false)]
    public void DoesNotMarkAnUnusableOrDifferentBodyPhase(bool rotates, double period, double angle, double ut, bool sameBody)
    {
        var body = new CelestialBody { rotates = rotates, rotationPeriod = period, initialRotation = angle };
        using var json = CaptureJson(body, sameBody ? body : new CelestialBody(), ut);
        Assert.False(json.RootElement.GetProperty("orbit").TryGetProperty("bfRotation", out _));
    }

    [Fact]
    public void KeepsTheSpanAcrossPhaseWrapButNotWhenTheSpinChanges()
    {
        var body = new CelestialBody { rotates = true, rotationPeriod = 1440, initialRotation = 359 };
        var vessel = new Vessel
        {
            mainBody = body,
            orbit = new Orbit { referenceBody = body, semiMajorAxis = 700000 },
        };
        var capture = typeof(RecordingSession).GetMethod("CaptureOrbit", BindingFlags.NonPublic | BindingFlags.Static);
        var same = typeof(RecordingSession).GetMethod("SameOrbitShape", BindingFlags.NonPublic | BindingFlags.Static);
        object first = capture.Invoke(null, new object[] { vessel, 0.0 });
        object wrapped = capture.Invoke(null, new object[] { vessel, 8.0 });
        Assert.True((bool)same.Invoke(null, new[] { first, wrapped }));
        body.rotationPeriod = -1440;
        object changed = capture.Invoke(null, new object[] { vessel, 16.0 });
        Assert.False((bool)same.Invoke(null, new[] { first, changed }));
    }

    private static JsonDocument CaptureJson(CelestialBody body, CelestialBody mainBody, double ut)
    {
        var vessel = new Vessel
        {
            mainBody = mainBody,
            orbit = new Orbit { referenceBody = body, epoch = 1000, semiMajorAxis = 700000 },
        };
        var method = typeof(RecordingSession).GetMethod("CaptureOrbit", BindingFlags.NonPublic | BindingFlags.Static);
        var orbit = (OrbitDef)method.Invoke(null, new object[] { vessel, ut });
        return JsonDocument.Parse(SessionSerializer.WriteSegment(new TrackSegment
        {
            Kind = SegmentKinds.Orbit, Body = "Kerbin", Orbit = orbit,
            StartUtOverride = 1000, EndUtOverride = 1500,
        }));
    }
}
