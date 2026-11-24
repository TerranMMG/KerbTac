using KerbTac.Core.Sampling;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class UnloadedRangeTests
    {
        [Theory]
        [InlineData(-1, 0)]
        [InlineData(0, 0)]
        [InlineData(50, 100)]
        [InlineData(100, 100)]
        [InlineData(300, 500)]
        [InlineData(749, 500)]
        [InlineData(750, 1000)]
        [InlineData(100001, 100000)]
        public void Snap_rounds_to_the_nearest_option(int input, int expected)
        {
            Assert.Equal(expected, UnloadedRange.Snap(input));
        }

        [Fact]
        public void Options_start_at_only_loaded_then_100_then_500()
        {
            Assert.Equal(0, UnloadedRange.OptionsKm[0]);
            Assert.Equal(100, UnloadedRange.OptionsKm[1]);
            Assert.Equal(500, UnloadedRange.OptionsKm[2]);
            Assert.Equal(100000, UnloadedRange.OptionsKm[UnloadedRange.OptionsKm.Count - 1]);
        }

        [Theory]
        [InlineData(0, "Only loaded")]
        [InlineData(500, "500 km")]
        [InlineData(100000, "100,000 km")]
        public void Label_is_operator_friendly(int km, string expected)
        {
            Assert.Equal(expected, UnloadedRange.Label(km));
        }

        [Fact]
        public void ShouldTrack_uses_10_percent_hysteresis()
        {
            const int rangeKm = 500;
            Assert.False(UnloadedRange.ShouldTrack(500_001, rangeKm, wasTracked: false));
            Assert.True(UnloadedRange.ShouldTrack(500_000, rangeKm, wasTracked: false));
            Assert.True(UnloadedRange.ShouldTrack(549_999, rangeKm, wasTracked: true));
            Assert.False(UnloadedRange.ShouldTrack(550_001, rangeKm, wasTracked: true));
        }

        [Fact]
        public void Range_zero_never_tracks_unloaded_vessels()
        {
            Assert.False(UnloadedRange.ShouldTrack(0, 0, wasTracked: false));
            Assert.False(UnloadedRange.ShouldTrack(0, 0, wasTracked: true));
        }
    }
}
