using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class ActorTrackerTests
    {
        private static ActorInput Input(
            string id,
            double ut,
            BdaActorClass actorClass = BdaActorClass.Missile,
            bool exploded = false,
            bool missed = false)
        {
            return new ActorInput
            {
                ActorId = id,
                Name = "AIM-120",
                ActorClass = actorClass,
                Side = "blue",
                ParentId = "parent-1",
                TargetId = "target-1",
                Weapon = "AIM-120",
                Body = "Kerbin",
                Lat = 1,
                Lon = 2,
                Alt = 3000,
                Ut = ut,
                HasExploded = exploded,
                HasMissed = missed,
                TntMass = 12,
                Warhead = "standard",
                ExplosionSource = "Missile"
            };
        }

        [Fact]
        public void FirstSightingEmitsSpawn()
        {
            var tracker = new ActorTracker();
            var result = tracker.Poll(new[] { Input("a1", 10) }, 10);

            Assert.Single(result.Spawns);
            Assert.Empty(result.Ends);
            Assert.Equal("weapon/missile", result.Spawns[0].Kind);
            Assert.Equal("parent-1", result.Spawns[0].ParentId);
            Assert.Equal("target-1", result.Spawns[0].TargetId);
        }

        [Fact]
        public void BombClassMapsToBombKind()
        {
            var tracker = new ActorTracker();
            var result = tracker.Poll(new[] { Input("b1", 10, BdaActorClass.Bomb) }, 10);
            Assert.Equal("weapon/bomb", result.Spawns[0].Kind);
        }

        [Fact]
        public void ExplosionEmitsOneEnd()
        {
            var tracker = new ActorTracker();
            tracker.Poll(new[] { Input("a1", 10) }, 10);

            var first = tracker.Poll(new[] { Input("a1", 12, exploded: true) }, 12);
            Assert.Single(first.Ends);
            Assert.Equal("exploded", first.Ends[0].Reason);
            Assert.Equal(12, first.Ends[0].TntMass);

            var second = tracker.Poll(new[] { Input("a1", 12.5, exploded: true) }, 12.5);
            Assert.Empty(second.Ends);
        }

        [Fact]
        public void MissEmitsOneEnd()
        {
            var tracker = new ActorTracker();
            tracker.Poll(new[] { Input("a1", 10) }, 10);
            var result = tracker.Poll(new[] { Input("a1", 20, missed: true) }, 20);
            Assert.Single(result.Ends);
            Assert.Equal("missed", result.Ends[0].Reason);
        }

        [Fact]
        public void ExplosionWinsOverMiss()
        {
            var tracker = new ActorTracker();
            tracker.Poll(new[] { Input("a1", 10) }, 10);
            var result = tracker.Poll(new[] { new ActorInput
            {
                ActorId = "a1",
                HasExploded = true,
                HasMissed = true,
                Ut = 12
            } }, 12);
            Assert.Single(result.Ends);
            Assert.Equal("exploded", result.Ends[0].Reason);
        }

        [Fact]
        public void LostActorEndsAfterTimeout()
        {
            var tracker = new ActorTracker();
            tracker.Poll(new[] { Input("a1", 10) }, 10);

            var before = tracker.Poll(new ActorInput[0], 11.9);
            Assert.Empty(before.Ends);

            var after = tracker.Poll(new ActorInput[0], 12.1);
            Assert.Single(after.Ends);
            Assert.Equal("lost", after.Ends[0].Reason);
            Assert.Equal("Kerbin", after.Ends[0].Body);
        }

        [Fact]
        public void LostGuidCannotSpawnAgainUntilReset()
        {
            var tracker = new ActorTracker();
            Assert.Single(tracker.Poll(new[] { Input("a1", 10) }, 10).Spawns);
            Assert.Single(tracker.Poll(null, 12.1).Ends);
            Assert.False(tracker.Contains("a1"));
            var reappeared = tracker.Poll(new[] { Input("a1", 13, exploded: true) }, 13);
            Assert.Empty(reappeared.Spawns);
            Assert.Empty(reappeared.Ends);
            tracker.Reset();
            Assert.Single(tracker.Poll(new[] { Input("a1", 14) }, 14).Spawns);
        }

        [Fact]
        public void MissedGuidCannotEndAgainWhenLaterReportedExploded()
        {
            var tracker = new ActorTracker();
            Assert.Single(tracker.Poll(new[] { Input("a1", 10, missed: true) }, 10).Ends);
            Assert.False(tracker.Contains("a1"));
            Assert.Empty(tracker.Poll(new[] { Input("a1", 11, exploded: true) }, 11).Ends);
        }

        [Fact]
        public void SpawnAndExplosionInSamePollEmitBoth()
        {
            var tracker = new ActorTracker();
            var result = tracker.Poll(new[] { Input("a1", 10, exploded: true) }, 10);
            Assert.Single(result.Spawns);
            Assert.Single(result.Ends);
        }

        [Fact]
        public void EmptyIdIsIgnored()
        {
            var tracker = new ActorTracker();
            var result = tracker.Poll(new[] { Input("", 10) }, 10);
            Assert.Empty(result.Spawns);
            Assert.Empty(result.Ends);
        }
    }
}
