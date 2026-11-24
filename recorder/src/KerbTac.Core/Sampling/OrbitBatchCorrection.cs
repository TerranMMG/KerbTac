using System;

namespace KerbTac.Core
{
    /// <summary>Stitches a KSP longitude rebase across a historical catch-up batch.</summary>
    public struct OrbitBatchCorrection
    {
        private double _start, _end, _offset;

        public static double Wrap(double degrees)
        {
            degrees %= 360.0;
            return degrees > 180.0 ? degrees - 360.0 : degrees < -180.0 ? degrees + 360.0 : degrees;
        }

        public static OrbitBatchCorrection Between(VesselSample saved, VesselSample reevaluated,
            double currentUt, double spinDegreesPerSecond)
        {
            double duration = currentUt - saved.T;
            double offset = Wrap(saved.Longitude - reevaluated.Longitude);
            double latitudeDrift = saved.Latitude - reevaluated.Latitude;
            double altitudeDrift = saved.Altitude - reevaluated.Altitude;
            // Only a rotation about the body's spin axis is safe to stitch.
            // Preserve real orbit changes and the current observed position.
            if (!Vec3d.IsFiniteNumber(duration) || !Vec3d.IsFiniteNumber(offset) ||
                !Vec3d.IsFiniteNumber(latitudeDrift) || !Vec3d.IsFiniteNumber(altitudeDrift) ||
                !Vec3d.IsFiniteNumber(spinDegreesPerSecond) ||
                duration <= 0 || Math.Abs(offset) < 0.001 ||
                Math.Abs(offset) > Math.Abs(spinDegreesPerSecond) * (duration + 1.0) ||
                Math.Abs(latitudeDrift) > 0.01 || Math.Abs(altitudeDrift) > 25.0)
                return default(OrbitBatchCorrection);

            return new OrbitBatchCorrection { _start = saved.T, _end = currentUt, _offset = offset };
        }

        public double At(double ut)
        {
            if (_offset == 0 || ut >= _end) return 0.0;
            if (ut <= _start) return _offset;
            return _offset * (_end - ut) / (_end - _start);
        }
    }
}
