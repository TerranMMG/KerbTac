using KerbTac.Core;

namespace KerbTac.Core.Tests;

public sealed class SegmentBoundaryTests
{
    [Fact]
    public void TrimToUt_DropsOnlySamplesAfterBoundary()
    {
        var samples = new List<VesselSample>
        {
            new VesselSample { T = 90.0 },
            new VesselSample { T = 90.1 },
            new VesselSample { T = 95.0 },
        };

        Assert.Equal(2, SegmentBoundary.TrimToUt(samples, 90.1));
        Assert.Equal(new[] { 90.0, 90.1 }, samples.Select(sample => sample.T));
    }

    [Fact]
    public void NextStartUt_DoesNotMoveTheLogicalBoundary()
    {
        Assert.Equal(90.1, SegmentBoundary.NextStartUt(90.1));
    }

    [Fact]
    public void Transition_KeepsAnExistingBoundarySampleAndStartsCatchUpAfterIt()
    {
        var buffer = new SampleRingBuffer(10);
        buffer.Add(new VesselSample { T = 99.9 });
        buffer.Add(new VesselSample { T = 100 });
        buffer.Add(new VesselSample { T = 101 });

        var closing = SegmentBoundary.ClosePrevious(buffer, 100);
        var start = SegmentBoundary.NextStartUt(100);

        Assert.Equal(0, buffer.Count);
        Assert.Equal(new[] { 99.9, 100 }, closing.Select(sample => sample.T));
        Assert.False(SegmentBoundary.CanCaptureAt(start, start, closing[^1].T < start));
        Assert.Equal(new[] { 100.5, 101 }, PositionKeyframeSchedule.Times(start, 101.5, 0.5, 100));
    }

    [Fact]
    public void Transition_CanFillAnUnclaimedBoundaryOnlyOnce()
    {
        Assert.False(SegmentBoundary.CanCaptureAt(99.9, 100, true));
        Assert.True(SegmentBoundary.CanCaptureAt(100, 100, true));
        Assert.False(SegmentBoundary.CanCaptureAt(100, 100, false));
        Assert.True(SegmentBoundary.CanCaptureAt(100.1, 100, false));
    }
}
