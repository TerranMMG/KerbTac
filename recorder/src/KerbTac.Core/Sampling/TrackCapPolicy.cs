using System.Collections.Generic;

namespace KerbTac.Core.Sampling
{
    /// <summary>
    /// Chooses which tracked vessel to evict when the recorder is at its cap.
    /// Loaded and active vessels are never evictable, so the cap can only be
    /// enforced by dropping the farthest unloaded track.
    /// </summary>
    public static class TrackCapPolicy
    {
        public static int FindFarthestEvictable(
            IList<double> distances,
            IList<bool> evictable,
            double candidateDistance)
        {
            if (distances == null || evictable == null)
            {
                return -1;
            }

            int best = -1;
            double bestDistance = candidateDistance;
            int count = distances.Count < evictable.Count
                ? distances.Count
                : evictable.Count;
            for (int i = 0; i < count; i++)
            {
                if (!evictable[i] || double.IsNaN(distances[i]) ||
                    double.IsInfinity(distances[i]))
                {
                    continue;
                }
                if (distances[i] > bestDistance)
                {
                    bestDistance = distances[i];
                    best = i;
                }
            }
            return best;
        }
    }
}
