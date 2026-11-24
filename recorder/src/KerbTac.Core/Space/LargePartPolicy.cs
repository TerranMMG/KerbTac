namespace KerbTac.Core
{
    /// <summary>
    /// Decides whether a separated object is large enough to record on its own.
    /// Thresholds are deliberately generous and configurable through this one
    /// class so a real recording can calibrate them.
    /// </summary>
    public static class LargePartPolicy
    {
        public const double MinDryMassKg = 500.0;
        public const int MinPartCount = 8;

        public static bool IsLarge(double dryMassKg, int partCount, bool hasFuelTank, bool hasEngine)
        {
            return dryMassKg >= MinDryMassKg
                || partCount >= MinPartCount
                || (hasFuelTank && hasEngine);
        }

        /// <summary>
        /// Fairings are light and come in one or two parts, so the size rules
        /// never accept them; they are always worth recording when jettisoned.
        /// </summary>
        public static bool IsSeparatedPartLarge(
            double massKg,
            int partCount,
            bool hasFuelTank,
            bool hasEngine,
            bool isFairing,
            bool hasCommand = false)
        {
            // Launch clamps, erectors and bare structural adapters can be heavy
            // but have no engine, tank, command module or fairing. They are not
            // stages and must not consume the first booster slot.
            bool plausible = isFairing || hasCommand || hasFuelTank || hasEngine;
            return plausible && (isFairing || hasCommand || IsLarge(massKg, partCount, hasFuelTank, hasEngine));
        }
    }
}
