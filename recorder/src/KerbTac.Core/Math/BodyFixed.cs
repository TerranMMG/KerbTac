using System;

namespace KerbTac.Core
{
    /// <summary>
    /// Converts between KSP's body-fixed cartesian frame and latitude/longitude.
    /// The frame follows the same convention as the replay format: +Y is north,
    /// longitude 0 points at +X and longitude 90E points at +Z.
    /// </summary>
    public static class BodyFixed
    {
        private const double RadToDeg = 180.0 / Math.PI;

        public static void ToLatLonAlt(
            Vec3d bodyFixed,
            double radius,
            out double latDeg,
            out double lonDeg,
            out double altM)
        {
            var horizontal = Math.Sqrt(bodyFixed.X * bodyFixed.X + bodyFixed.Z * bodyFixed.Z);
            latDeg = Math.Atan2(bodyFixed.Y, horizontal) * RadToDeg;
            lonDeg = Math.Atan2(bodyFixed.Z, bodyFixed.X) * RadToDeg;
            altM = bodyFixed.Length - radius;
        }

        public static Vec3d FromWorld(Vec3d world, Vec3d bodyPosition, Quatd bodyRotation)
        {
            return bodyRotation.Conjugate().Rotate(world - bodyPosition);
        }

        /// <summary>Rotate a world-space direction into the body-fixed frame without translating it.</summary>
        public static Vec3d DirectionFromWorld(Vec3d worldDirection, Quatd bodyRotation)
        {
            return bodyRotation.Conjugate().Rotate(worldDirection);
        }

        /// <summary>
        /// Convert KSP's body-relative orbit vector into its body-fixed frame.
        /// KSP orbit vectors are YZ-flipped.
        /// </summary>
        public static Vec3d FromRelative(Vec3d relative, Quatd bodyRotation)
        {
            return bodyRotation.Conjugate().Rotate(new Vec3d(relative.X, relative.Z, relative.Y));
        }

        public static Vec3d FromLatLonAlt(
            double latDeg,
            double lonDeg,
            double altM,
            double radius)
        {
            double lat = latDeg / RadToDeg;
            double lon = lonDeg / RadToDeg;
            double r = radius + altM;
            double cosLat = Math.Cos(lat);
            return new Vec3d(
                r * cosLat * Math.Cos(lon),
                r * Math.Sin(lat),
                r * cosLat * Math.Sin(lon));
        }

        public static double Distance(Vec3d a, Vec3d b)
        {
            return (a - b).Length;
        }

        /// <summary>
        /// Cartesian distance that rejects non-finite coordinates. A landed
        /// vessel's Orbit can be degenerate; callers use this to avoid feeding
        /// NaN into the distance filter.
        /// </summary>
        public static bool TryDistance(Vec3d a, Vec3d b, out double distance)
        {
            if (!a.IsFinite || !b.IsFinite)
            {
                distance = 0.0;
                return false;
            }

            distance = (a - b).Length;
            return Vec3d.IsFiniteNumber(distance);
        }

        /// <summary>
        /// Format attitude for a point with no usable reference transform:
        /// model +Z points north and model +Y points radially up.
        /// </summary>
        public static Quatd SurfaceAttitude(double latDeg, double lonDeg)
        {
            double lat = latDeg / RadToDeg;
            double lon = lonDeg / RadToDeg;
            double sinLat = Math.Sin(lat);
            double cosLat = Math.Cos(lat);
            double sinLon = Math.Sin(lon);
            double cosLon = Math.Cos(lon);

            var up = new Vec3d(cosLat * cosLon, sinLat, cosLat * sinLon);
            var north = new Vec3d(-sinLat * cosLon, cosLat, -sinLat * sinLon);
            Quatd q = Quatd.FromForwardUp(north, up);
            return q.IsFinite ? q.Normalized() : Quatd.Identity;
        }
    }
}
