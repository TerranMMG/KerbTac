using System;
using System.Collections.Generic;
using System.Text.Json;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class SerializerTests
    {
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
                SurfaceSpeed = 1.2,
                LiquidFuel = 10,
                Oxidizer = 0,
                ElectricCharge = 10,
                MonoPropellant = 1
            };
        }

        [Fact]
        public void SegmentWritesAllColumnsWithMatchingLengths()
        {
            TrackSegment segment = new TrackSegment
            {
                Index = 0,
                Kind = SegmentKinds.Flight,
                Body = "Kerbin",
                IncludeResources = true
            };
            segment.Samples.Add(Sample(100.0, 0.0));
            segment.Samples.Add(Sample(100.1, 0.001));

            using JsonDocument doc = JsonDocument.Parse(SessionSerializer.WriteSegment(segment));
            JsonElement root = doc.RootElement;
            JsonElement samples = root.GetProperty("samples");

            int n = samples.GetProperty("t").GetArrayLength();
            Assert.Equal(2, n);
            Assert.Equal(100.0, samples.GetProperty("t")[0].GetDouble());
            Assert.Equal(100.1, samples.GetProperty("t")[1].GetDouble());

            foreach (string column in new[] { "lat", "lon", "alt", "vx", "vy", "vz", "throttle",
                                               "mass", "g", "stage", "situation", "hdg", "vs",
                                               "srfSpeed", "lf", "ox", "ec", "mp" })
            {
                Assert.Equal(n, samples.GetProperty(column).GetArrayLength());
            }

            Assert.Equal(n * 4, samples.GetProperty("q").GetArrayLength());
            Assert.Equal(100.0, root.GetProperty("startUt").GetDouble());
            Assert.Equal(100.1, root.GetProperty("endUt").GetDouble());
        }

        [Fact]
        public void SegmentStartAndEndComeFromSamples()
        {
            TrackSegment segment = new TrackSegment { Index = 2, Body = "Kerbin" };
            segment.Samples.Add(Sample(200.0, 0));
            segment.Samples.Add(Sample(205.5, 0));

            using JsonDocument doc = JsonDocument.Parse(SessionSerializer.WriteSegment(segment));
            Assert.Equal(200.0, doc.RootElement.GetProperty("startUt").GetDouble());
            Assert.Equal(205.5, doc.RootElement.GetProperty("endUt").GetDouble());
        }

        [Fact]
        public void ResourcesAreOmittedWhenNotMeasured()
        {
            TrackSegment segment = new TrackSegment { Index = 0, Body = "Kerbin", IncludeResources = true };
            segment.Samples.Add(new VesselSample { T = 1, Attitude = Quatd.Identity });

            using JsonDocument doc = JsonDocument.Parse(SessionSerializer.WriteSegment(segment));
            JsonElement samples = doc.RootElement.GetProperty("samples");
            Assert.False(samples.TryGetProperty("lf", out _));
        }

        [Fact]
        public void PositionOnlySegmentsOmitTelemetryColumns()
        {
            TrackSegment segment = new TrackSegment
            {
                Index = 0,
                Kind = SegmentKinds.Flight,
                Body = "Kerbin",
                IncludeResources = true,
                PositionOnly = true
            };
            segment.Samples.Add(VesselSample.PositionOnly(
                100.0, 1.5, -74.5, 70000, Quatd.Identity, "ORBITING"));

            using JsonDocument doc = JsonDocument.Parse(SessionSerializer.WriteSegment(segment));
            JsonElement samples = doc.RootElement.GetProperty("samples");

            foreach (string column in new[] { "t", "lat", "lon", "alt", "q", "situation" })
            {
                Assert.True(samples.TryGetProperty(column, out _), column);
            }

            foreach (string column in new[] { "vx", "vy", "vz", "throttle", "mass", "g",
                                              "stage", "hdg", "vs", "srfSpeed",
                                              "lf", "ox", "ec", "mp" })
            {
                Assert.False(samples.TryGetProperty(column, out _), column);
            }
        }

        [Fact]
        public void ManifestContainsFormatAndTracks()
        {
            SessionInfo session = new SessionInfo
            {
                Id = "20261103T120000Z-abc123",
                Name = "Test",
                SaveName = "MNCS",
                KspVersion = "1.12.5.3190",
                StartUt = 100,
                EndUt = 200
            };
            VesselInfo vessel = new VesselInfo
            {
                Id = "0f8fad5b-d9cb-469f-a165-70867728950e",
                Name = "F-16",
                Type = "Plane",
                Body = "Kerbin",
                Color = "#4fc3f7",
                PartCount = 42,
                CrewCount = 1
            };

            using JsonDocument doc = JsonDocument.Parse(
                SessionSerializer.WriteManifest(session, new List<VesselInfo> { vessel }));
            JsonElement root = doc.RootElement;

            Assert.Equal("kerbtac", root.GetProperty("format").GetString());
            Assert.Equal(1, root.GetProperty("formatVersion").GetInt32());
            Assert.Equal("1.12.5.3190", root.GetProperty("game").GetProperty("kspVersion").GetString());
            Assert.Equal(100.0, root.GetProperty("session").GetProperty("startUt").GetDouble());
            Assert.Equal(100.0, root.GetProperty("session").GetProperty("duration").GetDouble());

            JsonElement v = root.GetProperty("vessels")[0];
            Assert.Equal("vessels/0f8fad5b-d9cb-469f-a165-70867728950e.json", v.GetProperty("track").GetString());
            Assert.Equal(JsonValueKind.Null, v.GetProperty("team").ValueKind);
        }

        [Fact]
        public void BodiesWriteRotationAndOrbit()
        {
            Dictionary<string, BodyDef> bodies = new Dictionary<string, BodyDef>
            {
                ["Kerbin"] = new BodyDef
                {
                    Name = "Kerbin",
                    Parent = null,
                    Radius = 600000,
                    GravParameter = 3.5316e12,
                    AtmosphereDepth = 70000,
                    SphereOfInfluence = 84159286,
                    Rotation = new BodyRotationDef { EpochUt = 100, RateDegPerSec = 0.0167083333 },
                    Style = "kerbin"
                }
            };

            using JsonDocument doc = JsonDocument.Parse(SessionSerializer.WriteBodies(bodies));
            JsonElement kerbin = doc.RootElement.GetProperty("Kerbin");

            Assert.Equal(600000, kerbin.GetProperty("radius").GetDouble());
            Assert.Equal(JsonValueKind.Null, kerbin.GetProperty("parent").ValueKind);
            Assert.Equal(3, kerbin.GetProperty("rotation").GetProperty("axis").GetArrayLength());
            Assert.Equal(4, kerbin.GetProperty("rotation").GetProperty("q0").GetArrayLength());
            Assert.Equal("kerbin", kerbin.GetProperty("style").GetString());
        }

        [Fact]
        public void EventsWriteTypedData()
        {
            List<KerbTacEvent> events = new List<KerbTacEvent>
            {
                new KerbTacEvent { Ut = 10, Type = EventTypes.FlightStart, VesselId = "abc" }
                    .WithData("reason", JsonValue.Str("auto")),
                new KerbTacEvent { Ut = 20, Type = EventTypes.Takeoff }
                    .WithPosition("Kerbin", 1.5, 2.5, 70)
                    .WithData("speed", JsonValue.Num(85.3))
            };

            using JsonDocument doc = JsonDocument.Parse(SessionSerializer.WriteEvents(events));
            JsonElement first = doc.RootElement[0];
            JsonElement second = doc.RootElement[1];

            Assert.Equal("flight_start", first.GetProperty("type").GetString());
            Assert.Equal("auto", first.GetProperty("data").GetProperty("reason").GetString());
            Assert.Equal(JsonValueKind.Null, first.GetProperty("target").ValueKind);
            Assert.Equal(85.3, second.GetProperty("data").GetProperty("speed").GetDouble());
            Assert.Equal(1.5, second.GetProperty("lat").GetDouble());
        }

        [Fact]
        public void VesselDocumentAssemblesPreSerializedSegments()
        {
            VesselInfo vessel = new VesselInfo { Id = "id1", Name = "Plane", Body = "Kerbin" };
            List<string> segments = new List<string>
            {
                "{\"index\":0,\"kind\":\"flight\",\"body\":\"Kerbin\",\"startUt\":1,\"endUt\":2,\"samples\":{\"t\":[1,2]}}",
                "{\"index\":1,\"kind\":\"static\",\"body\":\"Kerbin\",\"startUt\":3,\"endUt\":3,\"samples\":{\"t\":[3]}}"
            };

            using JsonDocument doc = JsonDocument.Parse(SessionSerializer.WriteVessel(vessel, segments));
            Assert.Equal("id1", doc.RootElement.GetProperty("id").GetString());
            Assert.Equal(2, doc.RootElement.GetProperty("segments").GetArrayLength());
            Assert.Equal(3.0, doc.RootElement.GetProperty("segments")[1].GetProperty("startUt").GetDouble());
        }
    }
}
