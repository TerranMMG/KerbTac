namespace KerbTac.Core
{
    /// <summary>Two actual KSP poses spanning the current catch-up batch.</summary>
    public sealed class ObservedBodyRotation
    {
        private double _previousUt = double.NegativeInfinity;
        private double _currentUt = double.NegativeInfinity;
        private Quatd _previous = Quatd.Identity;
        private Quatd _current = Quatd.Identity;

        public void Observe(double ut, Quatd rotation)
        {
            // Multiple Unity physics callbacks can share one game timestamp.
            // Don't overwrite an orientation already used to emit samples.
            if (ut == _currentUt) return;
            rotation = rotation.Normalized();
            if (ut < _currentUt || double.IsNegativeInfinity(_currentUt))
            {
                _previousUt = ut;
                _previous = rotation;
            }
            else if (ut > _currentUt)
            {
                _previousUt = _currentUt;
                _previous = _current;
            }
            _currentUt = ut;
            _current = rotation;
        }

        public Quatd At(double ut)
        {
            if (ut >= _currentUt) return _current;
            if (ut <= _previousUt) return _previous;
            double t = (ut - _previousUt) / (_currentUt - _previousUt);
            double dot = _previous.X * _current.X + _previous.Y * _current.Y
                + _previous.Z * _current.Z + _previous.W * _current.W;
            double signedT = dot < 0 ? -t : t;
            double a = 1 - t;
            return new Quatd(a * _previous.X + signedT * _current.X,
                a * _previous.Y + signedT * _current.Y,
                a * _previous.Z + signedT * _current.Z,
                a * _previous.W + signedT * _current.W).Normalized();
        }

        public ObservedBodyRotation ForBatch(double lastSampleUt, Quatd lastSampleRotation)
        {
            var batch = new ObservedBodyRotation();
            batch.Observe(lastSampleUt, lastSampleRotation);
            batch.Observe(_currentUt, _current);
            return batch;
        }
    }
}
