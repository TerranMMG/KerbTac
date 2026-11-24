using KerbTac.Core.Sampling;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class VesselTrackFilterTests
    {
        [Theory]
        [InlineData("Debris")]
        [InlineData("Flag")]
        [InlineData("SpaceObject")]
        [InlineData("Asteroid")]
        [InlineData("EVA")]
        public void IgnoresNonTrackableVesselTypes(string type)
        {
            Assert.True(VesselTrackFilter.IsIgnoredType(type));
        }

        [Theory]
        [InlineData("Relay")]
        [InlineData("Probe")]
        [InlineData("Station")]
        [InlineData("Ship")]
        [InlineData("Lander")]
        public void TracksOrdinaryVessels(string type)
        {
            Assert.False(VesselTrackFilter.IsIgnoredType(type));
        }

        [Theory]
        [InlineData("Debris")]
        [InlineData("Flag")]
        [InlineData("SpaceObject")]
        [InlineData("Asteroid")]
        [InlineData("EVA")]
        public void RejectsExcludedTypesAsActiveVessel(string type)
        {
            Assert.False(VesselTrackFilter.IsActiveAllowed(type));
        }

        [Theory]
        [InlineData("Relay")]
        [InlineData("Probe")]
        [InlineData("Station")]
        [InlineData("Ship")]
        [InlineData("Lander")]
        public void AllowsOrdinaryActiveVessels(string type)
        {
            Assert.True(VesselTrackFilter.IsActiveAllowed(type));
        }
    }
}
