using System;

namespace KerbTac.Core
{
    /// <summary>BDA module-name evidence used by role classification and threat ranges.</summary>
    public static class ModuleSignatures
    {
        /// <summary>
        /// MissileLauncher inherits EngageableWeapon.engageRangeMax; it is the
        /// launcher's nominal engagement range and the field the threat circle
        /// needs. MaxEngagementRange belongs to BDModuleSurfaceAI, not a missile.
        /// </summary>
        public static readonly string[] MissileRangeMembers =
        {
            "engageRangeMax",
            "engagementRangeMax",
            "maxRange",
            "range"
        };

        public static bool IsRadar(string typeName)
        {
            // RadarWarningReceiver is a passive receiver, not a search radar.
            return string.Equals(typeName, "ModuleRadar", StringComparison.Ordinal);
        }

        public static bool IsActiveRadar(bool canScan, bool canLock, double maxRangeM)
        {
            // A radarDataReceiver has canScan/canLock false and no range; it is
            // a data link, not a search/fire-control radar.
            return canScan || canLock ||
                   (maxRangeM > 0 && !double.IsNaN(maxRangeM) && !double.IsInfinity(maxRangeM));
        }

        public static double PickRadarRange(double current, double rangeKm, double rangeM)
        {
            // ModuleRadar.radarMaxDistanceDetect is the detection curve's
            // maxTime in kilometres. Fallback fields are already metres.
            double metres = rangeKm > 0 && !double.IsNaN(rangeKm) && !double.IsInfinity(rangeKm)
                ? rangeKm * 1000.0
                : rangeM;
            return PickRange(current, metres);
        }

        public static bool IsMissileLauncher(string typeName)
        {
            return typeName != null &&
                   typeName.IndexOf("MissileLauncher", StringComparison.Ordinal) >= 0;
        }

        public static bool IsMissileFire(string typeName)
        {
            return typeName != null &&
                   typeName.IndexOf("MissileFire", StringComparison.Ordinal) >= 0;
        }

        public static bool IsWeapon(string typeName)
        {
            return typeName != null &&
                   typeName.IndexOf("ModuleWeapon", StringComparison.Ordinal) >= 0;
        }

        public static bool IsDecoupler(string typeName)
        {
            return typeName != null &&
                   typeName.IndexOf("Decouple", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static double PickRange(double current, double candidate)
        {
            if (candidate > 0 && !double.IsNaN(candidate) && !double.IsInfinity(candidate))
            {
                return Math.Max(current, candidate);
            }
            return current;
        }

        /// <summary>
        /// MissileFire also manages guns, so its range is only a fallback for a
        /// vessel that actually carries a MissileLauncher.
        /// </summary>
        public static double PickMissileRange(
            bool hasLauncher,
            double launcherRange,
            double missileFireRange)
        {
            return hasLauncher
                ? PickRange(launcherRange, missileFireRange)
                : launcherRange;
        }
    }
}
