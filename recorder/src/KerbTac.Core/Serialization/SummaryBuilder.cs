using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>Aggregates a finished recording into summary.json.</summary>
    public static class SummaryBuilder
    {
        private const double KerbinRadius = 600000.0;

        public static SummaryInfo Build(
            SessionInfo session,
            IList<VesselInfo> vessels,
            IList<KerbTacEvent> events,
            IList<ActorInfo> actors)
        {
            return Build(session, vessels, events, actors, null);
        }

        public static SummaryInfo Build(
            SessionInfo session,
            IList<VesselInfo> vessels,
            IList<KerbTacEvent> events,
            IList<ActorInfo> actors,
            IDictionary<string, BodyDef> bodies)
        {
            return Build(session, vessels, events, actors, bodies, null);
        }

        public static SummaryInfo Build(
            SessionInfo session,
            IList<VesselInfo> vessels,
            IList<KerbTacEvent> events,
            IList<ActorInfo> actors,
            IDictionary<string, BodyDef> bodies,
            IDictionary<string, VesselSummaryStats> precomputed)
        {
            SummaryInfo summary = new SummaryInfo();
            summary.Session.Duration = session != null ? session.Duration : 0.0;

            Dictionary<string, VesselInfo> byId = new Dictionary<string, VesselInfo>();
            if (vessels != null)
            {
                for (int i = 0; i < vessels.Count; i++)
                {
                    VesselInfo vessel = vessels[i];
                    if (vessel == null || vessel.Id == null)
                    {
                        continue;
                    }

                    if (!byId.ContainsKey(vessel.Id))
                    {
                        byId.Add(vessel.Id, vessel);
                    }

                    if (!string.IsNullOrEmpty(vessel.Side) && !summary.Sides.ContainsKey(vessel.Side))
                    {
                        summary.Sides[vessel.Side] = new SummarySide();
                    }
                }
            }

            if (vessels != null)
            {
                for (int i = 0; i < vessels.Count; i++)
                {
                    VesselInfo vessel = vessels[i];
                    if (vessel == null)
                    {
                        continue;
                    }

                    SummaryVessel entry = new SummaryVessel
                    {
                        Id = vessel.Id,
                        Name = vessel.Name
                    };

                    VesselSummaryStats stats = null;
                    if (precomputed != null && vessel.Id != null)
                    {
                        precomputed.TryGetValue(vessel.Id, out stats);
                    }
                    if (stats == null)
                    {
                        stats = Collect(vessel, bodies);
                    }

                    entry.DistanceKm = stats.DistanceKm;
                    entry.FuelUsed = stats.FuelUsed;
                    summary.Vessels.Add(entry);
                    summary.Session.DistanceKm += stats.DistanceKm;
                    if (stats.MaxAltitude > summary.Session.MaxAltitude) summary.Session.MaxAltitude = stats.MaxAltitude;
                    if (stats.MaxSpeed > summary.Session.MaxSpeed) summary.Session.MaxSpeed = stats.MaxSpeed;
                    if (stats.MaxMach > summary.Session.MaxMach) summary.Session.MaxMach = stats.MaxMach;
                    if (stats.MaxG > summary.Session.MaxG) summary.Session.MaxG = stats.MaxG;
                }
            }

            if (events != null)
            {
                for (int i = 0; i < events.Count; i++)
                {
                    KerbTacEvent evt = events[i];
                    if (evt == null)
                    {
                        continue;
                    }

                    int kind = CountKind(evt.Type);
                    if (kind == 0)
                    {
                        continue;
                    }

                    // Hit/kill events put the victim in VesselId. Only a
                    // release can infer the source from that field.
                    string sourceId = !string.IsNullOrEmpty(evt.SourceId)
                        ? evt.SourceId
                        : evt.Type == EventTypes.WeaponRelease ? evt.VesselId : null;
                    VesselInfo source;
                    string side = null;
                    if (sourceId != null && byId.TryGetValue(sourceId, out source))
                    {
                        side = source.Side;

                        SummaryVessel entry = FindSummaryVessel(summary.Vessels, sourceId);
                        if (entry != null)
                        {
                            Increment(entry, kind);
                        }
                    }

                    if (string.IsNullOrEmpty(side))
                    {
                        // Neutral is a side, not a fallback for unattributed hits/kills.
                        if (evt.Type != EventTypes.WeaponRelease)
                        {
                            continue;
                        }
                        side = "neutral"; // Preserve the existing release fallback.
                    }

                    SummarySide sideEntry;
                    if (!summary.Sides.TryGetValue(side, out sideEntry))
                    {
                        sideEntry = new SummarySide();
                        summary.Sides[side] = sideEntry;
                    }
                    Increment(sideEntry, kind);
                }
            }

            return summary;
        }

        private static int CountKind(string type)
        {
            if (type == EventTypes.WeaponRelease)
            {
                return 1;
            }
            if (type == EventTypes.Hit)
            {
                return 2;
            }
            if (type == EventTypes.Kill)
            {
                return 3;
            }
            return 0;
        }

        private static void Increment(SummaryVessel vessel, int kind)
        {
            if (kind == 1) vessel.Shots++;
            else if (kind == 2) vessel.Hits++;
            else if (kind == 3) vessel.Kills++;
        }

        private static void Increment(SummarySide side, int kind)
        {
            if (kind == 1) side.Shots++;
            else if (kind == 2) side.Hits++;
            else if (kind == 3) side.Kills++;
        }

        private static SummaryVessel FindSummaryVessel(List<SummaryVessel> vessels, string id)
        {
            for (int i = 0; i < vessels.Count; i++)
            {
                if (vessels[i].Id == id)
                {
                    return vessels[i];
                }
            }
            return null;
        }

        private static VesselSummaryStats Collect(VesselInfo vessel, IDictionary<string, BodyDef> bodies)
        {
            VesselSummaryStats stats = new VesselSummaryStats();
            if (vessel.Segments == null)
            {
                return stats;
            }

            for (int s = 0; s < vessel.Segments.Count; s++)
            {
                TrackSegment segment = vessel.Segments[s];
                if (segment == null || segment.Samples == null)
                {
                    continue;
                }

                double radius = Radius(segment.Body, bodies);
                for (int i = 0; i < segment.Samples.Count; i++)
                {
                    stats.Observe(segment.Samples[i], segment.Body, radius);
                }
            }

            return stats;
        }

        private static double Radius(string body, IDictionary<string, BodyDef> bodies)
        {
            if (bodies != null && body != null)
            {
                BodyDef def;
                if (bodies.TryGetValue(body, out def) && def != null && def.Radius > 0)
                {
                    return def.Radius;
                }
            }
            return KerbinRadius;
        }

        public static double GreatCircleMeters(
            double lat1, double lon1, double lat2, double lon2, double radius)
        {
            double phi1 = lat1 * Math.PI / 180.0;
            double phi2 = lat2 * Math.PI / 180.0;
            double dPhi = (lat2 - lat1) * Math.PI / 180.0;
            double dLambda = (lon2 - lon1) * Math.PI / 180.0;

            double sinPhi = Math.Sin(dPhi / 2.0);
            double sinLambda = Math.Sin(dLambda / 2.0);
            double a = sinPhi * sinPhi + Math.Cos(phi1) * Math.Cos(phi2) * sinLambda * sinLambda;
            if (a < 0) a = 0;
            if (a > 1) a = 1;
            double c = 2.0 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1.0 - a));
            return radius * c;
        }
    }
}
