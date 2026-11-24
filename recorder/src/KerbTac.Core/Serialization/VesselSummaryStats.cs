using System;

namespace KerbTac.Core
{
    /// <summary>
    /// Incremental per-vessel totals. RecordingSession observes each sample as
    /// it arrives so summary.json never requires retaining spilled chunks.
    /// </summary>
    public sealed class VesselSummaryStats
    {
        public double DistanceMeters;
        public double MaxAltitude;
        public double MaxSpeed;
        public double MaxMach;
        public double MaxG;
        public bool HasSample;

        private double _lastLat;
        private double _lastLon;
        private double _radius;
        private string _body;
        private FuelRange _liquidFuel;
        private FuelRange _oxidizer;

        private struct FuelRange
        {
            private double? _first;
            private double _last;

            public void Observe(double? value)
            {
                if (!value.HasValue || !Vec3d.IsFiniteNumber(value.Value)) return;
                if (!_first.HasValue) _first = value;
                _last = value.Value;
            }

            public double Difference
            {
                get { return _first.GetValueOrDefault() - _last; }
            }
        }

        public double DistanceKm
        {
            get { return DistanceMeters / 1000.0; }
        }

        public double FuelUsed
        {
            get { return Math.Max(0.0, _liquidFuel.Difference + _oxidizer.Difference); }
        }

        public void Observe(VesselSample sample, string body, double radius)
        {
            UpdatePosition(sample, body, radius);

            _liquidFuel.Observe(sample.LiquidFuel);
            _oxidizer.Observe(sample.Oxidizer);

            if (sample.SurfaceSpeed > MaxSpeed) MaxSpeed = sample.SurfaceSpeed.Value;
            if (sample.Mach > MaxMach) MaxMach = sample.Mach.Value;
            if (sample.GeeForce > MaxG) MaxG = sample.GeeForce.Value;

            if (sample.VelocityX.HasValue && sample.VelocityY.HasValue && sample.VelocityZ.HasValue)
            {
                double x = sample.VelocityX.Value, y = sample.VelocityY.Value, z = sample.VelocityZ.Value;
                double speed = Math.Sqrt(x * x + y * y + z * z);
                if (speed > MaxSpeed) MaxSpeed = speed;
            }
        }

        /// <summary>
        /// Adds a position keyframe to distance and altitude totals without
        /// pretending its omitted telemetry columns are real zeros.
        /// </summary>
        public void ObservePosition(VesselSample sample, string body, double radius)
        {
            UpdatePosition(sample, body, radius);
        }

        private void UpdatePosition(VesselSample sample, string body, double radius)
        {
            if (radius <= 0)
            {
                radius = 600000.0;
            }

            if (!HasSample)
            {
                HasSample = true;
            }
            else if (string.Equals(body, _body, StringComparison.Ordinal))
            {
                DistanceMeters += SummaryBuilder.GreatCircleMeters(
                    _lastLat, _lastLon, sample.Latitude, sample.Longitude, _radius);
            }

            _lastLat = sample.Latitude;
            _lastLon = sample.Longitude;
            _radius = radius;
            _body = body;

            if (sample.Altitude > MaxAltitude) MaxAltitude = sample.Altitude;
        }
    }
}
