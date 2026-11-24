using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>Kind constants for vessel track segments.</summary>
    public static class SegmentKinds
    {
        public const string Flight = "flight";
        public const string Surface = "surface";
        public const string Orbit = "orbit";
        public const string Static = "static";
    }

    /// <summary>
    /// A continuous run of samples for one vessel. Concatenated into a single
    /// vessel track file as one entry of the "segments" array.
    /// </summary>
    public sealed class TrackSegment
    {
        public int Index;
        public string Kind = SegmentKinds.Flight;
        public string Body;
        public string Source = "active";
        public bool Boundary;

        /// <summary>Groups chunks of one continuous flight; v1 files default to 0.</summary>
        public int LogicalIndex;

        /// <summary>Order within a logical segment; transient spill chunks increment this.</summary>
        public int ChunkIndex;

        /// <summary>Whether the optional fuel/resource columns are meaningful.</summary>
        public bool IncludeResources;

        /// <summary>
        /// True when samples are position keyframes (unloaded or warp) or a
        /// one-shot static sample. Such segments omit telemetry columns so the
        /// player can distinguish unknown values from real zeros.
        /// </summary>
        public bool PositionOnly;

        public List<VesselSample> Samples = new List<VesselSample>();

        /// <summary>Only used when Kind == orbit.</summary>
        public OrbitDef Orbit;

        /// <summary>
        /// Times for sample-less orbit segments. When samples exist their
        /// timestamps win; these exist only for the orbit case (format v1.3).
        /// </summary>
        public double? StartUtOverride;
        public double? EndUtOverride;

        public double StartUt
        {
            get
            {
                if (Samples.Count > 0) return Samples[0].T;
                return StartUtOverride ?? 0.0;
            }
        }

        public double EndUt
        {
            get
            {
                if (Samples.Count > 0) return Samples[Samples.Count - 1].T;
                return EndUtOverride ?? 0.0;
            }
        }
    }

    /// <summary>A vessel as listed in manifest.json and stored in vessels/&lt;id&gt;.json.</summary>
    public sealed class VesselInfo
    {
        public string Id;
        public string Name;
        public string Type = "Unknown";
        public string Body = "Kerbin";
        public string Color = "#4fc3f7";
        public string Team;
        public string RootPart;
        public int PartCount;
        public int CrewCount;

        public string Side = "neutral";
        public string Callsign;
        public string Kind = "unknown";
        public double Health = 1.0;
        public List<string> Loadout = new List<string>();
        public int Importance;

        // Format v1.3: stage lineage and the role the player uses to pick a model.
        public string Role;
        public string ParentId;
        public int StageIndex = -1;
        public double? SeparatedUt;
        public string ModelRole;

        /// <summary>Frozen air-defence ranges; null when the unit has none.</summary>
        public ThreatInfo Threat;

        public List<TrackSegment> Segments = new List<TrackSegment>();

        public bool HasSamples
        {
            get
            {
                for (int i = 0; i < Segments.Count; i++)
                {
                    if (Segments[i].Samples.Count > 0)
                    {
                        return true;
                    }
                }
                return false;
            }
        }

        public double StartUt
        {
            get
            {
                double best = double.MaxValue;
                for (int i = 0; i < Segments.Count; i++)
                {
                    if (Segments[i].Samples.Count > 0 && Segments[i].StartUt < best)
                    {
                        best = Segments[i].StartUt;
                    }
                }
                return best == double.MaxValue ? 0.0 : best;
            }
        }

        public double EndUt
        {
            get
            {
                double best = double.MinValue;
                for (int i = 0; i < Segments.Count; i++)
                {
                    if (Segments[i].Samples.Count > 0 && Segments[i].EndUt > best)
                    {
                        best = Segments[i].EndUt;
                    }
                }
                return best == double.MinValue ? 0.0 : best;
            }
        }
    }
}
