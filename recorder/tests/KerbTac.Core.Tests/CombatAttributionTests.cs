using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class CombatAttributionTests
    {
        [Fact]
        public void FindsMostRecentAttackWithinWindow()
        {
            var attribution = new CombatAttribution();
            attribution.Record("blue-1", "red-1", "AIM-120", "actor-1", 10);
            attribution.Record("blue-2", "red-1", "gun", null, 12);

            CombatAttacker attacker;
            Assert.True(attribution.TryFind("red-1", 13, out attacker));
            Assert.Equal("blue-2", attacker.AttackerId);
            Assert.Equal("gun", attacker.Weapon);
            Assert.Null(attacker.ActorId);
        }

        [Fact]
        public void OldAttackIsOutsideWindow()
        {
            var attribution = new CombatAttribution();
            attribution.Record("blue-1", "red-1", "AIM-120", "actor-1", 10);

            CombatAttacker attacker;
            Assert.False(attribution.TryFind("red-1", 41, out attacker));
        }

        [Fact]
        public void WindowIsThirtySeconds()
        {
            var attribution = new CombatAttribution();
            attribution.Record("blue-1", "red-1", "AIM-120", "actor-1", 10);

            CombatAttacker attacker;
            Assert.True(attribution.TryFind("red-1", 39.9, out attacker));
            Assert.False(attribution.TryFind("red-1", 40.1, out attacker));
        }

        [Fact]
        public void TargetMustMatch()
        {
            var attribution = new CombatAttribution();
            attribution.Record("blue-1", "red-1", "AIM-120", "actor-1", 10);

            CombatAttacker attacker;
            Assert.False(attribution.TryFind("red-2", 12, out attacker));
        }

        [Fact]
        public void EmptyAttackerIsIgnored()
        {
            var attribution = new CombatAttribution();
            attribution.Record(null, "red-1", "AIM-120", "actor-1", 10);
            attribution.Record("", "red-1", "AIM-120", "actor-1", 11);

            CombatAttacker attacker;
            Assert.False(attribution.TryFind("red-1", 12, out attacker));
        }

        [Fact]
        public void PruneRemovesOldRecords()
        {
            var attribution = new CombatAttribution();
            attribution.Record("blue-1", "red-1", "AIM-120", "actor-1", 10);
            attribution.Prune(320);

            CombatAttacker attacker;
            Assert.False(attribution.TryFind("red-1", 30, out attacker));
        }
    }
}
