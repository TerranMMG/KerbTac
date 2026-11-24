namespace KerbTac.Core
{
    /// <summary>
    /// Decides when a focus switch means the player took control of a released
    /// payload rather than a spent stage.
    /// </summary>
    public static class SeparationHierarchy
    {
        /// <summary>Pieces released by one staging action arrive within this window.</summary>
        public const double SameEventSeconds = 3.0;

        public static bool IsSameSeparationEvent(double ut, double otherUt)
        {
            return System.Math.Abs(ut - otherUt) <= SameEventSeconds;
        }

        /// <param name="previousRole">role of the vessel that was active before.</param>
        /// <param name="childRole">role assigned to the new active vessel.</param>
        /// <param name="childParentId">parent recorded for the new active vessel.</param>
        /// <param name="previousId">id of the vessel that was active before.</param>
        /// <param name="childMassKg">current mass of the new active vessel.</param>
        /// <param name="previousMassKg">current mass of the previous active vessel.</param>
        public static bool ShouldPromotePayload(
            string previousRole,
            string childRole,
            string childParentId,
            string previousId,
            double childMassKg,
            double previousMassKg)
        {
            if (previousRole != null)
            {
                return false;
            }
            if (childRole != "stage.upper" && childRole != "payload")
            {
                return false;
            }
            if (string.IsNullOrEmpty(childParentId) || childParentId != previousId)
            {
                return false;
            }
            if (previousMassKg <= 0 || childMassKg <= 0)
            {
                return false;
            }
            return childMassKg < previousMassKg * 0.5;
        }
    }
}
