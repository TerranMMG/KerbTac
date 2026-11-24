using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class HealthDropTrackerTests
    {
        private static HealthInput Input(string vessel, double ut, float health)
        {
            return new HealthInput { VesselId = vessel, Ut = ut, Health = health };
        }

        [Fact]
        public void FirstObservationIsBaseline()
        {
            var tracker = new HealthDropTracker();
            Assert.Empty(tracker.Poll(new[] { Input("v1", 0, 1f) }, 0));
        }

        [Fact]
        public void SignificantDropEmitsHit()
        {
            var tracker = new HealthDropTracker();
            tracker.Poll(new[] { Input("v1", 0, 1f) }, 0);

            var drops = tracker.Poll(new[] { Input("v1", 0.6, 0.7f) }, 0.6);
            Assert.Single(drops);
            Assert.Equal("v1", drops[0].VesselId);
            Assert.Equal(1f, drops[0].Before, 5);
            Assert.Equal(0.7f, drops[0].After, 5);
            Assert.Equal(0.3f, drops[0].Damage, 5);
        }

        [Fact]
        public void TinyDropsAccumulate()
        {
            var tracker = new HealthDropTracker();
            tracker.Poll(new[] { Input("v1", 0, 1f) }, 0);
            Assert.Empty(tracker.Poll(new[] { Input("v1", 0.1, 0.999f) }, 0.1));
            Assert.Empty(tracker.Poll(new[] { Input("v1", 0.2, 0.9985f) }, 0.2));

            var drops = tracker.Poll(new[] { Input("v1", 0.3, 0.9975f) }, 0.3);
            Assert.Single(drops);
            Assert.Equal(0.0025f, drops[0].Damage, 5);
        }

        [Fact]
        public void ReportsAreThrottled()
        {
            var tracker = new HealthDropTracker();
            tracker.Poll(new[] { Input("v1", 0, 1f) }, 0);
            Assert.Single(tracker.Poll(new[] { Input("v1", 0.6, 0.9f) }, 0.6));
            Assert.Empty(tracker.Poll(new[] { Input("v1", 0.8, 0.8f) }, 0.8));

            var drops = tracker.Poll(new[] { Input("v1", 1.2, 0.7f) }, 1.2);
            Assert.Single(drops);
            Assert.Equal(0.9f, drops[0].Before, 5);
        }

        [Fact]
        public void RepairResetsBaseline()
        {
            var tracker = new HealthDropTracker();
            tracker.Poll(new[] { Input("v1", 0, 0.5f) }, 0);
            Assert.Empty(tracker.Poll(new[] { Input("v1", 0.1, 1f) }, 0.1));
            Assert.Empty(tracker.Poll(new[] { Input("v1", 0.2, 0.999f) }, 0.2));

            var drops = tracker.Poll(new[] { Input("v1", 1.0, 0.9f) }, 1.0);
            Assert.Single(drops);
            Assert.Equal(1f, drops[0].Before, 5);
        }

        [Fact]
        public void InvalidHealthIsIgnored()
        {
            var tracker = new HealthDropTracker();
            tracker.Poll(new[] { Input("v1", 0, 1f) }, 0);
            Assert.Empty(tracker.Poll(new[] { Input("v1", 0.6, float.NaN) }, 0.6));
        }
    }
}
