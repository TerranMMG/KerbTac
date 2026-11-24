using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class VesselKindClassifierTests
    {
        [Theory]
        [InlineData("Plane", false, false, true, "air/fixedwing")]
        [InlineData("Plane", true, false, true, "air/rotary")]
        [InlineData("Rover", false, true, false, "ground/vehicle")]
        [InlineData("Ship", false, false, false, "sea/ship")]
        [InlineData("Base", false, false, false, "ground/structure")]
        [InlineData("Station", false, false, false, "space/vessel")]
        [InlineData("Probe", false, false, false, "space/vessel")]
        [InlineData("Relay", false, false, false, "space/vessel")]
        [InlineData("Lander", false, false, false, "space/vessel")]
        [InlineData("Debris", false, false, false, "debris")]
        [InlineData("EVA", false, false, false, "eva")]
        public void KnownTypesMapToStableKinds(
            string type,
            bool rotor,
            bool wheel,
            bool liftingSurface,
            string expected)
        {
            Assert.Equal(expected, VesselKindClassifier.Classify(type, rotor, wheel, liftingSurface, false, false));
        }

        [Fact]
        public void UnknownTypeUsesPartFeatures()
        {
            Assert.Equal("air/rotary", VesselKindClassifier.Classify("Unknown", true, false, false, false, false));
            Assert.Equal("ground/vehicle", VesselKindClassifier.Classify("Unknown", false, true, false, false, false));
            Assert.Equal("air/fixedwing", VesselKindClassifier.Classify("Unknown", false, false, true, false, false));
            Assert.Equal("air/fixedwing", VesselKindClassifier.Classify("Unknown", false, false, false, true, false));
            Assert.Equal("unknown", VesselKindClassifier.Classify("Unknown", false, false, false, false, false));
        }

        [Fact]
        public void BdaActorKindsAreStable()
        {
            Assert.Equal("weapon/missile", BdaCombatKinds.ActorKind(BdaActorClass.Missile));
            Assert.Equal("weapon/bomb", BdaCombatKinds.ActorKind(BdaActorClass.Bomb));
            Assert.Equal("weapon/rocket", BdaCombatKinds.ActorKind(BdaActorClass.Rocket));
            Assert.Equal("weapon/shell", BdaCombatKinds.ActorKind(BdaActorClass.Gun));
            Assert.Equal("weapon/beam", BdaCombatKinds.ActorKind(BdaActorClass.DefenseLaser));
            Assert.Equal("weapon/missile", BdaCombatKinds.ActorKind(BdaActorClass.Slw));
        }

        [Theory]
        [InlineData("chaff", BdaCountermeasureKind.Chaff)]
        [InlineData("CMFlare", BdaCountermeasureKind.Flare)]
        [InlineData("smoke", BdaCountermeasureKind.Smoke)]
        [InlineData("decoy", BdaCountermeasureKind.Decoy)]
        [InlineData("bubble", BdaCountermeasureKind.Bubble)]
        public void CountermeasureKindsAreClassified(string type, BdaCountermeasureKind expected)
        {
            Assert.Equal(expected, BdaCombatKinds.CountermeasureKind(type));
        }
    }
}
