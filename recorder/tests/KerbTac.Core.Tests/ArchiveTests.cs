using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class ArchiveTests : IDisposable
    {
        private readonly string _root;

        public ArchiveTests()
        {
            _root = Path.Combine(Path.GetTempPath(), "kerbtac-archive-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_root);
        }

        [Fact]
        public void ExistingDestinationIsNeverReplaced()
        {
            string output = Path.Combine(_root, "existing.kerbtac");
            File.WriteAllText(output, "prior recording");
            Assert.ThrowsAny<IOException>(() => RecordingArchive.Create(
                Path.Combine(_root, "spills"), output, new SessionInfo(), new List<VesselInfo>(),
                new Dictionary<string, BodyDef>(), new List<KerbTacEvent>(),
                new Dictionary<string, IList<string>>()));
            Assert.Equal("prior recording", File.ReadAllText(output));
        }

        [Fact]
        public void DestinationCreatedDuringStagingIsNotClobbered()
        {
            string output = Path.Combine(_root, "raced.kerbtac");
            IEnumerable<string> ReadSegments(string id)
            {
                Assert.False(File.Exists(output));
                Assert.Single(Directory.GetFiles(_root, "*.partial"));
                File.WriteAllText(output, "new file from another writer");
                yield return "{\"index\":0}";
            }

            Assert.ThrowsAny<IOException>(() => RecordingArchive.CreateStreaming(
                output, new SessionInfo(), new List<VesselInfo> { new VesselInfo { Id = "v-1" } },
                new Dictionary<string, BodyDef>(), new List<KerbTacEvent>(), ReadSegments,
                null, null, null, null));
            Assert.Equal("new file from another writer", File.ReadAllText(output));
            Assert.Empty(Directory.GetFiles(_root, "*.partial"));
        }

        public void Dispose()
        {
            try
            {
                if (Directory.Exists(_root)) Directory.Delete(_root, true);
            }
            catch
            {
                // best effort in tests
            }
        }

        private static VesselSample Sample(double t, double lat)
        {
            return new VesselSample
            {
                T = t,
                Latitude = lat,
                Longitude = -74.5,
                Altitude = 70,
                Attitude = Quatd.Identity,
                VelocityX = 1,
                VelocityY = 0,
                VelocityZ = 0,
                Throttle = 0.5f,
                Mass = 12000,
                GeeForce = 1.0,
                Stage = 3,
                Situation = "FLYING",
                Heading = 90,
                VerticalSpeed = 0.4,
                SurfaceSpeed = 1.2
            };
        }

        private string CreateArchive()
        {
            SessionInfo session = new SessionInfo
            {
                Id = "20261103T120000Z-abcdef",
                Name = "Test Flight",
                SaveName = "MNCS",
                KspVersion = "1.12.5.3190",
                StartUt = 1000.0,
                EndUt = 1002.0,
                GeneratorName = "KerbTac Recorder",
                GeneratorVersion = "0.1.0"
            };

            VesselInfo vessel = new VesselInfo
            {
                Id = "v-1",
                Name = "Synthetic Trainer",
                Type = "Plane",
                Body = "Kerbin",
                Color = "#4fc3f7",
                PartCount = 12,
                CrewCount = 1
            };

            TrackSegment segment = new TrackSegment
            {
                Index = 0,
                Kind = SegmentKinds.Flight,
                Body = "Kerbin",
                Source = "active"
            };
            segment.Samples.Add(Sample(1000.0, 0.0));
            segment.Samples.Add(Sample(1000.1, 0.001));
            string segmentJson = SessionSerializer.WriteSegment(segment);

            Dictionary<string, BodyDef> bodies = new Dictionary<string, BodyDef>
            {
                {
                    "Kerbin",
                    new BodyDef
                    {
                        Name = "Kerbin",
                        Radius = 600000,
                        GravParameter = 3.5316e12,
                        AtmosphereDepth = 70000,
                        SphereOfInfluence = 84159286,
                        Rotation = new BodyRotationDef
                        {
                            EpochUt = 0,
                            Q0 = new double[] { 0, 0, 0, 1 },
                            Axis = new double[] { 0, 1, 0 },
                            RateDegPerSec = 0.0167083333
                        },
                        Style = "kerbin"
                    }
                }
            };

            List<KerbTacEvent> events = new List<KerbTacEvent>
            {
                new KerbTacEvent { Ut = 1000.0, Type = "flight_start", VesselId = "v-1" },
                new KerbTacEvent { Ut = 1002.0, Type = "flight_end", VesselId = "v-1" }
            };

            Dictionary<string, IList<string>> tracks = new Dictionary<string, IList<string>>
            {
                { "v-1", new List<string> { segmentJson } }
            };

            return RecordingArchive.Create(
                Path.Combine(_root, "temp"),
                Path.Combine(_root, "out", "flight.kerbtac"),
                session,
                new List<VesselInfo> { vessel },
                bodies,
                events,
                tracks);
        }

        [Fact]
        public void CreateWritesOptionalV11EntriesAndSummary()
        {
            SessionInfo session = new SessionInfo
            {
                Id = "20261103T120000Z-abcdef",
                Name = "Combat Flight",
                StartUt = 1000.0,
                EndUt = 1010.0,
                GeneratorName = "KerbTac Recorder",
                GeneratorVersion = "0.1.0"
            };
            VesselInfo vessel = new VesselInfo { Id = "v-1", Name = "Fighter", Body = "Kerbin" };
            TrackSegment segment = new TrackSegment { Index = 0, Body = "Kerbin" };
            segment.Samples.Add(Sample(1000.0, 0.0));
            segment.Samples.Add(Sample(1001.0, 0.001));

            ActorInfo actor = new ActorInfo
            {
                Id = "a-1",
                Name = "AIM-120",
                Kind = "missile",
                Body = "Kerbin",
                ParentId = "v-1"
            };
            actor.Samples.Add(Sample(1002.0, 0.0));

            EffectInfo effect = new EffectInfo
            {
                Ut = 1003.0,
                Kind = "chaff",
                Body = "Kerbin",
                SourceId = "v-1",
                Count = 24,
                Seed = 7,
                Life = 2.5
            };
            RadarLockInfo lockInfo = new RadarLockInfo
            {
                SourceId = "v-1",
                TargetId = "v-2",
                Sensor = "radar",
                Mode = "stt",
                StartUt = 1004.0,
                EndUt = 1006.0
            };
            SummaryInfo summary = new SummaryInfo();
            summary.Session.DistanceKm = 12.5;
            summary.Vessels.Add(new SummaryVessel { Id = "v-1", Shots = 1, Hits = 1 });

            string path = RecordingArchive.Create(
                Path.Combine(_root, "temp2"),
                Path.Combine(_root, "out", "combat.kerbtac"),
                session,
                new List<VesselInfo> { vessel },
                new Dictionary<string, BodyDef>(),
                new List<KerbTacEvent>(),
                new Dictionary<string, IList<string>>
                {
                    { "v-1", new List<string> { SessionSerializer.WriteSegment(segment) } }
                },
                new List<ActorInfo> { actor },
                new List<EffectInfo> { effect },
                new List<RadarLockInfo> { lockInfo },
                summary);

            using ZipArchive zip = ZipFile.OpenRead(path);
            Assert.NotNull(zip.GetEntry("actors.json"));
            Assert.NotNull(zip.GetEntry("effects.json"));
            Assert.NotNull(zip.GetEntry("locks.json"));
            Assert.NotNull(zip.GetEntry("summary.json"));

            using JsonDocument manifest = ReadJson(zip, "manifest.json");
            Assert.Equal(4, manifest.RootElement.GetProperty("formatRevision").GetInt32());
            Assert.Equal("actors.json", manifest.RootElement.GetProperty("actors").GetString());
            Assert.Equal("effects.json", manifest.RootElement.GetProperty("effects").GetString());
            Assert.Equal("locks.json", manifest.RootElement.GetProperty("locks").GetString());
            Assert.Equal("summary.json", manifest.RootElement.GetProperty("summary").GetString());

            using JsonDocument actors = ReadJson(zip, "actors.json");
            Assert.Equal("AIM-120", actors.RootElement.GetProperty("actors")[0].GetProperty("name").GetString());

            using JsonDocument summaryJson = ReadJson(zip, "summary.json");
            Assert.Equal(12.5, summaryJson.RootElement.GetProperty("session").GetProperty("distanceKm").GetDouble(), 6);
        }

        [Fact]
        public void CreateWritesAllRequiredEntries()
        {
            string path = CreateArchive();
            Assert.True(File.Exists(path));

            using ZipArchive zip = ZipFile.OpenRead(path);
            List<string> names = new List<string>();
            foreach (ZipArchiveEntry entry in zip.Entries) names.Add(entry.FullName);

            Assert.Contains("README.txt", names);
            Assert.Contains("manifest.json", names);
            Assert.Contains("bodies.json", names);
            Assert.Contains("events.json", names);
            Assert.Contains("vessels/v-1.json", names);
            Assert.False(File.Exists(Path.Combine(_root, "temp", "recording.zip")));
        }

        [Fact]
        public void ManifestAndTrackAreValidJson()
        {
            string path = CreateArchive();
            using ZipArchive zip = ZipFile.OpenRead(path);

            using JsonDocument manifest = ReadJson(zip, "manifest.json");
            Assert.Equal("kerbtac", manifest.RootElement.GetProperty("format").GetString());
            Assert.Equal(1, manifest.RootElement.GetProperty("formatVersion").GetInt32());
            JsonElement vessels = manifest.RootElement.GetProperty("vessels");
            Assert.Equal(1, vessels.GetArrayLength());
            Assert.Equal("v-1", vessels[0].GetProperty("id").GetString());
            Assert.Equal("vessels/v-1.json", vessels[0].GetProperty("track").GetString());

            using JsonDocument track = ReadJson(zip, "vessels/v-1.json");
            JsonElement segments = track.RootElement.GetProperty("segments");
            Assert.Equal(1, segments.GetArrayLength());
            JsonElement columns = segments[0].GetProperty("samples");
            Assert.Equal(2, columns.GetProperty("t").GetArrayLength());
            Assert.Equal(8, columns.GetProperty("q").GetArrayLength());
            Assert.Equal(1000.0, columns.GetProperty("t")[0].GetDouble(), 6);

            using JsonDocument events = ReadJson(zip, "events.json");
            Assert.Equal(2, events.RootElement.GetArrayLength());
        }

        private static JsonDocument ReadJson(ZipArchive zip, string name)
        {
            ZipArchiveEntry entry = zip.GetEntry(name);
            Assert.NotNull(entry);
            using Stream stream = entry.Open();
            using StreamReader reader = new StreamReader(stream);
            return JsonDocument.Parse(reader.ReadToEnd());
        }
    }
}
