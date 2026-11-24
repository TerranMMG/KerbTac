using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class SerializerV11Tests : IDisposable
    {
        private readonly string _root;

        [Fact]
        public void SegmentKeepsMeasuredZeroSeparateFromMissingOptionalCells()
        {
            var segment = new TrackSegment { Kind = SegmentKinds.Flight, Body = "Kerbin" };
            segment.Samples.Add(new VesselSample { T = 10, Health = 0, Gear = 0, LiquidFuel = 0, Stage = 0 });
            segment.Samples.Add(new VesselSample { T = 11, Health = 0.75, Ias = 10 });
            using var doc = JsonDocument.Parse(SessionSerializer.WriteSegment(segment));
            var samples = doc.RootElement.GetProperty("samples");
            Assert.Equal("[0,0.75]", samples.GetProperty("health").GetRawText());
            Assert.Equal("[0,null]", samples.GetProperty("gear").GetRawText());
            Assert.Equal("[0,null]", samples.GetProperty("lf").GetRawText());
            Assert.Equal("[0,null]", samples.GetProperty("stage").GetRawText());
            Assert.Equal("[null,10]", samples.GetProperty("ias").GetRawText());
            Assert.False(samples.TryGetProperty("ox", out _));
            Assert.False(samples.TryGetProperty("flaps", out _));
        }

        [Fact]
        public void SegmentDoesNotInventSituationOrSurfaceSpeedForAnIncompleteRow()
        {
            var segment = new TrackSegment { Kind = SegmentKinds.Flight, Body = "Kerbin" };
            segment.Samples.Add(new VesselSample { T = 10, Situation = "LANDED", SurfaceSpeed = 0 });
            segment.Samples.Add(new VesselSample { T = 11, GeeForce = double.PositiveInfinity });
            using var doc = JsonDocument.Parse(SessionSerializer.WriteSegment(segment));
            var samples = doc.RootElement.GetProperty("samples");
            Assert.Equal("[\"LANDED\",null]", samples.GetProperty("situation").GetRawText());
            Assert.Equal("[0,null]", samples.GetProperty("srfSpeed").GetRawText());
            Assert.False(samples.TryGetProperty("g", out _));
        }

        public SerializerV11Tests()
        {
            _root = Path.Combine(Path.GetTempPath(), "kerbtac-v11-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_root);
        }

        public void Dispose()
        {
            try
            {
                if (Directory.Exists(_root)) Directory.Delete(_root, true);
            }
            catch
            {
                // best effort
            }
        }

        private static VesselSample Sample(double t)
        {
            return new VesselSample { T = t, Latitude = 1, Longitude = 2, Altitude = 100, Attitude = Quatd.Identity };
        }

        [Fact]
        public void ManifestWritesRevisionMissionGapsAndVesselSide()
        {
            var session = new SessionInfo { Id = "s", Name = "BVR", StartUt = 10, EndUt = 20, StartWallUtc = DateTime.UtcNow, EndWallUtc = DateTime.UtcNow };
            session.Mission = new MissionInfo { Title = "BVR 2v2", Category = "BVR" };
            session.Gaps.Add(new SessionGap { StartUt = 12, EndUt = 13, Reason = "pause" });
            var vessel = new VesselInfo { Id = "blue-1", Name = "F-16", Side = "blue", Kind = "air/fixedwing", Health = 0.8 };
            string json = SessionSerializer.WriteManifest(session, new List<VesselInfo> { vessel });
            Assert.Contains("\"formatRevision\":4", json);
            Assert.Contains("\"mission\"", json);
            Assert.Contains("\"gaps\"", json);
            Assert.Contains("\"side\":\"blue\"", json);
            Assert.Contains("\"health\":0.8", json);
        }

        [Fact]
        public void ManifestKeepsV1DefaultsWhenNoV11Data()
        {
            var session = new SessionInfo { Id = "s", Name = "Old", StartUt = 10, EndUt = 20 };
            string json = SessionSerializer.WriteManifest(session, new List<VesselInfo> { new VesselInfo { Id = "v" } });
            Assert.Contains("\"formatVersion\":1", json);
            Assert.Contains("\"formatRevision\":4", json);
            Assert.DoesNotContain("\"mission\"", json);
            Assert.DoesNotContain("\"gaps\"", json);
            Assert.DoesNotContain("\"side\"", json);
        }

        [Fact]
        public void EventsWriteCombatIdentity()
        {
            var events = new List<KerbTacEvent>
            {
                new KerbTacEvent { Ut = 5, Type = EventTypes.Hit, VesselId = "red-1" }
                    .WithSource("blue-1").WithTarget("red-1").WithWeapon("AIM-120C")
                    .WithOutcome("hit").WithRange(28400).WithAspect(12.5).WithDamage(0.25)
                    .WithPart("4294967295", 0)
            };
            string json = SessionSerializer.WriteEvents(events);
            Assert.Contains("\"source\":\"blue-1\"", json);
            Assert.Contains("\"weapon\":\"AIM-120C\"", json);
            Assert.Contains("\"outcome\":\"hit\"", json);
            Assert.Contains("\"range\":28400", json);
            Assert.Contains("\"aspect\":12.5", json);
            Assert.Contains("\"damage\":0.25", json);
            Assert.Contains("\"partId\":\"4294967295\"", json);
            Assert.Contains("\"engineIndex\":0", json);
        }

        [Fact]
        public void ActorsWriteTransientTracks()
        {
            var actors = new List<ActorInfo>
            {
                new ActorInfo
                {
                    Id = "actor-1", Name = "AIM-120C", Kind = "weapon/missile", Side = "blue",
                    ParentId = "blue-1", TargetId = "red-1", Weapon = "AIM-120C", Body = "Kerbin",
                    StartUt = 5, EndUt = 6,
                    Samples = new List<VesselSample> { Sample(5), Sample(5.1) }
                }
            };
            string json = SessionSerializer.WriteActors(actors);
            Assert.Contains("\"actors\"", json);
            Assert.Contains("\"id\":\"actor-1\"", json);
            Assert.Contains("\"parent\":\"blue-1\"", json);
            using JsonDocument doc = JsonDocument.Parse(json);
            JsonElement actor = doc.RootElement.GetProperty("actors")[0];
            JsonElement samples = actor.GetProperty("samples");
            Assert.Equal(2, samples.GetProperty("t").GetArrayLength());
            Assert.Equal(8, samples.GetProperty("q").GetArrayLength());
            Assert.Equal(5, samples.GetProperty("t")[0].GetDouble());
            Assert.Equal(5.1, samples.GetProperty("t")[1].GetDouble(), 6);
        }

        [Fact]
        public void EffectsLocksAndSummaryWriteExpectedShape()
        {
            string effects = SessionSerializer.WriteEffects(new List<EffectInfo>
            {
                new EffectInfo { Ut = 5, Kind = "chaff", Body = "Kerbin", Lat = 1, Lon = 2, Alt = 3000, Count = 8, Seed = 42, Spread = 10, Life = 4, SourceId = "red-1" }
            });
            Assert.Contains("\"effects\"", effects);
            Assert.Contains("\"count\":8", effects);
            Assert.Contains("\"seed\":42", effects);

            string locks = SessionSerializer.WriteLocks(new List<RadarLockInfo>
            {
                new RadarLockInfo { SourceId = "blue-1", TargetId = "red-1", Sensor = "radar", Mode = "STT", StartUt = 4, EndUt = 9 }
            });
            Assert.Contains("\"locks\"", locks);
            Assert.Contains("\"mode\":\"STT\"", locks);

            string summary = SessionSerializer.WriteSummary(new SummaryInfo
            {
                Session = new SummarySession { Duration = 10, DistanceKm = 1.5, MaxG = 7.4 },
                Vessels = new List<SummaryVessel> { new SummaryVessel { Id = "blue-1", Shots = 2, Hits = 1, Kills = 0, FuelUsed = 12, DistanceKm = 1.2 } },
                Sides = new Dictionary<string, SummarySide> { { "blue", new SummarySide { Shots = 2, Hits = 1 } } }
            });
            Assert.Contains("\"distanceKm\":1.5", summary);
            Assert.Contains("\"shots\":2", summary);
            Assert.Contains("\"sides\"", summary);
        }

        [Fact]
        public void ArchiveAddsOptionalEntriesOnlyWhenPresent()
        {
            SessionInfo session = new SessionInfo { Id = "s", Name = "BVR", StartUt = 1, EndUt = 2 };
            var vessels = new List<VesselInfo> { new VesselInfo { Id = "v-1", Name = "Jet" } };
            var bodies = new Dictionary<string, BodyDef>
            {
                { "Kerbin", new BodyDef { Name = "Kerbin", Radius = 600000, Rotation = new BodyRotationDef { Q0 = new double[] { 0, 0, 0, 1 }, Axis = new double[] { 0, 1, 0 } } } }
            };
            var tracks = new Dictionary<string, IList<string>> { { "v-1", new List<string>() } };

            string withOptional = RecordingArchive.Create(
                Path.Combine(_root, "t1"), Path.Combine(_root, "a.kerbtac"),
                session, vessels, bodies, new List<KerbTacEvent>(), tracks,
                new List<ActorInfo> { new ActorInfo { Id = "actor-1", Samples = new List<VesselSample> { Sample(1) } } },
                new List<EffectInfo> { new EffectInfo { Ut = 1, Kind = "chaff", Count = 1, Life = 1 } },
                new List<RadarLockInfo> { new RadarLockInfo { SourceId = "a", TargetId = "b", StartUt = 1, EndUt = 2 } },
                new SummaryInfo { Session = new SummarySession { Duration = 1 } });

            using (ZipArchive zip = ZipFile.OpenRead(withOptional))
            {
                Assert.NotNull(zip.GetEntry("actors.json"));
                Assert.NotNull(zip.GetEntry("effects.json"));
                Assert.NotNull(zip.GetEntry("locks.json"));
                Assert.NotNull(zip.GetEntry("summary.json"));
                Assert.NotNull(zip.GetEntry("README.txt"));
            }

            string withoutOptional = RecordingArchive.Create(
                Path.Combine(_root, "t2"), Path.Combine(_root, "b.kerbtac"),
                session, vessels, bodies, new List<KerbTacEvent>(), tracks);

            using (ZipArchive zip = ZipFile.OpenRead(withoutOptional))
            {
                Assert.Null(zip.GetEntry("actors.json"));
                Assert.Null(zip.GetEntry("effects.json"));
                Assert.Null(zip.GetEntry("locks.json"));
                Assert.Null(zip.GetEntry("summary.json"));
                Assert.NotNull(zip.GetEntry("README.txt"));
            }
        }

        [Fact]
        public void SegmentWritesOptionalCombatColumns()
        {
            var seg = new TrackSegment { Samples = new List<VesselSample> {
                new VesselSample { T = 1, Ias = 250, Mach = 0.82, Aoa = 4, Agl = 1000, Health = 1 },
                new VesselSample { T = 1.1, Ias = 251, Mach = 0.83, Aoa = 4.1, Agl = 1001, Health = 1 }
            }};
            string json = SessionSerializer.WriteSegment(seg);
            Assert.Contains("\"ias\":[250,251]", json);
            Assert.Contains("\"mach\":[0.82,0.83]", json);
            Assert.Contains("\"health\":[1,1]", json);
        }

        [Fact]
        public void ManifestListsOptionalEntryPaths()
        {
            var session = new SessionInfo { Id = "s", Name = "BVR" };
            string json = SessionSerializer.WriteManifest(session, new List<VesselInfo>());
            Assert.Equal(4, KerbTacVersion.FormatRevision);
            Assert.Contains("\"formatRevision\":4", json);
        }
    }
}
