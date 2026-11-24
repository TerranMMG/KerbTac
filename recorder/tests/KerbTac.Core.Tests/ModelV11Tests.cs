using System.Collections.Generic;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class ModelV11Tests
    {
        [Fact]
        public void VesselSampleCarriesCombatColumns()
        {
            var s = new VesselSample
            {
                Ias = 250.5, Mach = 0.82, Aoa = 4.2, Aos = -1.1, Agl = 1200,
                DynPressure = 34.5, PitchInput = 0.3, RollInput = -0.2, YawInput = 0.1,
                Gear = 1, Flaps = 0, Brakes = 0, Health = 0.75
            };
            Assert.Equal(250.5, s.Ias);
            Assert.Equal(0.82, s.Mach);
            Assert.Equal(1200, s.Agl);
            Assert.Equal(0.75, s.Health);
        }

        [Fact]
        public void EventCarriesSourceTargetAndWeapon()
        {
            var e = new KerbTacEvent { Ut = 10, Type = EventTypes.WeaponRelease, VesselId = "blue-1" }
                .WithSource("blue-1").WithTarget("red-1").WithWeapon("AIM-120C")
                .WithRange(28400).WithAspect(12.5).WithPart("missileController", 0);
            Assert.Equal("blue-1", e.SourceId);
            Assert.Equal("red-1", e.TargetId);
            Assert.Equal("AIM-120C", e.Weapon);
            Assert.Equal(28400, e.Range);
            Assert.Equal(0, e.EngineIndex);
        }

        [Fact]
        public void EventAddsOutcomeDamageAndPartId()
        {
            var e = new KerbTacEvent()
                .WithOutcome("hit").WithDamage(0.4).WithPart("part-7", 2);
            Assert.Equal("hit", e.Outcome);
            Assert.Equal(0.4, e.Damage);
            Assert.Equal("part-7", e.PartId);
            Assert.Equal(2, e.EngineIndex);
        }

        [Fact]
        public void VesselDefaultsMatchV1()
        {
            var v = new VesselInfo();
            Assert.Equal("neutral", v.Side);
            Assert.Equal("unknown", v.Kind);
            Assert.Equal(1.0, v.Health);
            Assert.Empty(v.Loadout);
            Assert.Equal(0, v.Importance);
        }

        [Fact]
        public void SegmentDefaultsToFirstLogicalChunk()
        {
            var seg = new TrackSegment();
            Assert.Equal(0, seg.LogicalIndex);
            Assert.Equal(0, seg.ChunkIndex);
        }

        [Fact]
        public void SessionCarriesMissionGapsAndChapters()
        {
            var session = new SessionInfo
            {
                Ut0 = 100,
                Mission = new MissionInfo { Title = "BVR", Tags = new List<string> { "bvr" } },
                Gaps = new List<SessionGap> { new SessionGap { StartUt = 10, EndUt = 12, Reason = "pause" } },
                Chapters = new List<ChapterInfo> { new ChapterInfo { Id = "c1", Name = "Merge", StartUt = 20, EndUt = 30 } }
            };
            Assert.Equal("BVR", session.Mission.Title);
            Assert.Single(session.Gaps);
            Assert.Single(session.Chapters);
            Assert.Equal(100, session.Ut0);
        }

        [Fact]
        public void ActorCarriesTransientSamples()
        {
            var actor = new ActorInfo
            {
                Id = "actor-1", Kind = "weapon/missile", Side = "blue",
                Samples = new List<VesselSample> { new VesselSample { T = 5 } }
            };
            Assert.Equal("weapon/missile", actor.Kind);
            Assert.Single(actor.Samples);
        }

        [Fact]
        public void EffectAndLockCarryCombatFields()
        {
            var effect = new EffectInfo { Ut = 5, Kind = "chaff", Count = 8, Seed = 42, Life = 3 };
            var lockInfo = new RadarLockInfo { SourceId = "blue-1", TargetId = "red-1", Sensor = "radar", Mode = "stt", StartUt = 4, EndUt = 9 };
            Assert.Equal(42, effect.Seed);
            Assert.Equal("stt", lockInfo.Mode);
        }

        [Fact]
        public void SummaryCarriesSessionVesselAndSideStats()
        {
            var summary = new SummaryInfo
            {
                Session = new SummarySession { Duration = 10, DistanceKm = 1.5 },
                Vessels = new List<SummaryVessel> { new SummaryVessel { Id = "blue-1", Shots = 2 } },
                Sides = new Dictionary<string, SummarySide> { { "blue", new SummarySide { Shots = 2 } } }
            };
            Assert.Equal(1.5, summary.Session.DistanceKm);
            Assert.Equal(2, summary.Sides["blue"].Shots);
        }
    }
}
