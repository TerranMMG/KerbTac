using System;
using KerbTac;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class FlightAnglesTests
    {
        [Fact]
        public void UsesTheVesselFrameForNoseUpAndRightwardVelocity()
        {
            Quatd attitude = Quatd.FromForwardUp(new Vec3d(1, 0, 0), new Vec3d(0, 0, -1));
            Vec3d planetaryVelocity = attitude.Rotate(new Vec3d(5, -10, 100));

            FlightAngles angles = FlightAngles.Compute(planetaryVelocity, attitude);

            Assert.Equal(Math.Atan2(10, 100) * 180.0 / Math.PI, angles.Aoa, 6);
            Assert.Equal(Math.Atan2(5, 100) * 180.0 / Math.PI, angles.Aos, 6);
        }

        [Fact]
        public void LevelFlightHasNoAoaOrSideslip()
        {
            FlightAngles angles = FlightAngles.Compute(new Vec3d(0, 0, 100), Quatd.Identity);
            Assert.Equal(0, angles.Aoa, 6);
            Assert.Equal(0, angles.Aos, 6);
        }

        [Fact]
        public void VelocityBelowTheNoseProducesPositiveAoa()
        {
            FlightAngles angles = FlightAngles.Compute(new Vec3d(0, -10, 100), Quatd.Identity);
            Assert.True(angles.Aoa > 0);
            Assert.Equal(Math.Atan2(10, 100) * 180.0 / Math.PI, angles.Aoa, 6);
        }

        [Fact]
        public void RightwardVelocityProducesPositiveSideslip()
        {
            FlightAngles angles = FlightAngles.Compute(new Vec3d(10, 0, 100), Quatd.Identity);
            Assert.Equal(Math.Atan2(10, 100) * 180.0 / Math.PI, angles.Aos, 6);
        }

        [Fact]
        public void ZeroForwardVelocityIsFinite()
        {
            FlightAngles angles = FlightAngles.Compute(new Vec3d(1, 0, 0), Quatd.Identity);
            Assert.True(double.IsFinite(angles.Aoa));
            Assert.True(double.IsFinite(angles.Aos));
        }
    }
}
