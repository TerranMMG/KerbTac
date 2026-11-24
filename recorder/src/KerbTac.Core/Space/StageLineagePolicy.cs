namespace KerbTac.Core
{
    /// <summary>Decides whether a vessel may inherit a stage/payload role.</summary>
    public static class StageLineagePolicy
    {
        /// <summary>
        /// Only a loaded vessel that was not already present when recording
        /// started can be a freshly separated stage or payload. Otherwise a
        /// pre-existing ground unit near another unit is mistaken for a
        /// payload at recording start.
        /// </summary>
        public static bool IsEligibleForLineage(
            bool existedAtStart,
            bool loaded,
            bool dockedSeparation)
        {
            // Initial ground/sea units are not separations. A docked pair is
            // still allowed: a recording may start docked and undock later.
            return loaded && (!existedAtStart || dockedSeparation);
        }
    }
}
