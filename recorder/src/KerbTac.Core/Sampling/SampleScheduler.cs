namespace KerbTac.Core
{
    /// <summary>
    /// Decides how often each vessel is sampled. The active vessel and all
    /// loaded vessels within 2.5 km use 10 Hz; farther loaded vessels step
    /// down to 4 / 2 / 1 Hz. Unloaded vessels are handled by TrackPolicy.
    /// </summary>
    public sealed class SampleScheduler
    {
        public const double ActiveInterval = 0.1;
        public const double ImportantInterval = 0.1;
        public const double LoadedInterval = 0.1;
        public const double FarInterval = 0.25;
        public const double VeryFarInterval = 0.5;
        public const double DistantInterval = 1.0;

        /// <summary>Loaded vessels inside this radius use the full 10 Hz rate.</summary>
        public const double NearDistanceMeters = 2500.0;

        /// <summary>Beyond this distance a loaded vessel is sampled at 4 Hz.</summary>
        public const double FarDistanceMeters = 10000.0;

        /// <summary>Beyond this distance a loaded vessel is sampled at 2 Hz.</summary>
        public const double VeryFarDistanceMeters = 50000.0;

        /// <summary>
        /// Jitter tolerance so a 0.1 s sample is not skipped when the physics
        /// step lands a fraction of a millisecond early.
        /// </summary>
        public const double JitterTolerance = 0.001;

        public double IntervalFor(bool active, bool important, double distanceMeters)
        {
            if (active)
            {
                return ActiveInterval;
            }
            if (important)
            {
                return ImportantInterval;
            }
            if (distanceMeters > VeryFarDistanceMeters)
            {
                return DistantInterval;
            }
            if (distanceMeters > FarDistanceMeters)
            {
                return VeryFarInterval;
            }
            if (distanceMeters > NearDistanceMeters)
            {
                return FarInterval;
            }
            return LoadedInterval;
        }

        public bool ShouldSample(double ut, double lastUt, double interval)
        {
            if (ut < lastUt)
            {
                return false;
            }
            if (interval <= 0)
            {
                return true;
            }
            return ut - lastUt >= interval - JitterTolerance;
        }
    }
}
