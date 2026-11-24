using System;

namespace KerbTac.Core
{
    /// <summary>
    /// Builds the frozen threat object. A unit must have both a missile range
    /// and a radar range; otherwise it gets no circle (format v1.3).
    /// </summary>
    public static class ThreatRanges
    {
        public static ThreatInfo From(double missileRangeM, double radarRangeM)
        {
            if (!(missileRangeM > 0) || !(radarRangeM > 0) ||
                double.IsNaN(missileRangeM) || double.IsNaN(radarRangeM) ||
                double.IsInfinity(missileRangeM) || double.IsInfinity(radarRangeM))
            {
                return null;
            }

            return new ThreatInfo
            {
                MissileRangeM = missileRangeM,
                RadarRangeM = radarRangeM,
                ThreatRadiusM = Math.Min(missileRangeM, radarRangeM)
            };
        }

        /// <summary>
        /// A radar-only unit (no launcher) still gets a radar coverage circle.
        /// The launcher's circle remains absent because it has no organic radar.
        /// </summary>
        public static ThreatInfo RadarCoverage(double radarRangeM)
        {
            if (!(radarRangeM > 0) ||
                double.IsNaN(radarRangeM) ||
                double.IsInfinity(radarRangeM))
            {
                return null;
            }
            return new ThreatInfo
            {
                MissileRangeM = 0,
                RadarRangeM = radarRangeM,
                ThreatRadiusM = radarRangeM
            };
        }
    }
}
