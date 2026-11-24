using System;

namespace KerbTac
{
    /// <summary>
    /// Flight-path angles derived from surface velocity in the format body
    /// frame (+X right, +Y up, +Z forward). KSP's Vessel does not expose
    /// angleOfAttack/sideslipAngle on 1.12, so the recorder computes them.
    /// </summary>
    public struct FlightAngles
    {
        public double Aoa;
        public double Aos;

        public static FlightAngles Compute(double right, double up, double forward)
        {
            const double radiansToDegrees = 180.0 / Math.PI;
            return new FlightAngles
            {
                Aoa = Math.Atan2(up, forward) * radiansToDegrees,
                Aos = Math.Atan2(right, forward) * radiansToDegrees
            };
        }
    }
}
