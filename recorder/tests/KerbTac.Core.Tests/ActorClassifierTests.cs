using Xunit;
using KerbTac;

namespace KerbTac.Core.Tests
{
    public class ActorClassifierTests
    {
        [Fact]
        public void MissileWithoutFireControlIsTransient()
        {
            Assert.True(ActorClassifier.IsTransientActor(true, false));
        }

        [Fact]
        public void FighterWithMissilesAndFireControlIsPersistent()
        {
            Assert.False(ActorClassifier.IsTransientActor(true, true));
        }

        [Fact]
        public void VesselWithoutMissileModulesIsPersistent()
        {
            Assert.False(ActorClassifier.IsTransientActor(false, false));
        }

        [Fact]
        public void PilotOnlyCraftIsPersistent()
        {
            Assert.False(ActorClassifier.IsTransientActor(false, true));
        }
    }
}
