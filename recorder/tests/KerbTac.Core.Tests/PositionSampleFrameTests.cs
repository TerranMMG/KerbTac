using KerbTac.Core;
using KerbTac.Core.Sampling;

namespace KerbTac.Core.Tests;

public sealed class PositionSampleFrameTests
{
    [Fact]
    public void ActivePositionCadence_DoesNotExpireDuringALongWarpStep()
    {
        Assert.Equal(0.5, TrackPolicy.PositionInterval(active: true, recentlyActive: false));
        Assert.Equal(10.0, TrackPolicy.PositionInterval(active: false, recentlyActive: false));
    }

    [Fact]
    public void WarpExit_PositionLongitudeMatchesTheLiveGeographicFrame()
    {
        // From the MS-R2A Scanner recording, immediately before unpacking.
        const double radius = 600_000;
        var frozen = BodyFixed.FromLatLonAlt(-21.7579587, -69.3827093, 303890.08, radius);
        var epochRotation = new Quatd(0, -0.9291887283325195, 0, -0.36960557103157043).Normalized();
        var world = epochRotation.Rotate(frozen);
        var relative = new Vec3d(world.X, world.Z, world.Y);

        var frames = new ObservedBodyRotation();
        const double exitSpinDeg = 32.25191907467797;
        var halfAngle = -exitSpinDeg * Math.PI / 360;
        frames.Observe(2984807.8250558437, epochRotation);
        frames.Observe(3159133.379809422,
            epochRotation * new Quatd(0, Math.Sin(halfAngle), 0, Math.Cos(halfAngle)));
        var liveRotation = frames.At(3159133.379809422);
        BodyFixed.ToLatLonAlt(BodyFixed.FromRelative(relative, liveRotation), radius,
            out var lat, out var lon, out var alt);

        Assert.Equal(-21.7579587, lat, 6);
        Assert.InRange(lon, -101.65, -101.61); // next live sample: -101.6343197°
        Assert.Equal(303890.08, alt, 2);
    }

    [Fact]
    public void ObservedRotation_DoesNotInventSpinWhenKspHoldsTheBodyStill()
    {
        var q = new Quatd(0, -0.93912390356246911, 0, -0.34357865730803239);
        var frames = new ObservedBodyRotation();
        frames.Observe(3172207.4958696282, q);
        frames.Observe(3178795.7750788424, q);
        Assert.Equal(q.Y, frames.At(3178795.5).Y, 8);
    }

    [Fact]
    public void ObservedRotation_InterpolatesHistoricalKeyframesAcrossQuaternionSign()
    {
        var frames = new ObservedBodyRotation();
        double half = Math.Sqrt(0.5);
        frames.Observe(10, Quatd.Identity);
        frames.Observe(20, new Quatd(0, half, 0, -half));
        var relative = new Vec3d(1, 0, 0);
        var halfway = BodyFixed.FromRelative(relative, frames.At(15));
        Assert.Equal(half, halfway.X, 8);
        Assert.Equal(-half, halfway.Z, 8);
    }

    [Fact]
    public void ObservedRotation_SameUtDoesNotRewriteThePublishedPose()
    {
        var frames = new ObservedBodyRotation();
        frames.Observe(1000, Quatd.Identity);
        var halfAngle = -1.6705782 * Math.PI / 360;
        var next = new Quatd(0, Math.Sin(halfAngle), 0, Math.Cos(halfAngle));
        frames.Observe(1000, next);
        frames.Observe(1100, next);
        BodyFixed.ToLatLonAlt(BodyFixed.FromRelative(new Vec3d(1, 0, 0), frames.At(1000.5)),
            1, out _, out var lon, out _);
        Assert.InRange(lon, -0.00836, -0.00834);
    }

    [Fact]
    public void CatchUpRotation_ContinuesFromTheLastWrittenSampleThroughTheFullBatch()
    {
        var frames = new ObservedBodyRotation();
        frames.Observe(1000, Quatd.Identity);
        var half = -1.6705782 * Math.PI / 360;
        var next = new Quatd(0, Math.Sin(half), 0, Math.Cos(half));
        frames.Observe(1100, next);
        frames.Observe(1100.1, next);

        var rotation = frames.ForBatch(1000, Quatd.Identity).At(1000.5);
        BodyFixed.ToLatLonAlt(BodyFixed.FromRelative(new Vec3d(1, 0, 0), rotation),
            1, out _, out var lon, out _);
        Assert.InRange(lon, -0.00836, -0.00833);
    }

    [Fact]
    public void OrbitBatchCorrection_BridgesTheKspLongitudeRebaseWithoutMovingTheLiveEndpoint()
    {
        var saved = new VesselSample { T = 1000, Longitude = -179.5, Latitude = 5, Altitude = 90000 };
        var reevaluated = new VesselSample { T = 1000, Longitude = 178.8294218, Latitude = 5, Altitude = 90000 };
        var correction = OrbitBatchCorrection.Between(saved, reevaluated, 1100, 0.016705782);
        Assert.Equal(1.6705782, correction.At(1000), 6);
        Assert.Equal(1.6622253, correction.At(1000.5), 6);
        Assert.Equal(0, correction.At(1100));
        reevaluated.Altitude += 100;
        Assert.Equal(0, OrbitBatchCorrection.Between(saved, reevaluated, 1100, 0.016705782).At(1000));
    }

    [Fact]
    public void OrbitBatchCorrection_RejectsAnInvalidProbe()
    {
        var saved = new VesselSample { T = 1000, Longitude = 10 };
        foreach (var invalid in new[] { double.NaN, double.PositiveInfinity })
        {
            var reevaluated = new VesselSample { T = 1000, Longitude = invalid };
            Assert.Equal(0, OrbitBatchCorrection.Between(saved, reevaluated, 1100, 0.0167).At(1050));
        }
    }
}
