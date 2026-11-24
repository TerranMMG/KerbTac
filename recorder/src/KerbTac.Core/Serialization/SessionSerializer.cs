using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace KerbTac.Core
{
    /// <summary>
    /// Serializes session data into the JSON documents defined by
    /// docs/format-v1.md. No KSP dependency: the plugin passes plain models.
    /// </summary>
    public static class SessionSerializer
    {
        public static string WriteManifest(
            SessionInfo session,
            IList<VesselInfo> vessels,
            bool hasActors = false,
            bool hasEffects = false,
            bool hasLocks = false,
            bool hasSummary = false)
        {
            JsonWriter w = new JsonWriter(2048);
            w.BeginObject();
            w.Prop("format", KerbTacVersion.FormatName);
            w.Prop("formatVersion", KerbTacVersion.FormatVersion);
            w.Prop("formatRevision", KerbTacVersion.FormatRevision);

            w.Name("generator").BeginObject()
                .Prop("name", session.GeneratorName)
                .Prop("version", session.GeneratorVersion)
                .EndObject();

            w.Name("game").BeginObject()
                .Prop("kspVersion", session.KspVersion ?? "unknown");
            if (!string.IsNullOrEmpty(session.UnityVersion))
            {
                w.Prop("unityVersion", session.UnityVersion);
            }
            if (session.SaveName != null)
            {
                w.Prop("saveName", session.SaveName);
            }
            w.Prop("scene", session.Scene ?? "FLIGHT");
            w.EndObject();

            if (session.Mission != null)
            {
                WriteMission(w, session.Mission);
            }

            w.Name("session").BeginObject()
                .Prop("id", session.Id)
                .Prop("name", session.Name)
                .Prop("startUt", session.StartUt)
                .Prop("endUt", session.EndUt);
            if (!string.IsNullOrEmpty(session.RecordingMode))
            {
                w.Prop("recordingMode", session.RecordingMode);
            }
            if (session.Ut0 != 0.0)
            {
                w.Prop("ut0", session.Ut0);
            }
            w.Prop("startWall", SessionInfo.FormatIsoUtc(session.StartWallUtc))
                .Prop("endWall", SessionInfo.FormatIsoUtc(session.EndWallUtc))
                .Prop("duration", session.Duration);

            if (session.Gaps != null && session.Gaps.Count > 0)
            {
                w.Name("gaps").BeginArray();
                for (int i = 0; i < session.Gaps.Count; i++)
                {
                    SessionGap gap = session.Gaps[i];
                    w.BeginObject()
                        .Prop("startUt", gap.StartUt)
                        .Prop("endUt", gap.EndUt)
                        .Prop("reason", gap.Reason ?? "unknown")
                        .EndObject();
                }
                w.EndArray();
            }

            if (session.Chapters != null && session.Chapters.Count > 0)
            {
                w.Name("chapters").BeginArray();
                for (int i = 0; i < session.Chapters.Count; i++)
                {
                    ChapterInfo chapter = session.Chapters[i];
                    w.BeginObject()
                        .Prop("id", chapter.Id)
                        .Prop("name", chapter.Name)
                        .Prop("startUt", chapter.StartUt)
                        .Prop("endUt", chapter.EndUt)
                        .Prop("reason", chapter.Reason ?? "manual")
                        .EndObject();
                }
                w.EndArray();
            }
            w.EndObject();

            w.Prop("bodies", "bodies.json");
            w.Prop("events", "events.json");
            if (hasActors) w.Prop("actors", "actors.json");
            if (hasEffects) w.Prop("effects", "effects.json");
            if (hasLocks) w.Prop("locks", "locks.json");
            if (hasSummary) w.Prop("summary", "summary.json");

            w.Name("vessels").BeginArray();
            for (int i = 0; i < vessels.Count; i++)
            {
                VesselInfo v = vessels[i];
                w.BeginObject()
                    .Prop("id", v.Id)
                    .Prop("name", v.Name)
                    .Prop("type", v.Type)
                    .Prop("body", v.Body)
                    .Prop("color", v.Color);
                if (v.Team == null)
                {
                    w.PropNull("team");
                }
                else
                {
                    w.Prop("team", v.Team);
                }
                if (!string.IsNullOrEmpty(v.RootPart))
                {
                    w.Prop("rootPart", v.RootPart);
                }
                if (!string.IsNullOrEmpty(v.Callsign))
                {
                    w.Prop("callsign", v.Callsign);
                }
                if (v.Side != null && v.Side != "neutral")
                {
                    w.Prop("side", v.Side);
                }
                if (v.Kind != null && v.Kind != "unknown")
                {
                    w.Prop("kind", v.Kind);
                }
                WriteVesselExtras(w, v);
                if (v.Health != 1.0)
                {
                    w.Prop("health", v.Health);
                }
                if (v.Loadout != null && v.Loadout.Count > 0)
                {
                    w.Name("loadout").BeginArray();
                    for (int l = 0; l < v.Loadout.Count; l++) w.Value(v.Loadout[l]);
                    w.EndArray();
                }
                w.Prop("partCount", v.PartCount)
                    .Prop("crewCount", v.CrewCount)
                    .Prop("track", TrackPath(v.Id))
                    .EndObject();
            }
            w.EndArray();

            w.EndObject();
            return w.ToString();
        }

        /// <summary>
        /// Writes the optional v1.3 vessel fields. They appear in both the
        /// manifest vessel list and vessels/&lt;id&gt;.json so a track document
        /// stays self-describing.
        /// </summary>
        private static void WriteVesselExtras(JsonWriter w, VesselInfo v)
        {
            if (!string.IsNullOrEmpty(v.Role)) w.Prop("role", v.Role);
            if (!string.IsNullOrEmpty(v.ParentId)) w.Prop("parentId", v.ParentId);
            if (v.StageIndex >= 0) w.Prop("stageIndex", v.StageIndex);
            if (v.SeparatedUt.HasValue) w.Prop("separatedUt", v.SeparatedUt.Value);
            if (!string.IsNullOrEmpty(v.ModelRole)) w.Prop("modelRole", v.ModelRole);
            if (v.Threat != null && v.Threat.HasAny)
            {
                w.Name("threat").BeginObject()
                    .Prop("missileRangeM", v.Threat.MissileRangeM)
                    .Prop("radarRangeM", v.Threat.RadarRangeM)
                    .Prop("threatRadiusM", v.Threat.ThreatRadiusM)
                    .EndObject();
            }
        }

        private static void WriteMission(JsonWriter w, MissionInfo mission)        {
            w.Name("mission").BeginObject();
            if (mission.Title != null) w.Prop("title", mission.Title);
            if (mission.Category != null) w.Prop("category", mission.Category);
            if (mission.Briefing != null) w.Prop("briefing", mission.Briefing);
            if (mission.Debriefing != null) w.Prop("debriefing", mission.Debriefing);
            if (mission.Theater != null) w.Prop("theater", mission.Theater);
            if (mission.Author != null) w.Prop("author", mission.Author);
            if (mission.Notes != null) w.Prop("notes", mission.Notes);
            if (mission.Tags != null && mission.Tags.Count > 0)
            {
                w.Name("tags").BeginArray();
                for (int i = 0; i < mission.Tags.Count; i++) w.Value(mission.Tags[i]);
                w.EndArray();
            }
            w.EndObject();
        }

        private static bool HasData(KerbTacEvent e, string name)
        {
            for (int i = 0; i < e.Data.Count; i++)
            {
                if (e.Data[i].Name == name) return true;
            }
            return false;
        }

        public static string TrackPath(string vesselId)
        {
            return "vessels/" + vesselId + ".json";
        }

        public static string WriteActors(IList<ActorInfo> actors)
        {
            JsonWriter w = new JsonWriter(Math.Max(256, actors.Count * 512));
            w.BeginObject().Name("actors").BeginArray();
            for (int i = 0; i < actors.Count; i++)
            {
                ActorInfo a = actors[i];
                w.BeginObject().Prop("id", a.Id);
                if (a.Name != null) w.Prop("name", a.Name);
                if (a.Kind != null) w.Prop("kind", a.Kind);
                if (a.Side != null) w.Prop("side", a.Side);
                if (a.ParentId != null) w.Prop("parent", a.ParentId);
                if (a.TargetId != null) w.Prop("target", a.TargetId);
                if (a.Weapon != null) w.Prop("weapon", a.Weapon);
                if (a.Body != null) w.Prop("body", a.Body);
                w.Prop("startUt", a.Samples.Count > 0 ? a.Samples[0].T : a.StartUt)
                    .Prop("endUt", a.Samples.Count > 0 ? a.Samples[a.Samples.Count - 1].T : a.EndUt)
                    .Name("samples").BeginObject();

                WriteSampleArray(w, "t", a.Samples, delegate(ref VesselSample s) { return s.T; });
                WriteSampleArray(w, "lat", a.Samples, delegate(ref VesselSample s) { return s.Latitude; });
                WriteSampleArray(w, "lon", a.Samples, delegate(ref VesselSample s) { return s.Longitude; });
                WriteSampleArray(w, "alt", a.Samples, delegate(ref VesselSample s) { return s.Altitude; });

                w.Name("q").BeginArray();
                for (int q = 0; q < a.Samples.Count; q++)
                {
                    Quatd quat = a.Samples[q].Attitude;
                    w.Value(quat.X);
                    w.Value(quat.Y);
                    w.Value(quat.Z);
                    w.Value(quat.W);
                }
                w.EndArray();

                WriteOptionalColumn(w, "vx", a.Samples, delegate(ref VesselSample s) { return s.VelocityX; });
                WriteOptionalColumn(w, "vy", a.Samples, delegate(ref VesselSample s) { return s.VelocityY; });
                WriteOptionalColumn(w, "vz", a.Samples, delegate(ref VesselSample s) { return s.VelocityZ; });
                WriteOptionalColumn(w, "agl", a.Samples, delegate(ref VesselSample s) { return s.Agl; });
                WriteOptionalColumn(w, "ias", a.Samples, delegate(ref VesselSample s) { return s.Ias; });
                WriteOptionalColumn(w, "mach", a.Samples, delegate(ref VesselSample s) { return s.Mach; });
                WriteOptionalColumn(w, "aoa", a.Samples, delegate(ref VesselSample s) { return s.Aoa; });
                WriteOptionalColumn(w, "aos", a.Samples, delegate(ref VesselSample s) { return s.Aos; });
                w.EndObject().EndObject();
            }
            w.EndArray().EndObject();
            return w.ToString();
        }

        public static string WriteEffects(IList<EffectInfo> effects)
        {
            JsonWriter w = new JsonWriter(Math.Max(256, effects.Count * 220));
            w.BeginObject().Name("effects").BeginArray();
            for (int i = 0; i < effects.Count; i++)
            {
                EffectInfo e = effects[i];
                w.BeginObject()
                    .Prop("ut", e.Ut)
                    .Prop("kind", e.Kind);
                if (e.Body != null) w.Prop("body", e.Body);
                w.Prop("lat", e.Lat)
                    .Prop("lon", e.Lon)
                    .Prop("alt", e.Alt)
                    .Prop("count", e.Count)
                    .Prop("seed", e.Seed);
                if (e.Vx != 0 || e.Vy != 0 || e.Vz != 0)
                {
                    w.Prop("vx", e.Vx).Prop("vy", e.Vy).Prop("vz", e.Vz);
                }
                if (e.Spread != 0) w.Prop("spread", e.Spread);
                w.Prop("life", e.Life);
                if (e.SourceId == null) w.PropNull("source"); else w.Prop("source", e.SourceId);
                if (e.TargetId == null) w.PropNull("target"); else w.Prop("target", e.TargetId);
                w.EndObject();
            }
            w.EndArray().EndObject();
            return w.ToString();
        }

        public static string WriteLocks(IList<RadarLockInfo> locks)
        {
            JsonWriter w = new JsonWriter(Math.Max(256, locks.Count * 160));
            w.BeginObject().Name("locks").BeginArray();
            for (int i = 0; i < locks.Count; i++)
            {
                RadarLockInfo l = locks[i];
                w.BeginObject()
                    .Prop("source", l.SourceId)
                    .Prop("target", l.TargetId);
                if (l.Sensor != null) w.Prop("sensor", l.Sensor);
                if (l.Mode != null) w.Prop("mode", l.Mode);
                w.Prop("startUt", l.StartUt)
                    .Prop("endUt", l.EndUt)
                    .EndObject();
            }
            w.EndArray().EndObject();
            return w.ToString();
        }

        public static string WriteSummary(SummaryInfo summary)
        {
            JsonWriter w = new JsonWriter(1024);
            w.BeginObject().Name("session").BeginObject();
            SummarySession s = summary.Session ?? new SummarySession();
            w.Prop("duration", s.Duration)
                .Prop("distanceKm", s.DistanceKm)
                .Prop("maxAltitude", s.MaxAltitude)
                .Prop("maxSpeed", s.MaxSpeed)
                .Prop("maxMach", s.MaxMach)
                .Prop("maxG", s.MaxG)
                .EndObject();

            w.Name("vessels").BeginArray();
            if (summary.Vessels != null)
            {
                for (int i = 0; i < summary.Vessels.Count; i++)
                {
                    SummaryVessel v = summary.Vessels[i];
                    w.BeginObject().Prop("id", v.Id);
                    if (v.Name != null) w.Prop("name", v.Name);
                    w.Prop("shots", v.Shots)
                        .Prop("hits", v.Hits)
                        .Prop("kills", v.Kills)
                        .Prop("fuelUsed", v.FuelUsed)
                        .Prop("distanceKm", v.DistanceKm)
                        .EndObject();
                }
            }
            w.EndArray();

            w.Name("sides").BeginObject();
            if (summary.Sides != null)
            {
                foreach (KeyValuePair<string, SummarySide> pair in summary.Sides)
                {
                    w.Name(pair.Key).BeginObject()
                        .Prop("shots", pair.Value.Shots)
                        .Prop("hits", pair.Value.Hits)
                        .Prop("kills", pair.Value.Kills)
                        .EndObject();
                }
            }
            w.EndObject();
            w.EndObject();
            return w.ToString();
        }

        private static void WriteSampleArray(JsonWriter w, string name, IList<VesselSample> samples, SampleSelector selector)
        {
            w.Name(name).BeginArray();
            for (int i = 0; i < samples.Count; i++)
            {
                VesselSample sample = samples[i];
                w.Value(selector(ref sample));
            }
            w.EndArray();
        }

        public static string WriteBodies(IDictionary<string, BodyDef> bodies)
        {
            JsonWriter w = new JsonWriter(4096);
            w.BeginObject();
            foreach (KeyValuePair<string, BodyDef> pair in bodies)
            {
                BodyDef b = pair.Value;
                w.Name(b.Name).BeginObject()
                    .Prop("name", b.Name);
                if (b.Parent == null)
                {
                    w.PropNull("parent");
                }
                else
                {
                    w.Prop("parent", b.Parent);
                }

                w.Prop("radius", b.Radius)
                    .Prop("gravParameter", b.GravParameter)
                    .Prop("atmosphereDepth", b.AtmosphereDepth)
                    .Prop("sphereOfInfluence", b.SphereOfInfluence);

                w.Name("rotation").BeginObject()
                    .Prop("epochUt", b.Rotation.EpochUt)
                    .Name("q0").BeginArray();
                WriteArray(w, b.Rotation.Q0);
                w.EndArray()
                    .Name("axis").BeginArray();
                WriteArray(w, b.Rotation.Axis);
                w.EndArray()
                    .Prop("rateDegPerSec", b.Rotation.RateDegPerSec)
                    .EndObject();

                if (b.Orbit == null)
                {
                    w.PropNull("orbit");
                }
                else
                {
                    w.Name("orbit").BeginObject()
                        .Prop("epoch", b.Orbit.Epoch)
                        .Prop("semiMajorAxis", b.Orbit.SemiMajorAxis)
                        .Prop("eccentricity", b.Orbit.Eccentricity)
                        .Prop("inclinationDeg", b.Orbit.InclinationDeg)
                        .Prop("lanDeg", b.Orbit.LanDeg)
                        .Prop("argPeDeg", b.Orbit.ArgPeDeg)
                        .Prop("meanAnomalyDeg", b.Orbit.MeanAnomalyDeg)
                        .EndObject();
                }

                w.Prop("style", b.Style ?? "default");
                w.EndObject();
            }
            w.EndObject();
            return w.ToString();
        }

        public static string WriteEvents(IList<KerbTacEvent> events)
        {
            JsonWriter w = new JsonWriter(Math.Max(256, events.Count * 160));
            w.BeginArray();
            for (int i = 0; i < events.Count; i++)
            {
                KerbTacEvent e = events[i];
                w.BeginObject()
                    .Prop("ut", e.Ut)
                    .Prop("type", e.Type);
                if (e.VesselId == null)
                {
                    w.PropNull("vessel");
                }
                else
                {
                    w.Prop("vessel", e.VesselId);
                }
                if (e.TargetId == null)
                {
                    w.PropNull("target");
                }
                else
                {
                    w.Prop("target", e.TargetId);
                }

                if (e.SourceId != null) w.Prop("source", e.SourceId);
                if (e.Weapon != null) w.Prop("weapon", e.Weapon);
                if (e.Outcome != null) w.Prop("outcome", e.Outcome);
                if (e.Range >= 0) w.Prop("range", e.Range);
                if (e.Aspect >= 0) w.Prop("aspect", e.Aspect);
                if (e.Damage >= 0) w.Prop("damage", e.Damage);

                if (e.HasPosition)
                {
                    w.Prop("body", e.Body)
                        .Prop("lat", e.Latitude)
                        .Prop("lon", e.Longitude)
                        .Prop("alt", e.Altitude);
                }

                w.Name("data").BeginObject();
                for (int f = 0; f < e.Data.Count; f++)
                {
                    w.Name(e.Data[f].Name);
                    e.Data[f].Value.Write(w);
                }
                if (e.PartId != null && !HasData(e, "partId"))
                {
                    w.Prop("partId", e.PartId);
                }
                if (e.EngineIndex >= 0 && !HasData(e, "engineIndex"))
                {
                    w.Prop("engineIndex", e.EngineIndex);
                }
                w.EndObject();

                w.EndObject();
            }
            w.EndArray();
            return w.ToString();
        }

        /// <summary>Writes a full vessel track document with in-memory segments.</summary>
        public static string WriteVessel(VesselInfo vessel)
        {
            List<string> segments = new List<string>();
            for (int i = 0; i < vessel.Segments.Count; i++)
            {
                segments.Add(WriteSegment(vessel.Segments[i]));
            }
            return WriteVessel(vessel, segments);
        }

        /// <summary>
        /// Writes a vessel track document from already serialized segment
        /// objects (used when old segments were spilled to disk).
        /// </summary>
        public static string WriteVessel(VesselInfo vessel, IList<string> segmentJson)
        {
            using (StringWriter output = new StringWriter(CultureInfo.InvariantCulture))
            {
                WriteVessel(output, vessel, segmentJson);
                return output.ToString();
            }
        }

        /// <summary>Writes one track without retaining its serialized segments.</summary>
        public static void WriteVessel(TextWriter output, VesselInfo vessel, IEnumerable<string> segmentJson)
        {
            JsonWriter w = new JsonWriter();
            w.BeginObject()
                .Prop("id", vessel.Id)
                .Prop("name", vessel.Name)
                .Prop("type", vessel.Type)
                .Prop("body", vessel.Body);
            WriteVesselExtras(w, vessel);
            w.Name("segments").BeginArray();
            output.Write(w.ToString());
            bool first = true;
            foreach (string segment in segmentJson)
            {
                if (!first) output.Write(',');
                output.Write(segment ?? "null");
                first = false;
            }
            output.Write("]}");
        }

        public static string WriteSegment(TrackSegment segment)
        {
            int n = segment.Samples.Count;
            JsonWriter w = new JsonWriter(Math.Max(256, n * 220));

            w.BeginObject()
                .Prop("index", segment.Index)
                .Prop("logicalIndex", segment.LogicalIndex)
                .Prop("chunkIndex", segment.ChunkIndex)
                .Prop("kind", segment.Kind);
            if (segment.Body != null)
            {
                w.Prop("body", segment.Body);
            }
            w.Prop("startUt", segment.StartUt)
                .Prop("endUt", segment.EndUt);

            if (segment.Source != null)
            {
                w.Prop("source", segment.Source);
            }
            if (segment.Boundary)
            {
                w.Prop("boundary", true);
            }

            if (segment.Kind == SegmentKinds.Orbit && segment.Samples.Count == 0)
            {
                WriteOrbit(w, segment.Orbit);
                w.EndObject();
                return w.ToString();
            }

            w.Name("samples").BeginObject();

            w.Name("t").BeginArray();
            for (int i = 0; i < n; i++) w.Value(segment.Samples[i].T);
            w.EndArray();

            w.Name("lat").BeginArray();
            for (int i = 0; i < n; i++) WriteRounded(w, segment.Samples[i].Latitude, 7);
            w.EndArray();

            w.Name("lon").BeginArray();
            for (int i = 0; i < n; i++) WriteRounded(w, segment.Samples[i].Longitude, 7);
            w.EndArray();

            w.Name("alt").BeginArray();
            for (int i = 0; i < n; i++) WriteRounded(w, segment.Samples[i].Altitude, 2);
            w.EndArray();

            w.Name("q").BeginArray();
            for (int i = 0; i < n; i++)
            {
                Quatd q = segment.Samples[i].Attitude;
                WriteRounded(w, q.X, 5);
                WriteRounded(w, q.Y, 5);
                WriteRounded(w, q.Z, 5);
                WriteRounded(w, q.W, 5);
            }
            w.EndArray();

            IList<VesselSample> samples = segment.Samples;
            WriteSituationColumn(w, samples);
            if (segment.PositionOnly)
            {
                // Position keyframes and static samples only prove location and
                // attitude. Omitting the telemetry columns keeps unknown values
                // unknown instead of writing misleading zeros.
                w.EndObject(); // samples
                w.EndObject();
                return w.ToString();
            }

            WriteOptionalColumn(w, "vx", samples, delegate(ref VesselSample s) { return s.VelocityX; }, 2);
            WriteOptionalColumn(w, "vy", samples, delegate(ref VesselSample s) { return s.VelocityY; }, 2);
            WriteOptionalColumn(w, "vz", samples, delegate(ref VesselSample s) { return s.VelocityZ; }, 2);
            WriteOptionalColumn(w, "throttle", samples, delegate(ref VesselSample s) { return s.Throttle; });
            WriteOptionalColumn(w, "mass", samples, delegate(ref VesselSample s) { return s.Mass; });
            WriteOptionalColumn(w, "g", samples, delegate(ref VesselSample s) { return s.GeeForce; });
            WriteOptionalColumn(w, "stage", samples, delegate(ref VesselSample s) { return s.Stage; });
            WriteOptionalColumn(w, "hdg", samples, delegate(ref VesselSample s) { return s.Heading; }, 2);
            WriteOptionalColumn(w, "vs", samples, delegate(ref VesselSample s) { return s.VerticalSpeed; }, 2);
            WriteOptionalColumn(w, "srfSpeed", samples, delegate(ref VesselSample s) { return s.SurfaceSpeed; }, 2);

            // Coverage is per cell and per resource, not inferred from a chunk
            // flag or a numeric default. Measured zero still carries information.
            WriteOptionalColumn(w, "ias", samples, delegate(ref VesselSample s) { return s.Ias; }, 2);
            WriteOptionalColumn(w, "mach", samples, delegate(ref VesselSample s) { return s.Mach; }, 3);
            WriteOptionalColumn(w, "aoa", samples, delegate(ref VesselSample s) { return s.Aoa; }, 2);
            WriteOptionalColumn(w, "aos", samples, delegate(ref VesselSample s) { return s.Aos; }, 2);
            WriteOptionalColumn(w, "agl", samples, delegate(ref VesselSample s) { return s.Agl; }, 2);
            WriteOptionalColumn(w, "dynPress", samples, delegate(ref VesselSample s) { return s.DynPressure; }, 2);
            WriteOptionalColumn(w, "pitch", samples, delegate(ref VesselSample s) { return s.PitchInput; }, 2);
            WriteOptionalColumn(w, "roll", samples, delegate(ref VesselSample s) { return s.RollInput; }, 2);
            WriteOptionalColumn(w, "yaw", samples, delegate(ref VesselSample s) { return s.YawInput; }, 2);
            WriteOptionalColumn(w, "gear", samples, delegate(ref VesselSample s) { return s.Gear; }, 0);
            WriteOptionalColumn(w, "flaps", samples, delegate(ref VesselSample s) { return s.Flaps; }, 2);
            WriteOptionalColumn(w, "brakes", samples, delegate(ref VesselSample s) { return s.Brakes; }, 0);
            WriteOptionalColumn(w, "health", samples, delegate(ref VesselSample s) { return s.Health; }, 3);
            WriteOptionalColumn(w, "lf", samples, delegate(ref VesselSample s) { return s.LiquidFuel; });
            WriteOptionalColumn(w, "ox", samples, delegate(ref VesselSample s) { return s.Oxidizer; });
            WriteOptionalColumn(w, "ec", samples, delegate(ref VesselSample s) { return s.ElectricCharge; });
            WriteOptionalColumn(w, "mp", samples, delegate(ref VesselSample s) { return s.MonoPropellant; });

            w.EndObject(); // samples
            w.EndObject();
            return w.ToString();
        }

        private delegate double SampleSelector(ref VesselSample sample);

        private static void WriteSituationColumn(JsonWriter w, IList<VesselSample> samples)
        {
            for (int i = 0; i < samples.Count; i++)
            {
                if (samples[i].Situation == null) continue;
                w.Name("situation").BeginArray();
                for (int j = 0; j < samples.Count; j++) w.Value(samples[j].Situation);
                w.EndArray();
                return;
            }
        }

        private delegate double? OptionalSampleSelector(ref VesselSample sample);

        private static void WriteOptionalColumn(JsonWriter w, string name, IList<VesselSample> samples,
            OptionalSampleSelector selector, int decimals = -1)
        {
            bool started = false;
            for (int i = 0; i < samples.Count; i++)
            {
                VesselSample sample = samples[i];
                double? value = selector(ref sample);
                if (value.HasValue && Vec3d.IsFiniteNumber(value.Value))
                {
                    if (!started)
                    {
                        w.Name(name).BeginArray();
                        for (int j = 0; j < i; j++) w.Raw("null");
                        started = true;
                    }
                    if (decimals >= 0) WriteRounded(w, value.Value, decimals);
                    else w.Value(value.Value);
                }
                else if (started) w.Raw("null");
            }
            if (started) w.EndArray();
        }

        private static void WriteRounded(JsonWriter w, double value, int decimals)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                w.Raw("null");
                return;
            }

            double rounded = Math.Round(value, decimals, MidpointRounding.AwayFromZero);
            if (rounded == 0.0)
            {
                rounded = 0.0; // normalize negative zero
            }
            string format = "0." + new string('#', decimals);
            w.Raw(rounded.ToString(format, CultureInfo.InvariantCulture));
        }

        private static void WriteOrbit(JsonWriter w, OrbitDef orbit)
        {
            if (orbit == null)
            {
                w.PropNull("orbit");
                return;
            }
            w.Name("orbit").BeginObject()
                .Prop("epoch", orbit.Epoch)
                .Prop("semiMajorAxis", orbit.SemiMajorAxis)
                .Prop("eccentricity", orbit.Eccentricity)
                .Prop("inclinationDeg", orbit.InclinationDeg)
                .Prop("lanDeg", orbit.LanDeg)
                .Prop("argPeDeg", orbit.ArgPeDeg)
                .Prop("meanAnomalyDeg", orbit.MeanAnomalyDeg);
            var rotation = orbit.BodyFixedRotation;
            if (rotation != null)
            {
                w.Name("bfRotation").BeginObject()
                    .Prop("kind", OrbitBodyRotationDef.Kind)
                    .Prop("epochUt", rotation.EpochUt)
                    .Prop("angleDeg", rotation.AngleDeg)
                    .Prop("rateDegPerSec", rotation.RateDegPerSec)
                    .EndObject();
            }
            w.EndObject();
        }

        private static void WriteArray(JsonWriter w, double[] values)
        {
            if (values == null)
            {
                return;
            }
            for (int i = 0; i < values.Length; i++)
            {
                w.Value(values[i]);
            }
        }

        public static string WriteReadme(SessionInfo session, IList<VesselInfo> vessels,
            IList<KerbTacEvent> events, SummaryInfo summary)
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("KerbTac recording");
            string title = session.Mission != null ? session.Mission.Title : null;
            if (string.IsNullOrWhiteSpace(title)) title = session.Name;
            sb.AppendLine("Mission: " + ReadmeLabel(title, "(untitled)"));
            sb.AppendLine("Format: kerbtac v" + KerbTacVersion.FormatVersion + " revision " + KerbTacVersion.FormatRevision);
            sb.AppendLine("Generator: " + session.GeneratorName + " " + session.GeneratorVersion);
            sb.AppendLine("KSP: " + (session.KspVersion ?? "unknown"));
            sb.AppendLine("Created: " + SessionInfo.FormatIsoUtc(session.StartWallUtc));
            sb.AppendLine("Finished: " + SessionInfo.FormatIsoUtc(session.EndWallUtc));
            sb.AppendLine("UT: " + ReadmeNumber(session.StartUt) + " to " + ReadmeNumber(session.EndUt) + " s");
            sb.AppendLine();

            int chapterCount = session.Chapters != null ? session.Chapters.Count : 0;
            sb.AppendLine("Chapters: " + chapterCount.ToString(CultureInfo.InvariantCulture));
            for (int i = 0; i < chapterCount; i++)
            {
                ChapterInfo chapter = session.Chapters[i];
                sb.AppendLine("  " + ReadmeLabel(chapter.Name, chapter.Id ?? "(untitled)") +
                    " (UT " + ReadmeNumber(chapter.StartUt) + " to " + ReadmeNumber(chapter.EndUt) + " s)");
            }

            sb.AppendLine("Vessels: " + vessels.Count.ToString(CultureInfo.InvariantCulture));
            for (int i = 0; i < vessels.Count; i++)
            {
                VesselInfo vessel = vessels[i];
                sb.AppendLine("  " + ReadmeLabel(vessel.Name, "(unnamed)") + " [" + ReadmeLabel(vessel.Id, "?") + "]");
            }

            // The archive writer runs on the save worker; use its finalized events
            // (including unknown types) and the same summary instance as summary.json.
            SortedDictionary<string, int> eventCounts = new SortedDictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < events.Count; i++)
            {
                string type = events[i].Type ?? "(unknown)";
                int count;
                eventCounts.TryGetValue(type, out count);
                eventCounts[type] = count + 1;
            }
            sb.AppendLine("Events: " + events.Count.ToString(CultureInfo.InvariantCulture));
            foreach (KeyValuePair<string, int> pair in eventCounts)
            {
                sb.AppendLine("  " + ReadmeLabel(pair.Key, "(unknown)") + ": " +
                    pair.Value.ToString(CultureInfo.InvariantCulture));
            }

            sb.AppendLine();
            SummarySession totals = summary != null ? summary.Session : null;
            sb.AppendLine("Duration: " + ReadmeNumber(totals != null ? totals.Duration : session.Duration) + " s");
            if (totals == null)
            {
                sb.AppendLine("Statistics: unavailable (no session summary).");
            }
            else
            {
                sb.AppendLine("Statistics (from summary.json):");
                sb.AppendLine("  Distance: " + ReadmeNumber(totals.DistanceKm) + " km");
                sb.AppendLine("  Max altitude: " + ReadmeNumber(totals.MaxAltitude) + " m");
                sb.AppendLine("  Max speed: " + ReadmeNumber(totals.MaxSpeed) + " m/s");
                sb.AppendLine("  Max Mach: " + ReadmeNumber(totals.MaxMach));
                sb.AppendLine("  Max g-force: " + ReadmeNumber(totals.MaxG) + " g");
            }
            sb.AppendLine();
            sb.AppendLine("This file is a ZIP archive. See docs/format-v1.md for the schema.");
            sb.AppendLine("Start with manifest.json; bodies.json defines reference bodies, events.json lists events,");
            sb.AppendLine("and vessels/<id>.json contains each vessel's track. Optional sections are listed in the manifest.");
            sb.AppendLine("Times are absolute KSP UT seconds. Display T+ relative to session.ut0, or startUt if absent.");
            sb.AppendLine("Positions are body-fixed latitude/longitude in degrees (east positive) and sea-level altitude in metres.");
            sb.AppendLine("Attitude is flat [x,y,z,w] per row, model (+Z forward, +Y up) to body-fixed.");
            sb.AppendLine("Required columns: t, lat, lon, alt, q (in sampled tracks). Within each chunk t must be strictly increasing.");
            sb.AppendLine("Each column has N values, except q has 4N values, where N is the number of timestamps.");
            sb.AppendLine("Group chunks by logicalIndex and sort by chunkIndex; for overlapping times the later chunk wins.");
            sb.AppendLine("A separate orbit span may have elements without samples. boundary=true marks a position jump; do not interpolate across it.");
            sb.AppendLine("Missing optional columns or null cells mean unknown. A recorded zero is not missing.");
            return sb.ToString();
        }

        private static string ReadmeLabel(string value, string fallback)
        {
            return (string.IsNullOrWhiteSpace(value) ? fallback : value)
                .Replace('\r', ' ').Replace('\n', ' ').Trim();
        }

        private static string ReadmeNumber(double value)
        {
            return Vec3d.IsFiniteNumber(value) ? value.ToString("R", CultureInfo.InvariantCulture) : "unknown";
        }
    }
}
