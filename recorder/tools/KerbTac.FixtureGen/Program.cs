using System;
using System.Collections.Generic;
using System.IO;
using KerbTac.Core;

namespace KerbTac.FixtureGen
{
    /// <summary>
    /// Generates a deterministic current-revision archive through the real Core
    /// writer. Used to keep the player's TypeScript reader honest against the
    /// C# side.
    /// </summary>
    internal static class Program
    {
        private const string BlueVesselId = "6f1d9a3c-2b4e-4c8a-9d10-7e5f3a2b1c00";
        private const string RedVesselId = "2a4c6e80-1b3d-4f5a-8c9e-0d1f2a3b4c5d";
        private const string ActorId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
        private const string BodyName = "Kerbin";
        private const double BodyRadius = 600000.0;
        private const double Lat0 = -0.0972;
        private const double Lon0 = -74.5577;
        private const double CruiseAltitude = 300.0;
        private const double TurnRadius = 1500.0;
        private const double Speed = 150.0;
        private const double StartUt = 1000.0;
        private const double Duration = 60.0;
        private const double Step = 0.1;

        private static int Main(string[] args)
        {
            string output = args.Length > 0 ? args[0] : "recorder-fixture.kerbtac";
            string fullOutput = Path.GetFullPath(output);

            try
            {
                SessionInfo session = BuildSession();
                VesselInfo blue = BuildVessel(BlueVesselId, "Falcon 1", "blue", "air/fixedwing", 0.0);
                VesselInfo red = BuildVessel(RedVesselId, "Viper 2", "red", "air/fixedwing", 0.0015);
                List<VesselInfo> vessels = new List<VesselInfo> { blue, red };
                Dictionary<string, BodyDef> bodies = BuildBodies();
                List<KerbTacEvent> events = BuildEvents();
                List<ActorInfo> actors = BuildActors();

                SplitSparseChunks(blue);
                Dictionary<string, IList<string>> segments = new Dictionary<string, IList<string>>();
                for (int i = 0; i < vessels.Count; i++)
                {
                    VesselInfo vessel = vessels[i];
                    segments[vessel.Id] = vessel.Segments.ConvertAll(SessionSerializer.WriteSegment);
                }

                List<EffectInfo> effects = new List<EffectInfo>
                {
                    new EffectInfo
                    {
                        Ut = StartUt + 30.0,
                        Kind = "chaff",
                        Body = BodyName,
                        SourceId = BlueVesselId,
                        Lat = Lat0,
                        Lon = Lon0,
                        Alt = CruiseAltitude,
                        Count = 12,
                        Seed = 4242,
                        Life = 2.5
                    }
                };

                List<RadarLockInfo> locks = new List<RadarLockInfo>
                {
                    new RadarLockInfo
                    {
                        SourceId = BlueVesselId,
                        TargetId = RedVesselId,
                        Sensor = "radar",
                        Mode = "stt",
                        StartUt = StartUt + 28.0,
                        EndUt = StartUt + 34.0
                    }
                };

                SummaryInfo summary = SummaryBuilder.Build(session, vessels, events, actors, bodies);

                string tempDir = Path.Combine(Path.GetTempPath(), "kerbtac-fixture-" + Guid.NewGuid().ToString("N"));
                try
                {
                    RecordingArchive.Create(
                        tempDir,
                        fullOutput,
                        session,
                        vessels,
                        bodies,
                        events,
                        segments,
                        actors,
                        effects,
                        locks,
                        summary);
                }
                finally
                {
                    if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
                }

                FileInfo info = new FileInfo(fullOutput);
                Console.WriteLine("Wrote " + fullOutput + " (" + info.Length + " bytes, " +
                                  SessionSerializer.TrackPath(blue.Id) + ", " +
                                  events.Count + " events)");
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex);
                return 1;
            }
        }

        private static void SplitSparseChunks(VesselInfo vessel)
        {
            TrackSegment original = vessel.Segments[0];
            vessel.Segments.Clear();
            int[] offsets = { 0, 2, 4, 6, original.Samples.Count };
            for (int chunk = 0; chunk < offsets.Length - 1; chunk++)
            {
                TrackSegment segment = new TrackSegment
                {
                    Index = chunk,
                    LogicalIndex = original.LogicalIndex,
                    ChunkIndex = chunk,
                    Kind = original.Kind,
                    Body = original.Body,
                    Source = original.Source
                };
                for (int i = offsets[chunk]; i < offsets[chunk + 1]; i++)
                {
                    VesselSample sample = original.Samples[i];
                    sample.Stage = i == 0 ? 0 : i == 1 ? 2 : i >= 6 ? 4 : (int?)null;
                    sample.PitchInput = i == 0 ? 0 : i == 1 ? 0.25 : i >= 6 ? -0.5 : (double?)null;
                    sample.Health = i == 0 ? 0 : i >= 6 ? 0.75 : (double?)null;
                    sample.Brakes = i == 0 ? 0 : (double?)null;
                    sample.LiquidFuel = i == 0 ? 0 : i >= 6 ? 100 : (double?)null;
                    sample.Oxidizer = null;
                    segment.Samples.Add(sample);
                }
                vessel.Segments.Add(segment);
            }
        }

        private static SessionInfo BuildSession()
        {
            SessionInfo session = new SessionInfo
            {
                Id = "20261103T120000Z-rec001",
                Name = "BVR 2v2",
                SaveName = "MNCS_Fixture",
                Scene = "FLIGHT",
                KspVersion = "1.12.5.3190",
                UnityVersion = "2019.4.18f1",
                StartUt = StartUt,
                EndUt = StartUt + Duration,
                StartWallUtc = new DateTime(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc),
                EndWallUtc = new DateTime(2026, 11, 3, 12, 1, 0, DateTimeKind.Utc),
                GeneratorName = "KerbTac Recorder",
                GeneratorVersion = "0.1.0",
                Ut0 = StartUt
            };
            session.Mission = new MissionInfo
            {
                Title = "BVR 2v2",
                Category = "combat",
                Briefing = "Two flights meet over the mountains.",
                Theater = "Kerbin",
                Author = "MNCS",
                Tags = new List<string> { "bvr", "training" }
            };
            session.Gaps.Add(new SessionGap
            {
                StartUt = StartUt + 20.2,
                EndUt = StartUt + 20.5,
                Reason = "pause"
            });
            session.Chapters.Add(new ChapterInfo
            {
                Id = "merge",
                Name = "Merge",
                StartUt = StartUt + 25.0,
                EndUt = StartUt + 40.0,
                Reason = "manual"
            });
            return session;
        }

        private static VesselInfo BuildVessel(
            string id, string name, string side, string kind, double latOffset)
        {
            VesselInfo vessel = new VesselInfo
            {
                Id = id,
                Name = name,
                Type = "Plane",
                Body = BodyName,
                Color = side == "blue" ? "#4fc3f7" : "#ff5f6d",
                RootPart = "mk1Cockpit",
                PartCount = 24,
                CrewCount = 1,
                Side = side,
                Callsign = name,
                Kind = kind,
                Health = 1.0
            };
            vessel.Loadout.Add("AIM-120");
            vessel.Segments.Add(BuildSegment(latOffset));
            return vessel;
        }

        private static TrackSegment BuildSegment(double latOffset)
        {
            TrackSegment segment = new TrackSegment
            {
                Index = 0,
                Kind = SegmentKinds.Flight,
                Body = BodyName,
                Source = "active",
                IncludeResources = true
            };

            int count = (int)Math.Round(Duration / Step) + 1;
            for (int i = 0; i < count; i++)
            {
                double t = StartUt + i * Step;
                double elapsed = i * Step;
                double theta = Speed * elapsed / TurnRadius;

                double north = TurnRadius * Math.Sin(theta);
                double east = TurnRadius * (1.0 - Math.Cos(theta));
                double lat = Lat0 + latOffset + north / BodyRadius * (180.0 / Math.PI);
                double lon = Lon0 + east / (BodyRadius * Math.Cos(Lat0 * Math.PI / 180.0)) * (180.0 / Math.PI);
                double alt = CruiseAltitude;

                Vec3d up = Bf(lat, lon, alt).Normalized();
                Vec3d eastDir = new Vec3d(
                    -Math.Sin(Lon0 * Math.PI / 180.0),
                    0.0,
                    Math.Cos(Lon0 * Math.PI / 180.0));
                Vec3d northDir = new Vec3d(
                    -Math.Sin(Lat0 * Math.PI / 180.0) * Math.Cos(Lon0 * Math.PI / 180.0),
                    Math.Cos(Lat0 * Math.PI / 180.0),
                    -Math.Sin(Lat0 * Math.PI / 180.0) * Math.Sin(Lon0 * Math.PI / 180.0));
                Vec3d forward = (eastDir * Math.Sin(theta) + northDir * Math.Cos(theta)).Normalized();
                Quatd attitude = Quatd.FromForwardUp(forward, up);

                segment.Samples.Add(new VesselSample
                {
                    T = t,
                    Latitude = lat,
                    Longitude = lon,
                    Altitude = alt,
                    Attitude = attitude,
                    VelocityX = forward.X * Speed,
                    VelocityY = forward.Y * Speed,
                    VelocityZ = forward.Z * Speed,
                    Throttle = 0.62f,
                    Mass = 11800.0 - elapsed * 4.0,
                    GeeForce = 1.02 + (i > 280 && i < 300 ? 4.0 : 0.0),
                    Stage = 0,
                    Situation = "FLYING",
                    Heading = attitude.HeadingDegrees(lat, lon),
                    VerticalSpeed = 0.0,
                    SurfaceSpeed = Speed,
                    LiquidFuel = 780.0 - elapsed * 2.0,
                    Oxidizer = 960.0 - elapsed * 2.2,
                    ElectricCharge = 480.0,
                    MonoPropellant = 18.0,
                    Ias = Speed,
                    Mach = 0.5,
                    Agl = alt,
                    DynPressure = 20.0,
                    Health = 1.0
                });
            }

            return segment;
        }

        private static List<ActorInfo> BuildActors()
        {
            ActorInfo actor = new ActorInfo
            {
                Id = ActorId,
                Name = "AIM-120",
                Kind = "weapon/missile",
                Side = "blue",
                ParentId = BlueVesselId,
                TargetId = RedVesselId,
                Weapon = "AIM-120",
                Body = BodyName,
                StartUt = StartUt + 28.0,
                EndUt = StartUt + 30.0
            };

            for (int i = 0; i < 21; i++)
            {
                double t = StartUt + 28.0 + i * 0.1;
                double elapsed = 28.0 + i * 0.1;
                double theta = Speed * elapsed / TurnRadius;
                double north = TurnRadius * Math.Sin(theta);
                double east = TurnRadius * (1.0 - Math.Cos(theta));
                double lat = Lat0 + north / BodyRadius * (180.0 / Math.PI);
                double lon = Lon0 + east / (BodyRadius * Math.Cos(Lat0 * Math.PI / 180.0)) * (180.0 / Math.PI);
                actor.Samples.Add(new VesselSample
                {
                    T = t,
                    Latitude = lat,
                    Longitude = lon,
                    Altitude = CruiseAltitude,
                    Attitude = Quatd.Identity,
                    VelocityX = 0,
                    VelocityY = 0,
                    VelocityZ = 300.0,
                    SurfaceSpeed = 300.0,
                    Situation = "FLYING"
                });
            }

            return new List<ActorInfo> { actor };
        }

        private static Vec3d Bf(double latDeg, double lonDeg, double alt)
        {
            double lat = latDeg * Math.PI / 180.0;
            double lon = lonDeg * Math.PI / 180.0;
            double r = BodyRadius + alt;
            return new Vec3d(
                r * Math.Cos(lat) * Math.Cos(lon),
                r * Math.Sin(lat),
                r * Math.Cos(lat) * Math.Sin(lon));
        }

        private static Dictionary<string, BodyDef> BuildBodies()
        {
            BodyDef kerbin = new BodyDef
            {
                Name = BodyName,
                Parent = null,
                Radius = BodyRadius,
                GravParameter = 3.5316e12,
                AtmosphereDepth = 70000.0,
                SphereOfInfluence = 84159286.0,
                Style = "kerbin",
                Rotation = new BodyRotationDef
                {
                    EpochUt = StartUt,
                    Q0 = new[] { 0.0, 0.0, 0.0, 1.0 },
                    Axis = new[] { 0.0, 1.0, 0.0 },
                    RateDegPerSec = 360.0 / 21600.0
                }
            };

            return new Dictionary<string, BodyDef> { { BodyName, kerbin } };
        }

        private static List<KerbTacEvent> BuildEvents()
        {
            List<KerbTacEvent> events = new List<KerbTacEvent>();

            events.Add(new KerbTacEvent
            {
                Ut = StartUt,
                Type = EventTypes.FlightStart,
                VesselId = BlueVesselId,
                Body = BodyName,
                HasPosition = true,
                Latitude = Lat0,
                Longitude = Lon0,
                Altitude = CruiseAltitude
            }.WithData("reason", JsonValue.Str("manual")));

            events.Add(EventAt(EventTypes.Takeoff, 5.0, BlueVesselId).WithData("speed", JsonValue.Num(Speed)));
            events.Add(EventAt(EventTypes.GearUp, 6.0, BlueVesselId).WithData("part", JsonValue.Str("Gear")));
            events.Add(EventAt(EventTypes.WeaponRelease, 28.0, BlueVesselId)
                .WithTarget(RedVesselId)
                .WithSource(BlueVesselId)
                .WithWeapon("AIM-120")
                .WithOutcome("launched")
                .WithRange(8000));
            events.Add(EventAt(EventTypes.Hit, 30.0, RedVesselId)
                .WithTarget(RedVesselId)
                .WithSource(BlueVesselId)
                .WithWeapon("AIM-120")
                .WithOutcome("hit")
                .WithDamage(0.55));
            events.Add(EventAt(EventTypes.Kill, 30.5, RedVesselId)
                .WithTarget(RedVesselId)
                .WithSource(BlueVesselId)
                .WithWeapon("AIM-120")
                .WithOutcome("kill"));
            events.Add(EventAt(EventTypes.Stage, 20.0, BlueVesselId).WithData("stage", JsonValue.Num(0)));
            events.Add(EventAt(EventTypes.GearDown, 45.0, BlueVesselId).WithData("part", JsonValue.Str("Gear")));
            events.Add(EventAt(EventTypes.Touchdown, 55.0, BlueVesselId)
                .WithData("verticalSpeed", JsonValue.Num(-1.2))
                .WithData("speed", JsonValue.Num(62.0)));
            events.Add(EventAt(EventTypes.Landing, 58.0, BlueVesselId).WithData("speed", JsonValue.Num(0.4)));

            events.Add(new KerbTacEvent
            {
                Ut = StartUt + Duration,
                Type = EventTypes.FlightEnd,
                VesselId = BlueVesselId,
                Body = BodyName,
                HasPosition = true,
                Latitude = Lat0,
                Longitude = Lon0,
                Altitude = CruiseAltitude
            }
                .WithData("reason", JsonValue.Str("manual"))
                .WithData("duration", JsonValue.Num(Duration)));

            return events;
        }

        private static KerbTacEvent EventAt(string type, double elapsed, string vesselId)
        {
            double theta = Speed * elapsed / TurnRadius;
            double north = TurnRadius * Math.Sin(theta);
            double east = TurnRadius * (1.0 - Math.Cos(theta));
            double lat = Lat0 + north / BodyRadius * (180.0 / Math.PI);
            double lon = Lon0 + east / (BodyRadius * Math.Cos(Lat0 * Math.PI / 180.0)) * (180.0 / Math.PI);

            return new KerbTacEvent
            {
                Ut = StartUt + elapsed,
                Type = type,
                VesselId = vesselId,
                Body = BodyName,
                HasPosition = true,
                Latitude = lat,
                Longitude = lon,
                Altitude = CruiseAltitude
            };
        }
    }
}
