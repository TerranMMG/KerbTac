using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>
    /// Groups consecutive drops from one dropper into one salvo event. BDA fires
    /// automatic countermeasures as a sequence of single increments, which would
    /// otherwise produce dozens of near-identical event rows.
    /// </summary>
    public sealed class CountermeasureBurstTracker
    {
        public const double BurstGapSeconds = 2.0;
        public const double MaxBurstSeconds = 8.0;

        private readonly Dictionary<string, CountermeasureReleaseSignal> _pending =
            new Dictionary<string, CountermeasureReleaseSignal>();
        private readonly List<CountermeasureReleaseSignal> _completed =
            new List<CountermeasureReleaseSignal>();

        public IReadOnlyList<CountermeasureReleaseSignal> Poll(
            IEnumerable<CountermeasureReleaseSignal> releases,
            double ut)
        {
            _completed.Clear();
            if (releases != null)
            {
                foreach (CountermeasureReleaseSignal release in releases)
                {
                    if (release == null || release.Count <= 0)
                    {
                        continue;
                    }

                    string key = KeyOf(release);
                    CountermeasureReleaseSignal pending;
                    if (_pending.TryGetValue(key, out pending))
                    {
                        double gap = release.Ut - pending.EndUt;
                        double span = release.Ut - pending.Ut;
                        if (gap <= BurstGapSeconds && span <= MaxBurstSeconds)
                        {
                            pending.Count += release.Count;
                            pending.EndUt = Math.Max(pending.EndUt, release.Ut);
                            continue;
                        }

                        Complete(key);
                    }

                    _pending[key] = release;
                }
            }

            FlushStale(ut);
            return _completed;
        }

        public IReadOnlyList<CountermeasureReleaseSignal> FlushAll()
        {
            _completed.Clear();
            foreach (string key in new List<string>(_pending.Keys))
            {
                Complete(key);
            }
            return _completed;
        }

        public void Reset()
        {
            _pending.Clear();
            _completed.Clear();
        }

        private void FlushStale(double ut)
        {
            if (_pending.Count == 0)
            {
                return;
            }

            List<string> stale = null;
            foreach (KeyValuePair<string, CountermeasureReleaseSignal> pair in _pending)
            {
                if (ut - pair.Value.EndUt > BurstGapSeconds ||
                    ut - pair.Value.Ut > MaxBurstSeconds)
                {
                    if (stale == null) stale = new List<string>();
                    stale.Add(pair.Key);
                }
            }

            if (stale == null)
            {
                return;
            }

            for (int i = 0; i < stale.Count; i++)
            {
                Complete(stale[i]);
            }
        }

        private void Complete(string key)
        {
            CountermeasureReleaseSignal signal;
            if (!_pending.TryGetValue(key, out signal))
            {
                return;
            }

            _pending.Remove(key);
            _completed.Add(signal);
        }

        private static string KeyOf(CountermeasureReleaseSignal release)
        {
            return release.VesselId + "|" + release.Kind;
        }
    }
}
