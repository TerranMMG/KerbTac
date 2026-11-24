using System;
using KerbTac;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class FlightAnglesTests
    {
        [Fact]
        public void LevelFlightHasNoAoaOrSideslip()
        {
            FlightAngles angles = FlightAngles.Compute(0, 0, 100);
            Assert.Equal(0, angles.Aoa, 6);
            Assert.Equal(0, angles.Aos, 6);
        }

        [Fact]
        public void ClimbingVelocityProducesPositiveAoa()
        {
            FlightAngles angles = FlightAngles.Compute(0, 10, 100);
            Assert.True(angles.Aoa > 0);
            Assert.Equal(Math.Atan2(10, 100) * 180.0 / Math.PI, angles.Aoa, 6);
        }

        [Fact]
        public void RightwardVelocityProducesPositiveSideslip()
        {
            FlightAngles angles = FlightAngles.Compute(10, 0, 100);
            Assert.Equal(Math.Atan2(10, 100) * 180.0 / Math.PI, angles.Aos, 6);
        }

        [Fact]
        public void ZeroForwardVelocityIsFinite()
        {
            FlightAngles angles = FlightAngles.Compute(1, 0, 0);
            Assert.True(double.IsFinite(angles.Aoa));
            Assert.True(double.IsFinite(angles.Aos));
        }
    }
}
