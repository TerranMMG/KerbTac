namespace KerbTac.Core.Sampling
{
    /// <summary>Vessel types that never belong in a replay recording.</summary>
    public static class VesselTrackFilter
    {
        public static bool IsIgnoredType(string vesselType)
        {
            return vesselType == "Debris" || vesselType == "Flag" ||
                   vesselType == "SpaceObject" || vesselType == "Asteroid" ||
                   vesselType == "EVA";
        }

        /// <summary>
        /// The active vessel is usually tracked at full rate, but M3 excludes
        /// the same types everywhere: a Flag/EVA must not become a track just
        /// because the player switched focus to it.
        /// </summary>
        public static bool IsActiveAllowed(string vesselType)
        {
            return !IsIgnoredType(vesselType);
        }
    }
}
