using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class CountermeasureTrackerTests
    {
        private static CountermeasureInput Input(
            double ut,
            int count,
            string type = "chaff",
            string part = "cm-1",
            int module = 0)
        {
            return new CountermeasureInput
            {
                VesselId = "v1",
                PartId = part,
                ModuleIndex = module,
                Ut = ut,
                Count = count,
                CountermeasureType = type,
                EjectVelocity = 10,
                PositionBf = new Vec3d(1, 2, 3),
                DirectionBf = new Vec3d(0, 1, 0),
                VesselVelocityBf = new Vec3d(100, 0, 0)
            };
        }

        [Fact]
        public void FirstObservationIsBaseline()
        {
            var tracker = new CountermeasureTracker();
            Assert.Empty(tracker.Poll(new[] { Input(0, 30) }));
        }

        [Fact]
        public void CountDecreaseReportsRelease()
        {
            var tracker = new CountermeasureTracker();
            tracker.Poll(new[] { Input(0, 30) });
            var releases = tracker.Poll(new[] { Input(0.02, 28) });

            Assert.Single(releases);
            Assert.Equal(2, releases[0].Count);
            Assert.Equal(BdaCountermeasureKind.Chaff, releases[0].Kind);
            Assert.Equal(new Vec3d(100, 10, 0), releases[0].VelocityBf);
        }

        [Fact]
        public void ReloadDoesNotReportRelease()
        {
            var tracker = new CountermeasureTracker();
            tracker.Poll(new[] { Input(0, 10) });
            Assert.Empty(tracker.Poll(new[] { Input(0.02, 30) }));
            Assert.Empty(tracker.Poll(new[] { Input(0.04, 30) }));
            Assert.Single(tracker.Poll(new[] { Input(0.06, 28) }));
        }

        [Fact]
        public void HugeJumpIsClampedToOne()
        {
            var tracker = new CountermeasureTracker();
            tracker.Poll(new[] { Input(0, 500) });
            var releases = tracker.Poll(new[] { Input(0.02, 1) });
            Assert.Single(releases);
            Assert.Equal(1, releases[0].Count);
        }

        [Theory]
        [InlineData("flare", BdaCountermeasureKind.Flare)]
        [InlineData("CMFlare", BdaCountermeasureKind.Flare)]
        [InlineData("smoke", BdaCountermeasureKind.Smoke)]
        [InlineData("decoy", BdaCountermeasureKind.Decoy)]
        [InlineData("bubble", BdaCountermeasureKind.Bubble)]
        [InlineData("unknown", BdaCountermeasureKind.Unknown)]
        public void KindIsClassified(string type, BdaCountermeasureKind expected)
        {
            var tracker = new CountermeasureTracker();
            tracker.Poll(new[] { Input(0, 10, type) });
            var releases = tracker.Poll(new[] { Input(0.02, 9, type) });
            Assert.Single(releases);
            Assert.Equal(expected, releases[0].Kind);
        }

        [Fact]
        public void ModulesAreIndependent()
        {
            var tracker = new CountermeasureTracker();
            tracker.Poll(new[] { Input(0, 10, part: "a", module: 0) });
            tracker.Poll(new[] { Input(0, 10, part: "b", module: 1) });

            var releases = tracker.Poll(new[]
            {
                Input(0.02, 9, "chaff", "a", 0),
                Input(0.02, 9, "flare", "b", 1)
            });

            Assert.Equal(2, releases.Count);
            Assert.Equal(BdaCountermeasureKind.Chaff, releases[0].Kind);
            Assert.Equal(BdaCountermeasureKind.Flare, releases[1].Kind);
        }
    }
}
