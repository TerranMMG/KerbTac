using System.Collections.Generic;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public sealed class GunfireBurstTrackerTests
    {
        private static GunfireInput Input(
            double ut,
            double timeFired,
            int rounds = 0,
            double rpm = 600,
            Vec3d? direction = null,
            string part = "gun-1",
            int module = 0)
        {
            return new GunfireInput
            {
                VesselId = "v1",
                PartId = part,
                ModuleIndex = module,
                Ut = ut,
                TimeFired = timeFired,
                RoundsRemaining = rounds,
                RoundsPerMinute = rpm,
                PositionBf = new Vec3d(10, 20, 30),
                DirectionBf = direction ?? new Vec3d(1, 0, 0),
                WeaponType = "ballistic",
                Ammo = "20mm",
                Caliber = 20,
                MuzzleSpeed = 1000,
                TracerColor = "orange"
            };
        }

        [Fact]
        public void FirstObservationIsBaselineAndDoesNotEmit()
        {
            var tracker = new GunfireBurstTracker();
            Assert.Empty(tracker.Poll(new[] { Input(0, 10) }));
            Assert.Empty(tracker.FlushStale(1));
        }

        [Fact]
        public void OneShotBecomesOneBurstAfterGap()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 0) });
            Assert.Empty(tracker.Poll(new[] { Input(0.02, 10.02, 1) }));

            var bursts = tracker.FlushStale(0.5);
            Assert.Single(bursts);
            Assert.Equal(1, bursts[0].Rounds);
            Assert.Equal(0.02, bursts[0].StartUt, 6);
            Assert.Equal(0.02, bursts[0].EndUt, 6);
            Assert.Equal("v1", bursts[0].VesselId);
            Assert.Equal("gun-1", bursts[0].PartId);
            Assert.Equal(new Vec3d(10, 20, 30), bursts[0].PositionBf);
        }

        [Fact]
        public void ContinuousShotsAccumulateRounds()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 0) });
            for (int i = 1; i <= 5; i++)
            {
                tracker.Poll(new[] { Input(i * 0.02, 10 + i * 0.02, i) });
            }

            var bursts = tracker.FlushStale(0.6);
            Assert.Single(bursts);
            Assert.Equal(5, bursts[0].Rounds);
            Assert.Equal(0.1, bursts[0].EndUt, 6);
        }

        [Fact]
        public void GapSplitsBursts()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 0) });
            tracker.Poll(new[] { Input(0.02, 10.02, 1) });

            var first = tracker.Poll(new[] { Input(0.5, 10.5, 2) });
            Assert.Single(first);
            Assert.Equal(0.02, first[0].StartUt, 6);

            var second = tracker.FlushAll();
            Assert.Single(second);
            Assert.Equal(0.5, second[0].StartUt, 6);
            Assert.Equal(1, second[0].Rounds);
        }

        [Fact]
        public void DirectionChangeSplitsBursts()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 0, direction: new Vec3d(1, 0, 0)) });
            tracker.Poll(new[] { Input(0.02, 10.02, 1, direction: new Vec3d(1, 0, 0)) });

            var first = tracker.Poll(new[] { Input(0.04, 10.04, 2, direction: new Vec3d(1, 0.3, 0)) });
            Assert.Single(first);

            var second = tracker.FlushAll();
            Assert.Single(second);
            Assert.Equal(0.04, second[0].StartUt, 6);
        }

        [Fact]
        public void LongBurstIsSplitAtMaxDuration()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 0) });
            tracker.Poll(new[] { Input(0.02, 10.02, 1) });
            tracker.Poll(new[] { Input(0.4, 10.4, 2) });

            var completed = tracker.Poll(new[] { Input(0.8, 10.8, 3) });
            Assert.Single(completed);
            Assert.Equal(0.02, completed[0].StartUt, 6);
            Assert.Equal(0.4, completed[0].EndUt, 6);

            var tail = tracker.FlushAll();
            Assert.Single(tail);
            Assert.Equal(0.8, tail[0].StartUt, 6);
        }

        [Fact]
        public void ReloadResetsBurst()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 100) });
            tracker.Poll(new[] { Input(0.02, 10.02, 102) });

            var completed = tracker.Poll(new[] { new GunfireInput
            {
                VesselId = "v1",
                PartId = "gun-1",
                ModuleIndex = 0,
                Ut = 0.04,
                TimeFired = 10.04,
                RoundsRemaining = 0,
                RoundsPerMinute = 600,
                IsReloading = true,
                PositionBf = new Vec3d(10, 20, 30),
                DirectionBf = new Vec3d(1, 0, 0)
            } });
            Assert.Single(completed);
            Assert.Equal(2, completed[0].Rounds);

            var tail = tracker.FlushAll();
            Assert.Single(tail);
            Assert.Equal(1, tail[0].Rounds);
        }

        [Fact]
        public void MissingRoundCounterUsesRpmEstimate()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 100, rpm: 6000) });
            tracker.Poll(new[] { Input(0.02, 10.02, 100, rpm: 6000) });

            var bursts = tracker.FlushAll();
            Assert.Single(bursts);
            Assert.Equal(2, bursts[0].Rounds);
        }

        [Fact]
        public void UnchangedTimeFiredDoesNotStartBurst()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 0) });
            for (int i = 1; i <= 10; i++)
            {
                tracker.Poll(new[] { Input(i * 0.02, 10, 0) });
            }

            Assert.Empty(tracker.FlushAll());
        }

        [Fact]
        public void WeaponsAreTrackedIndependently()
        {
            var tracker = new GunfireBurstTracker();
            tracker.Poll(new[] { Input(0, 10, 0, part: "a", module: 0) });
            tracker.Poll(new[] { Input(0, 20, 0, part: "b", module: 1) });
            tracker.Poll(new[] { Input(0.02, 10.02, 1, part: "a", module: 0) });
            tracker.Poll(new[] { Input(0.02, 20.02, 1, part: "b", module: 1) });

            var bursts = tracker.FlushAll();
            Assert.Equal(2, bursts.Count);
        }
    }
}
