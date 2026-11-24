using System;
using KerbTac.Core;
using KerbTac.Core.Bda;

namespace KerbTac.Recorder
{
    /// <summary>
    /// Reads the frozen air-defence ranges from BDA modules. Pure reflection:
    /// missing fields leave the range at zero, which suppresses the circle.
    /// </summary>
    internal static class ThreatRangeReader
    {
        public static ThreatInfo Read(Vessel vessel)
        {
            if (vessel == null || vessel.parts == null)
            {
                return null;
            }

            double missileRange = 0;
            double radarRange = 0;
            double missileFireRange = 0;
            bool hasMissileLauncher = false;
            for (int p = 0; p < vessel.parts.Count; p++)
            {
                Part part = vessel.parts[p];
                if (part == null || part.Modules == null)
                {
                    continue;
                }
                for (int m = 0; m < part.Modules.Count; m++)
                {
                    PartModule module = part.Modules[m];
                    if (module == null)
                    {
                        continue;
                    }

                    string type = module.GetType().Name;
                    if (ModuleSignatures.IsMissileLauncher(type))
                    {
                        hasMissileLauncher = true;
                        // MissileLauncher inherits EngageableWeapon.engageRangeMax.
                        double range = ToRange(BdaReflectionCache.Get(
                            module, ModuleSignatures.MissileRangeMembers));
                        if (!(range > 0))
                        {
                            range = ToRange(BdaReflectionCache.Invoke(
                                module, "GetEngagementRangeMax"));
                        }
                        missileRange = ModuleSignatures.PickRange(missileRange, range);
                    }
                    else if (ModuleSignatures.IsMissileFire(type))
                    {
                        // Stored separately: MissileFire also manages guns, so
                        // it is only a fallback when a launcher actually exists.
                        missileFireRange = ModuleSignatures.PickRange(
                            missileFireRange,
                            ToRange(BdaReflectionCache.Get(
                                module, "selectedWeaponsEngageRangeMax")));
                    }
                    else if (ModuleSignatures.IsRadar(type))
                    {
                        // radarMaxDistanceDetect is the detection curve's
                        // maxTime in kilometres; the legacy fields are metres.
                        double rangeM = ModuleSignatures.PickRadarRange(
                            0,
                            ToRange(BdaReflectionCache.Get(
                                module, "radarMaxDistanceDetect")),
                            ToRange(BdaReflectionCache.Get(
                                module, "radarMaxDistance", "maxRange")));
                        bool canScan = ToBool(BdaReflectionCache.Get(module, "canScan"));
                        bool canLock = ToBool(BdaReflectionCache.Get(module, "canLock"));
                        if (ModuleSignatures.IsActiveRadar(canScan, canLock, rangeM))
                        {
                            radarRange = ModuleSignatures.PickRange(radarRange, rangeM);
                        }
                    }
                }
            }

            missileRange = ModuleSignatures.PickMissileRange(
                hasMissileLauncher, missileRange, missileFireRange);

            ThreatInfo info = ThreatRanges.From(missileRange, radarRange);
            if (info == null)
            {
                // A radar-only unit still gets a radar coverage circle. A
                // missile-only launcher (radar=0) does not.
                info = ThreatRanges.RadarCoverage(radarRange);
            }
            Log.Info("Threat ranges " + vessel.vesselName +
                     ": missile=" + missileRange.ToString("F0") +
                     " m radar=" + radarRange.ToString("F0") + " m" +
                     (info == null
                         ? " (no circle)"
                         : " radius=" + info.ThreatRadiusM.ToString("F0") + " m" +
                           (info.MissileRangeM <= 0 ? " (radar coverage)" : "")));
            return info;
        }

        private static bool ToBool(object value)
        {
            try
            {
                return value != null && Convert.ToBoolean(value);
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static double ToRange(object value)
        {
            if (value == null)
            {
                return 0;
            }
            try
            {
                double number = Convert.ToDouble(value);
                return number > 0 && !double.IsInfinity(number) && !double.IsNaN(number)
                    ? number
                    : 0;
            }
            catch (Exception)
            {
                return 0;
            }
        }
    }
}
