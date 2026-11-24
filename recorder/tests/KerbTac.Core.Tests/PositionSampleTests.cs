using KerbTac.Core.Sampling;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class PositionSampleTests
    {
        [Fact]
        public void PositionOnly_sets_position_and_leaves_optional_telemetry_unknown()
        {
            var sample = VesselSample.PositionOnly(
                123.5, 12.5, -45.25, 80_000, Quatd.Identity, "Land");

            Assert.Equal(123.5, sample.T);
            Assert.Equal(12.5, sample.Latitude);
            Assert.Equal(-45.25, sample.Longitude);
            Assert.Equal(80_000, sample.Altitude);
            Assert.Equal("Land", sample.Situation);
            Assert.Null(sample.Throttle);
            Assert.Null(sample.Stage);
            Assert.Null(sample.Health);
            Assert.Null(sample.LiquidFuel);
            Assert.Null(sample.Mass);
            Assert.Null(sample.VelocityX);
        }
    }
}
