using KerbTac.Core.Sampling;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class TrackPolicyTests
    {
        private static TrackDecision Decide(
            bool active = false,
            bool loaded = false,
            bool packed = false,
            double warpRate = 1,
            double distanceMeters = 1_000_000,
            int rangeKm = 0,
            bool wasTracked = false,
            bool staticSituation = false,
            TrackSampleMode previousMode = TrackSampleMode.None,
            bool physicsWarp = false)
            => TrackPolicy.Decide(active, loaded, packed, warpRate, distanceMeters, rangeKm,
                wasTracked, staticSituation, previousMode, physicsWarp);

        [Fact]
        public void Active_vessel_uses_full_samples_until_warp()
        {
            Assert.Equal(TrackSampleMode.Full, Decide(active: true).Mode);
            Assert.Equal("active", Decide(active: true).Source);

            var warp = Decide(active: true, packed: true, previousMode: TrackSampleMode.Full);
            Assert.Equal(TrackSampleMode.Position, warp.Mode);
            Assert.True(warp.StartNewSegment);

            var atmosphere = Decide(active: true, packed: true, previousMode: TrackSampleMode.Full,
                physicsWarp: true);
            Assert.Equal(TrackSampleMode.Full, atmosphere.Mode);
            Assert.False(atmosphere.StartNewSegment);
        }

        [Fact]
        public void Loaded_vessel_is_always_recorded()
        {
            Assert.Equal(TrackSampleMode.Full, Decide(loaded: true, distanceMeters: 1e12).Mode);
            Assert.Equal("loaded", Decide(loaded: true).Source);
        }

        [Fact]
        public void Loaded_static_vessel_still_uses_full_samples()
        {
            var decision = Decide(loaded: true, staticSituation: true, previousMode: TrackSampleMode.Full);
            Assert.Equal(TrackSampleMode.Full, decision.Mode);
            Assert.False(decision.StartNewSegment);
        }

        [Fact]
        public void Unloaded_static_vessel_uses_one_static_sample()
        {
            var decision = Decide(loaded: false, staticSituation: true, distanceMeters: 1000, rangeKm: 500);
            Assert.Equal(TrackSampleMode.Static, decision.Mode);
            Assert.True(decision.StartNewSegment);
        }

        [Fact]
        public void Unloaded_vessel_outside_range_is_ignored()
        {
            Assert.Equal(TrackSampleMode.None, Decide(distanceMeters: 600_000, rangeKm: 500).Mode);
            Assert.Equal(TrackSampleMode.Position,
                Decide(distanceMeters: 400_000, rangeKm: 500).Mode);
        }

        [Fact]
        public void Hysteresis_keeps_an_already_tracked_vessel_until_110_percent()
        {
            Assert.True(Decide(distanceMeters: 540_000, rangeKm: 500, wasTracked: true).Mode
                != TrackSampleMode.None);
            Assert.Equal(TrackSampleMode.None,
                Decide(distanceMeters: 560_000, rangeKm: 500, wasTracked: true).Mode);
        }

        [Fact]
        public void Recently_active_unloaded_vessel_keeps_a_short_position_interval()
        {
            Assert.Equal(TrackPolicy.RecentActivePositionIntervalSeconds,
                TrackPolicy.PositionInterval(true));
            Assert.Equal(TrackPolicy.PositionIntervalSeconds,
                TrackPolicy.PositionInterval(false));
        }
    }
}
