using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>Session-wide totals in summary.json.</summary>
    public sealed class SummarySession
    {
        public double Duration;
        public double DistanceKm;
        public double MaxAltitude;
        public double MaxSpeed;
        public double MaxMach;
        public double MaxG;
    }

    /// <summary>Per-vessel totals in summary.json.</summary>
    public sealed class SummaryVessel
    {
        public string Id;
        public string Name;
        public int Shots;
        public int Hits;
        public int Kills;
        public double FuelUsed;
        public double DistanceKm;
    }

    /// <summary>Per-side totals in summary.json.</summary>
    public sealed class SummarySide
    {
        public int Shots;
        public int Hits;
        public int Kills;
    }

    /// <summary>Optional aggregate statistics written at the end of a recording.</summary>
    public sealed class SummaryInfo
    {
        public SummarySession Session = new SummarySession();
        public List<SummaryVessel> Vessels = new List<SummaryVessel>();
        public Dictionary<string, SummarySide> Sides = new Dictionary<string, SummarySide>();
    }
}
