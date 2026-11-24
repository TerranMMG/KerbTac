namespace KerbTac.Core.Sampling
{
    /// <summary>How a tracked vessel is sampled at the current instant.</summary>
    public enum TrackSampleMode
    {
        None,
        Full,
        Position,
        Static,
    }

    /// <summary>Result of <see cref="TrackPolicy.Decide"/>.</summary>
    public sealed class TrackDecision
    {
        public TrackDecision(TrackSampleMode mode, string source, bool startNewSegment)
        {
            Mode = mode;
            Source = source;
            StartNewSegment = startNewSegment;
        }

        public TrackSampleMode Mode { get; }
        public string Source { get; }
        public bool StartNewSegment { get; }
    }

    /// <summary>
    /// Decides whether a vessel is recorded and at what fidelity. Active vessels
    /// keep full telemetry at normal rate; loaded non-active vessels are always
    /// recorded; unloaded vessels are position keyframes inside the range.
    /// </summary>
    public static class TrackPolicy
    {
        public const double PositionIntervalSeconds = 10.0;
        public const double RecentActiveWindowSeconds = 30.0;
        public const double RecentActivePositionIntervalSeconds = 0.5;

        public static TrackDecision Decide(
            bool active,
            bool loaded,
            bool packed,
            double warpRate,
            double distanceMeters,
            int rangeKm,
            bool wasTracked,
            bool staticSituation,
            TrackSampleMode previousMode,
            bool physicsWarp = false)
        {
            if (active)
            {
                var mode = (packed || warpRate > 1.01) && !physicsWarp
                    ? TrackSampleMode.Position
                    : TrackSampleMode.Full;
                return new TrackDecision(mode, "active", mode != previousMode);
            }

            if (loaded)
            {
                // A loaded vessel on the runway is still moving under physics.
                // Treating LANDED/PRELAUNCH as a one-sample static object
                // freezes its model whenever it is not the active vessel.
                return new TrackDecision(TrackSampleMode.Full, "loaded", TrackSampleMode.Full != previousMode);
            }

            if (!UnloadedRange.ShouldTrack(distanceMeters, rangeKm, wasTracked))
            {
                return new TrackDecision(TrackSampleMode.None, null, false);
            }

            var unloadedMode = staticSituation ? TrackSampleMode.Static : TrackSampleMode.Position;
            return new TrackDecision(unloadedMode, "unloaded", unloadedMode != previousMode);
        }

        /// <summary>
        /// Unloaded vessels that were just active get a short high-rate window so
        /// their trail does not jump in 10 s steps right after the player swaps
        /// focus.
        /// </summary>
        public static double PositionInterval(bool recentlyActive)
        {
            return PositionInterval(false, recentlyActive);
        }

        public static double PositionInterval(bool active, bool recentlyActive)
        {
            return active || recentlyActive
                ? RecentActivePositionIntervalSeconds
                : PositionIntervalSeconds;
        }
    }
}
