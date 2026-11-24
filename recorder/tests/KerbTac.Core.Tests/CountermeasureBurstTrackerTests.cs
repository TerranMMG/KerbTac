using System.Collections.Generic;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class CountermeasureBurstTrackerTests
    {
        private static CountermeasureReleaseSignal Release(double ut, int count = 1, BdaCountermeasureKind kind = BdaCountermeasureKind.Chaff)
        {
            return new CountermeasureReleaseSignal
            {
                VesselId = "v1",
                PartId = "p1",
                ModuleIndex = 0,
                Ut = ut,
                EndUt = ut,
                Count = count,
                Kind = kind,
                CountermeasureType = kind == BdaCountermeasureKind.Flare ? "flare" : "chaff",
                EjectVelocity = 30,
                PositionBf = new Vec3d(0, 600000, 0),
                DirectionBf = new Vec3d(0, 1, 0),
                VelocityBf = new Vec3d(0, 30, 0)
            };
        }

        [Fact]
        public void MergesReleasesInsideOneSalvo()
        {
            var tracker = new CountermeasureBurstTracker();
            Assert.Empty(tracker.Poll(new[] { Release(10), Release(10.5) }, 10.5));
            var bursts = tracker.Poll(new List<CountermeasureReleaseSignal>(), 12.6);
            Assert.Single(bursts);
            Assert.Equal(2, bursts[0].Count);
            Assert.Equal(10, bursts[0].Ut, 3);
            Assert.Equal(10.5, bursts[0].EndUt, 3);
        }

        [Fact]
        public void SeparateSalvosStaySeparate()
        {
            var tracker = new CountermeasureBurstTracker();
            tracker.Poll(new[] { Release(10) }, 10);
            Assert.Single(tracker.Poll(new[] { Release(13) }, 13));
            var bursts = tracker.Poll(new List<CountermeasureReleaseSignal>(), 15.1);
            Assert.Single(bursts);
        }

        [Fact]
        public void DifferentCountermeasureKindsStaySeparate()
        {
            var tracker = new CountermeasureBurstTracker();
            tracker.Poll(new[] { Release(10) }, 10);
            tracker.Poll(new[] { Release(10.1, 1, BdaCountermeasureKind.Flare) }, 10.1);
            var bursts = tracker.Poll(new List<CountermeasureReleaseSignal>(), 12.2);
            Assert.Equal(2, bursts.Count);
        }

        [Fact]
        public void DifferentDroppersOfOneVesselMergeIntoOneSalvo()
        {
            var tracker = new CountermeasureBurstTracker();
            var first = Release(10);
            var second = Release(10.2);
            second.PartId = "p2";
            tracker.Poll(new[] { first, second }, 10.2);
            var bursts = tracker.Poll(new List<CountermeasureReleaseSignal>(), 12.3);
            Assert.Single(bursts);
            Assert.Equal(2, bursts[0].Count);
        }

        [Fact]
        public void FlushAllEmitsPendingBurst()
        {
            var tracker = new CountermeasureBurstTracker();
            tracker.Poll(new[] { Release(10) }, 10);
            var bursts = tracker.FlushAll();
            Assert.Single(bursts);
            Assert.Equal(1, bursts[0].Count);
        }
    }
}
