using System;

namespace KerbTac.Core
{
    /// <summary>
    /// Builds the list of historical UT timestamps needed to keep position
    /// keyframes at the requested cadence when the game clock jumps forward
    /// during high time warp. The current timestamp is deliberately excluded;
    /// the caller captures it separately.
    /// </summary>
    public static class PositionKeyframeSchedule
    {
        private static readonly double[] Empty = new double[0];

        public static double[] Times(double lastUt, double nowUt, double intervalSeconds, int maxSamples)
        {
            if (double.IsNaN(lastUt) || double.IsInfinity(lastUt) ||
                double.IsNaN(nowUt) || double.IsInfinity(nowUt) ||
                double.IsNaN(intervalSeconds) || double.IsInfinity(intervalSeconds) ||
                intervalSeconds <= 0.0 || nowUt <= lastUt || maxSamples <= 0)
            {
                return Empty;
            }

            double rawCount = Math.Floor((nowUt - lastUt) / intervalSeconds);
            int count;
            if (rawCount >= maxSamples)
            {
                count = maxSamples;
            }
            else if (rawCount >= int.MaxValue)
            {
                count = maxSamples;
            }
            else
            {
                count = (int)rawCount;
            }

            if (count <= 0)
            {
                return Empty;
            }

            // If the last keyframe would land exactly on nowUt, leave it to
            // the caller: Times never duplicates the current sample.
            if (lastUt + count * intervalSeconds >= nowUt - 1e-9)
            {
                count--;
            }

            if (count <= 0)
            {
                return Empty;
            }

            double[] times = new double[count];
            for (int i = 0; i < count; i++)
            {
                times[i] = lastUt + (i + 1) * intervalSeconds;
            }
            return times;
        }
    }
}
