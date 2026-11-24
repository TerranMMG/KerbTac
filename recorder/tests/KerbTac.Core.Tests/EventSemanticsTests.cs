using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class EventSemanticsTests
    {
        [Theory]
        [InlineData(true, true, 95.5, "crash")]
        [InlineData(true, false, 95.5, "destroyed")]
        [InlineData(false, true, 95.5, "impact")]
        public void CrashClassifierSeparatesImpactFromLoss(bool destroyed, bool active, double speed, string expected)
        {
            Assert.Equal(expected, CrashClassifier.Classify(destroyed, active, speed));
        }

        [Fact]
        public void GapDetectorFlagsLongJumpsOnly()
        {
            var g = new GapDetector();
            Assert.False(g.ShouldAddGap(10.0, 10.5));
            Assert.True(g.ShouldAddGap(10.0, 11.5));
        }
    }
}
