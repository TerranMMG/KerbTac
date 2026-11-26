using System;
using KerbTac.Core;

namespace KerbTac
{
    /// <summary>
    /// Flight-path angles derived from surface velocity in the vessel-local
    /// frame (+X right, +Y up, +Z forward). KSP's Vessel does not expose
    /// angleOfAttack/sideslipAngle on 1.12, so the recorder computes them.
    /// </summary>
    public struct FlightAngles
    {
        public double Aoa;
        public double Aos;

        public static FlightAngles Compute(Vec3d velocityBf, Quatd attitude)
        {
            Vec3d local = attitude.Conjugate().Rotate(velocityBf);
            const double radiansToDegrees = 180.0 / Math.PI;
            return new FlightAngles
            {
                Aoa = Math.Atan2(-local.Y, local.Z) * radiansToDegrees,
                Aos = Math.Atan2(local.X, local.Z) * radiansToDegrees
            };
        }
    }
}
