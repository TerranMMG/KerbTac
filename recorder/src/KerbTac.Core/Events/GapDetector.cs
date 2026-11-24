namespace KerbTac.Core
{
    /// <summary>
    /// Detects timeline holes caused by pauses, scene loads and similar
    /// interruptions. A gap is only recorded when UT jumps by more than a
    /// second; ordinary frame jitter is not a gap.
    /// </summary>
    public sealed class GapDetector
    {
        public const double MinimumGapSeconds = 1.0;

        public bool ShouldAddGap(double previousUt, double currentUt)
        {
            return currentUt - previousUt > MinimumGapSeconds;
        }
    }
}
