using System;
using System.Collections.Generic;
using System.Globalization;

namespace KerbTac.Core.Sampling
{
    /// <summary>Distance options for recording unloaded vessels in the M3 replay.</summary>
    public static class UnloadedRange
    {
        public const int StepKm = 500;
        public const int MaxKm = 100000;

        public static readonly IReadOnlyList<int> OptionsKm = BuildOptions();

        private static IReadOnlyList<int> BuildOptions()
        {
            var options = new List<int> { 0, 100 };
            for (var km = StepKm; km <= MaxKm; km += StepKm)
            {
                options.Add(km);
            }
            return options.AsReadOnly();
        }

        public static int Snap(int km)
        {
            if (km <= 0) return 0;
            if (km >= MaxKm) return MaxKm;

            int best = 0;
            int bestDistance = int.MaxValue;
            for (int i = 0; i < OptionsKm.Count; i++)
            {
                int distance = Math.Abs(OptionsKm[i] - km);
                if (distance <= bestDistance)
                {
                    bestDistance = distance;
                    best = OptionsKm[i];
                }
            }
            return best;
        }

        public static int IndexOf(int km)
        {
            int snapped = Snap(km);
            for (int i = 0; i < OptionsKm.Count; i++)
            {
                if (OptionsKm[i] == snapped)
                {
                    return i;
                }
            }
            return 0;
        }

        public static string Label(int km)
        {
            return km <= 0
                ? "Only loaded"
                : km.ToString("N0", CultureInfo.InvariantCulture) + " km";
        }

        public static bool ShouldTrack(double distanceMeters, int rangeKm, bool wasTracked)
        {
            if (rangeKm <= 0) return false;
            var limit = wasTracked ? rangeKm * 1100.0 : rangeKm * 1000.0;
            return distanceMeters <= limit;
        }
    }
}
