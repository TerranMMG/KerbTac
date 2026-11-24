using System;

namespace KerbTac.Core
{
    /// <summary>
    /// Frozen air-defence ranges for a ground or sea unit (format v1.3).
    /// A unit without missiles or radar writes no threat object at all.
    /// </summary>
    public sealed class ThreatInfo
    {
        public double MissileRangeM;
        public double RadarRangeM;
        public double ThreatRadiusM;

        public bool HasAny
        {
            get { return MissileRangeM > 0 || RadarRangeM > 0 || ThreatRadiusM > 0; }
        }
    }
}
