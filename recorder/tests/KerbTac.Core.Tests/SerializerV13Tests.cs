using System;
using System.Collections.Generic;
using System.Text.Json;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    /// <summary>Format v1.3 (formatRevision 4): recording mode, stage lineage, threat ranges.</summary>
    public class SerializerV13Tests
    {
        private static VesselInfo Stage()
        {
            return new VesselInfo
            {
                Id = "stage-1",
                Name = "Booster",
                Role = "stage.booster",
                ParentId = "vessel-1",
                StageIndex = 2,
                SeparatedUt = 42.5,
                ModelRole = "space.stage"
            };
        }

        [Fact]
        public void ManifestWritesRecordingModeAndStageLineage()
        {
            var session = new SessionInfo
            {
                Id = "s", Name = "Mun", StartUt = 0, EndUt = 100, RecordingMode = "space"
            };
            string json = SessionSerializer.WriteManifest(session, new List<VesselInfo> { Stage() });

            Assert.Contains("\"formatRevision\":4", json);
            Assert.Contains("\"recordingMode\":\"space\"", json);
            Assert.Contains("\"role\":\"stage.booster\"", json);
            Assert.Contains("\"parentId\":\"vessel-1\"", json);
            Assert.Contains("\"stageIndex\":2", json);
            Assert.Contains("\"separatedUt\":42.5", json);
            Assert.Contains("\"modelRole\":\"space.stage\"", json);
        }

        [Fact]
        public void ManifestWritesThreatRanges()
        {
            var vessel = new VesselInfo
            {
                Id = "sam-1",
                Threat = new ThreatInfo { MissileRangeM = 12000, RadarRangeM = 40000, ThreatRadiusM = 12000 }
            };
            string json = SessionSerializer.WriteManifest(
                new SessionInfo { Id = "s", Name = "SAM", StartUt = 0, EndUt = 10 },
                new List<VesselInfo> { vessel });

            using JsonDocument doc = JsonDocument.Parse(json);
            JsonElement threat = doc.RootElement.GetProperty("vessels")[0].GetProperty("threat");
            Assert.Equal(12000, threat.GetProperty("missileRangeM").GetDouble());
            Assert.Equal(40000, threat.GetProperty("radarRangeM").GetDouble());
            Assert.Equal(12000, threat.GetProperty("threatRadiusM").GetDouble());
        }

        [Fact]
        public void ManifestOmitsV13FieldsWhenUnset()
        {
            var session = new SessionInfo { Id = "s", Name = "Old", StartUt = 0, EndUt = 10 };
            string json = SessionSerializer.WriteManifest(session, new List<VesselInfo> { new VesselInfo { Id = "v" } });

            Assert.DoesNotContain("\"recordingMode\"", json);
            Assert.DoesNotContain("\"role\"", json);
            Assert.DoesNotContain("\"parentId\"", json);
            Assert.DoesNotContain("\"stageIndex\"", json);
            Assert.DoesNotContain("\"separatedUt\"", json);
            Assert.DoesNotContain("\"modelRole\"", json);
            Assert.DoesNotContain("\"threat\"", json);
        }

        [Fact]
        public void ManifestOmitsThreatWhenAllRangesAreZero()
        {
            var vessel = new VesselInfo { Id = "truck", Threat = new ThreatInfo() };
            string json = SessionSerializer.WriteManifest(
                new SessionInfo { Id = "s", Name = "No SAM", StartUt = 0, EndUt = 10 },
                new List<VesselInfo> { vessel });

            Assert.DoesNotContain("\"threat\"", json);
        }

        [Fact]
        public void OrbitSegmentWritesExplicitTimesAndElements()
        {
            var segment = new TrackSegment
            {
                Index = 4,
                LogicalIndex = 4,
                Kind = SegmentKinds.Orbit,
                Body = "Kerbin",
                StartUtOverride = 1234.5,
                EndUtOverride = 1300.0,
                Orbit = new OrbitDef
                {
                    Epoch = 1234.5,
                    SemiMajorAxis = 700000,
                    Eccentricity = 0.01,
                    InclinationDeg = 28.5,
                    LanDeg = 120,
                    ArgPeDeg = 30,
                    MeanAnomalyDeg = 10
                }
            };

            string json = SessionSerializer.WriteSegment(segment);
            Assert.Contains("\"kind\":\"orbit\"", json);
            Assert.Contains("\"startUt\":1234.5", json);
            Assert.Contains("\"endUt\":1300", json);
            Assert.Contains("\"semiMajorAxis\":700000", json);
            Assert.DoesNotContain("\"samples\"", json);
        }

        [Fact]
        public void VesselDocumentWritesLineageAndThreat()
        {
            VesselInfo vessel = Stage();
            vessel.Threat = new ThreatInfo { MissileRangeM = 1, RadarRangeM = 2, ThreatRadiusM = 1 };
            vessel.Segments.Add(new TrackSegment
            {
                Index = 0,
                Kind = SegmentKinds.Flight,
                Body = "Kerbin",
                Samples = new List<VesselSample>
                {
                    new VesselSample { T = 0, Latitude = 1, Longitude = 2, Altitude = 3, Attitude = Quatd.Identity }
                }
            });

            string json = SessionSerializer.WriteVessel(vessel);

            Assert.Contains("\"role\":\"stage.booster\"", json);
            Assert.Contains("\"parentId\":\"vessel-1\"", json);
            Assert.Contains("\"stageIndex\":2", json);
            Assert.Contains("\"separatedUt\":42.5", json);
            Assert.Contains("\"modelRole\":\"space.stage\"", json);
            Assert.Contains("\"threat\"", json);
        }
    }
}
