using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class RecordingClockTests
    {
        [Fact]
        public void ElapsedTracksTicksIndependentlyOfSamples()
        {
            RecordingClock clock = new RecordingClock();
            clock.Start(100.0);

            Assert.Equal(0.0, clock.ElapsedSeconds, 6);

            clock.Tick(104.5);
            Assert.Equal(4.5, clock.ElapsedSeconds, 6);
        }

        [Fact]
        public void ElapsedIsMonotonicAndIgnoresInvalidTicks()
        {
            RecordingClock clock = new RecordingClock();
            clock.Start(100.0);
            clock.Tick(110.0);

            clock.Tick(109.0);
            clock.Tick(double.NaN);
            clock.Tick(double.PositiveInfinity);

            Assert.Equal(10.0, clock.ElapsedSeconds, 6);

            clock.Start(200.0);
            Assert.Equal(0.0, clock.ElapsedSeconds, 6);
        }
    }
}
