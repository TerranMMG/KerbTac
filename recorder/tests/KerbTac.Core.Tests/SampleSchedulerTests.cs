using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class SampleSchedulerTests
    {
        [Theory]
        [InlineData(true, false, 0, 0.1)]
        [InlineData(false, true, 0, 0.1)]
        [InlineData(false, false, 0, 0.1)]
        [InlineData(false, false, 2500, 0.1)]
        [InlineData(false, false, 2501, 0.25)]
        [InlineData(false, false, 10000, 0.25)]
        [InlineData(false, false, 10001, 0.5)]
        [InlineData(false, false, 50000, 0.5)]
        [InlineData(false, false, 50001, 1.0)]
        [InlineData(false, false, 100000, 1.0)]
        public void LoadedVesselsStepDownByDistance(bool active, bool important, double distance, double expected)
        {
            Assert.Equal(expected, new SampleScheduler().IntervalFor(active, important, distance));
        }

        [Fact]
        public void ShouldSampleRespectsIntervalAndJitter()
        {
            var s = new SampleScheduler();
            Assert.False(s.ShouldSample(10.05, 10.0, 0.1));
            Assert.True(s.ShouldSample(10.1, 10.0, 0.1));
            Assert.True(s.ShouldSample(10.099999, 10.0, 0.1));
        }
    }
}
