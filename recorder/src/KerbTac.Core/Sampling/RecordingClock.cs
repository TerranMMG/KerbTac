using System;

namespace KerbTac.Core
{
    /// <summary>
    /// Continuous recording clock. Unlike a sample timestamp it advances on
    /// every simulation tick, so the UI timer keeps running even when no
    /// vessel sample is being captured.
    /// </summary>
    public sealed class RecordingClock
    {
        private double _startUt;
        private double _nowUt;

        public double ElapsedSeconds
        {
            get { return Math.Max(0.0, _nowUt - _startUt); }
        }

        public void Start(double ut)
        {
            if (!IsFinite(ut))
            {
                ut = 0.0;
            }
            _startUt = ut;
            _nowUt = ut;
        }

        public void Tick(double ut)
        {
            if (IsFinite(ut) && ut > _nowUt)
            {
                _nowUt = ut;
            }
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}
