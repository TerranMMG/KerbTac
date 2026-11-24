using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace KerbTac.Core
{
    /// <summary>
    /// Writes a tiny, self-contained .kerbtac archive. The in-game button uses
    /// this to prove that file IO, JSON and ZIP compression work on the actual
    /// Mono runtime before the first flight is recorded.
    /// </summary>
    public static class SelfTestRecording
    {
        public const double StartUt = 1000.0;
        public const int SampleCount = 21;
        public const double SampleInterval = 0.1;

        public static string Write(string directory, DateTime utcNow, string kspVersion, string unityVersion = null)
        {
            if (string.IsNullOrEmpty(directory))
            {
                throw new ArgumentException("A recordings directory is required.", "directory");
            }

            Directory.CreateDirectory(directory);

            string sessionId = SessionInfo.NewId(utcNow);
            string vesselId = Guid.NewGuid().ToString();
            double endUt = StartUt + (SampleCount - 1) * SampleInterval;

            SessionInfo session = new SessionInfo
            {
                Id = sessionId,
                Name = "KerbTac Self Test",
                SaveName = "selftest",
                Scene = "FLIGHT",
                KspVersion = string.IsNullOrEmpty(kspVersion) ? "unknown" : kspVersion,
                UnityVersion = string.IsNullOrEmpty(unityVersion) ? "unknown" : unityVersion,
                StartUt = StartUt,
                EndUt = endUt,
                StartWallUtc = utcNow,
                EndWallUtc = utcNow,
                Ut0 = StartUt
            };
            session.Mission = new MissionInfo
            {
                Title = "KerbTac Self Test",
                Category = "selftest",
                Briefing = "Verifies the v1.1 writer on the live KSP runtime.",
                Theater = "Kerbin",
                Author = "KerbTac",
                Tags = new List<string> { "selftest", "v1.1" }
            };

            VesselInfo vessel = new VesselInfo
            {
                Id = vesselId,
                Name = "Self Test Probe",
                Type = "Probe",
                Body = "Kerbin",
                Color = "#4fc3f7",
                RootPart = "probeCoreCube",
                PartCount = 1,
                CrewCount = 0
            };

            TrackSegment segment = new TrackSegment
            {
                Index = 0,
                Kind = SegmentKinds.Flight,
                Body = "Kerbin",
                Source = "selftest",
                IncludeResources = true
            };

            for (int i = 0; i < SampleCount; i++)
            {
                double t = StartUt + i * SampleInterval;
                segment.Samples.Add(new VesselSample
                {
                    T = t,
                    Latitude = -0.0972 + i * 0.00001,
                    Longitude = -74.5577 + i * 0.00002,
                    Altitude = 70.0 + i,
                    Attitude = Quatd.Identity,
                    VelocityX = 0.0,
                    VelocityY = 0.0,
                    VelocityZ = 80.0,
                    Throttle = i < 10 ? 0.6f : 0.0f,
                    Mass = 1200.0 - i * 2.0,
                    GeeForce = 1.0,
                    Stage = 1,
                    Situation = i < 10 ? "LANDED" : "FLYING",
                    Heading = 90.0,
                    VerticalSpeed = i < 10 ? 0.0 : 2.0,
                    SurfaceSpeed = i * 4.0,
                    LiquidFuel = 90.0 - i,
                    Oxidizer = 45.0 - i * 0.5,
                    ElectricCharge = 500.0,
                    MonoPropellant = 5.0
                });
            }
            vessel.Segments.Add(segment);

            VesselInfo red = new VesselInfo
            {
                Id = Guid.NewGuid().ToString(),
                Name = "Self Test Target",
                Type = "Probe",
                Body = "Kerbin",
                Color = "#ff5f6d",
                RootPart = "probeCoreCube",
                PartCount = 1,
                CrewCount = 0,
                Side = "red",
                Kind = "target",
                Callsign = "Target 1"
            };
            TrackSegment redSegment = new TrackSegment
            {
                Index = 1,
                Kind = SegmentKinds.Flight,
                Body = "Kerbin",
                Source = "loaded",
                IncludeResources = true
            };
            for (int i = 0; i < segment.Samples.Count; i++)
            {
                VesselSample copy = segment.Samples[i];
                copy.Latitude += 0.001;
                redSegment.Samples.Add(copy);
            }
            red.Segments.Add(redSegment);

            List<KerbTacEvent> events = new List<KerbTacEvent>
            {
                new KerbTacEvent
                {
                    Ut = StartUt,
                    Type = EventTypes.FlightStart,
                    VesselId = vesselId,
                    Body = "Kerbin",
                    HasPosition = true,
                    Latitude = -0.0972,
                    Longitude = -74.5577,
                    Altitude = 70.0
                }.WithData("reason", JsonValue.Str("selftest")),
                new KerbTacEvent
                {
                    Ut = StartUt + 1.0,
                    Type = EventTypes.Takeoff,
                    VesselId = vesselId,
                    Body = "Kerbin",
                    HasPosition = true,
                    Latitude = -0.0972,
                    Longitude = -74.5577,
                    Altitude = 70.0
                }.WithData("speed", JsonValue.Num(80.0)),
                new KerbTacEvent
                {
                    Ut = endUt,
                    Type = EventTypes.FlightEnd,
                    VesselId = vesselId,
                    Body = "Kerbin",
                    HasPosition = true,
                    Latitude = -0.0972,
                    Longitude = -74.5577,
                    Altitude = 90.0
                }.WithData("reason", JsonValue.Str("selftest"))
                 .WithData("duration", JsonValue.Num(endUt - StartUt)),
                new KerbTacEvent
                {
                    Ut = StartUt + 0.2,
                    Type = EventTypes.WeaponRelease,
                    VesselId = vesselId,
                    SourceId = vesselId,
                    TargetId = red.Id,
                    Weapon = "AIM-120",
                    Outcome = "launched",
                    Range = 8000.0,
                    Body = "Kerbin",
                    HasPosition = true,
                    Latitude = -0.0972,
                    Longitude = -74.5577,
                    Altitude = 70.0
                },
                new KerbTacEvent
                {
                    Ut = StartUt + 0.4,
                    Type = EventTypes.Hit,
                    VesselId = red.Id,
                    SourceId = vesselId,
                    TargetId = red.Id,
                    Weapon = "AIM-120",
                    Outcome = "hit",
                    Damage = 0.55,
                    Body = "Kerbin",
                    HasPosition = true,
                    Latitude = -0.0962,
                    Longitude = -74.5577,
                    Altitude = 70.0
                },
                new KerbTacEvent
                {
                    Ut = StartUt + 0.5,
                    Type = EventTypes.Kill,
                    VesselId = red.Id,
                    SourceId = vesselId,
                    TargetId = red.Id,
                    Weapon = "AIM-120",
                    Outcome = "kill",
                    Body = "Kerbin",
                    HasPosition = true,
                    Latitude = -0.0962,
                    Longitude = -74.5577,
                    Altitude = 70.0
                }
            };

            Dictionary<string, BodyDef> bodies = new Dictionary<string, BodyDef>
            {
                {
                    "Kerbin",
                    new BodyDef
                    {
                        Name = "Kerbin",
                        Radius = 600000.0,
                        GravParameter = 3.5316e12,
                        AtmosphereDepth = 70000.0,
                        SphereOfInfluence = 84159286.0,
                        Rotation = new BodyRotationDef
                        {
                            EpochUt = 0.0,
                            Q0 = new[] { 0.0, 0.0, 0.0, 1.0 },
                            Axis = new[] { 0.0, 1.0, 0.0 },
                            RateDegPerSec = 360.0 / 21600.0
                        },
                        Style = "kerbin"
                    }
                }
            };

            ActorInfo actor = new ActorInfo
            {
                Id = Guid.NewGuid().ToString(),
                Name = "AIM-120",
                Kind = "weapon/missile",
                Side = "blue",
                ParentId = vesselId,
                TargetId = red.Id,
                Weapon = "AIM-120",
                Body = "Kerbin",
                StartUt = StartUt + 0.2,
                EndUt = StartUt + 0.6
            };
            for (int i = 0; i < 5; i++)
            {
                actor.Samples.Add(new VesselSample
                {
                    T = StartUt + 0.2 + i * 0.1,
                    Latitude = -0.0972,
                    Longitude = -74.5577,
                    Altitude = 70.0,
                    Attitude = Quatd.Identity,
                    VelocityZ = 300.0,
                    SurfaceSpeed = 300.0,
                    Situation = "FLYING"
                });
            }

            List<EffectInfo> effects = new List<EffectInfo>
            {
                new EffectInfo
                {
                    Ut = StartUt + 0.3,
                    Kind = "chaff",
                    Body = "Kerbin",
                    SourceId = vesselId,
                    Lat = -0.0972,
                    Lon = -74.5577,
                    Alt = 70.0,
                    Count = 8,
                    Seed = 7,
                    Life = 2.0
                }
            };
            List<RadarLockInfo> locks = new List<RadarLockInfo>
            {
                new RadarLockInfo
                {
                    SourceId = vesselId,
                    TargetId = red.Id,
                    Sensor = "radar",
                    Mode = "stt",
                    StartUt = StartUt + 0.2,
                    EndUt = StartUt + 0.6
                }
            };
            SummaryInfo summary = SummaryBuilder.Build(
                session,
                new List<VesselInfo> { vessel, red },
                events,
                new List<ActorInfo> { actor },
                bodies);

            Dictionary<string, IList<string>> segments = new Dictionary<string, IList<string>>
            {
                { vesselId, new List<string> { SessionSerializer.WriteSegment(segment) } },
                { red.Id, new List<string> { SessionSerializer.WriteSegment(redSegment) } }
            };

            string stamp = utcNow.ToUniversalTime()
                .ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            string outputPath = FileNameUtil.EnsureUnique(directory, "selftest_" + stamp + ".kerbtac");
            string tempDir = Path.Combine(directory, ".tmp_" + sessionId);

            try
            {
                RecordingArchive.Create(
                    tempDir,
                    outputPath,
                    session,
                    new List<VesselInfo> { vessel, red },
                    bodies,
                    events,
                    segments,
                    new List<ActorInfo> { actor },
                    effects,
                    locks,
                    summary);
            }
            finally
            {
                try
                {
                    if (Directory.Exists(tempDir))
                    {
                        Directory.Delete(tempDir, true);
                    }
                }
                catch (IOException)
                {
                    // A leftover temp directory is harmless and cleaned up on the next run.
                }
            }

            return outputPath;
        }
    }
}
