using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class PositionKeyframeScheduleTests
    {
        [Fact]
        public void TimesReturnsTenSecondKeyframesStrictlyBeforeNow()
        {
            double[] times = PositionKeyframeSchedule.Times(100.0, 145.0, 10.0, 100);

            Assert.Equal(new[] { 110.0, 120.0, 130.0, 140.0 }, times);
        }

        [Fact]
        public void TimesDoesNotDuplicateTheCurrentSample()
        {
            double[] times = PositionKeyframeSchedule.Times(100.0, 110.0, 10.0, 100);

            Assert.Empty(times);
        }

        [Fact]
        public void TimesCapsTheNumberOfCatchUpSamples()
        {
            double[] times = PositionKeyframeSchedule.Times(0.0, 1000.0, 10.0, 3);

            Assert.Equal(new[] { 10.0, 20.0, 30.0 }, times);
        }

        [Fact]
        public void TimesRejectsInvalidRangesAndIntervals()
        {
            Assert.Empty(PositionKeyframeSchedule.Times(double.NaN, 100.0, 10.0, 100));
            Assert.Empty(PositionKeyframeSchedule.Times(100.0, double.PositiveInfinity, 10.0, 100));
            Assert.Empty(PositionKeyframeSchedule.Times(100.0, 100.0, 10.0, 100));
            Assert.Empty(PositionKeyframeSchedule.Times(100.0, 200.0, 0.0, 100));
        }
    }
}
