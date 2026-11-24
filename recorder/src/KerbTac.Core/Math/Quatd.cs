using System;

namespace KerbTac.Core
{
    /// <summary>
    /// Double-precision quaternion with the same component order as KSP and
    /// Three.js: (x, y, z, w). Convention: q rotates a model-space vector into
    /// the target space, model forward is +Z and model up is +Y.
    /// </summary>
    public struct Quatd
    {
        public double X;
        public double Y;
        public double Z;
        public double W;

        public Quatd(double x, double y, double z, double w)
        {
            X = x;
            Y = y;
            Z = z;
            W = w;
        }

        public static Quatd Identity
        {
            get { return new Quatd(0, 0, 0, 1); }
        }

        public bool IsFinite
        {
            get
            {
                return Vec3d.IsFiniteNumber(X) && Vec3d.IsFiniteNumber(Y) &&
                       Vec3d.IsFiniteNumber(Z) && Vec3d.IsFiniteNumber(W);
            }
        }

        public Quatd Normalized()
        {
            double len = Math.Sqrt(X * X + Y * Y + Z * Z + W * W);
            if (len < 1e-12 || double.IsNaN(len))
            {
                return Identity;
            }
            return new Quatd(X / len, Y / len, Z / len, W / len);
        }

        public static Quatd operator *(Quatd a, Quatd b)
        {
            return new Quatd(
                a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
                a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
                a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W,
                a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z);
        }

        public Quatd Conjugate()
        {
            return new Quatd(-X, -Y, -Z, W);
        }

        /// <summary>Rotates a vector by this (unit) quaternion.</summary>
        public Vec3d Rotate(Vec3d v)
        {
            // t = 2 * (q.xyz cross v); v' = v + q.w * t + q.xyz cross t
            Vec3d u = new Vec3d(X, Y, Z);
            Vec3d t = u.Cross(v) * 2.0;
            return v + t * W + u.Cross(t);
        }

        /// <summary>
        /// Builds the rotation that maps model axes (X right, Y up, Z forward)
        /// onto the orthonormal basis defined by <paramref name="forward"/> and
        /// <paramref name="up"/>. Both inputs must already be expressed in the
        /// target (body-fixed) coordinate system.
        /// </summary>
        public static Quatd FromForwardUp(Vec3d forward, Vec3d up)
        {
            Vec3d z = forward.Normalized();
            if (z.LengthSquared < 1e-12)
            {
                return Identity;
            }

            Vec3d x = up.Cross(z);
            if (x.LengthSquared < 1e-12)
            {
                // Up was parallel to forward; pick any perpendicular axis.
                Vec3d fallback = Math.Abs(z.Y) < 0.9 ? new Vec3d(0, 1, 0) : new Vec3d(1, 0, 0);
                x = fallback.Cross(z);
            }
            x = x.Normalized();
            Vec3d y = z.Cross(x).Normalized();

            return FromBasis(x, y, z);
        }

        /// <summary>
        /// Builds the format attitude from KSP's control reference transform,
        /// whose +Y axis points forward and +Z axis points down. The result
        /// maps model +Z forward and +Y up, as the file format requires.
        /// Both input vectors must already be body-fixed and perpendicular.
        /// </summary>
        public static Quatd FromKspReference(Vec3d referenceForward, Vec3d referenceUp)
        {
            return FromForwardUp(referenceUp, -referenceForward);
        }

        /// <summary>
        /// Builds a quaternion from an orthonormal right-handed basis given by
        /// its column vectors (model X, Y, Z expressed in the target space).
        /// </summary>
        public static Quatd FromBasis(Vec3d x, Vec3d y, Vec3d z)
        {
            double m00 = x.X, m01 = y.X, m02 = z.X;
            double m10 = x.Y, m11 = y.Y, m12 = z.Y;
            double m20 = x.Z, m21 = y.Z, m22 = z.Z;

            double trace = m00 + m11 + m22;
            Quatd q;

            if (trace > 0.0)
            {
                double s = Math.Sqrt(trace + 1.0) * 2.0;
                q = new Quatd(
                    (m21 - m12) / s,
                    (m02 - m20) / s,
                    (m10 - m01) / s,
                    0.25 * s);
            }
            else if (m00 > m11 && m00 > m22)
            {
                double s = Math.Sqrt(1.0 + m00 - m11 - m22) * 2.0;
                q = new Quatd(
                    0.25 * s,
                    (m01 + m10) / s,
                    (m02 + m20) / s,
                    (m21 - m12) / s);
            }
            else if (m11 > m22)
            {
                double s = Math.Sqrt(1.0 + m11 - m00 - m22) * 2.0;
                q = new Quatd(
                    (m01 + m10) / s,
                    0.25 * s,
                    (m12 + m21) / s,
                    (m02 - m20) / s);
            }
            else
            {
                double s = Math.Sqrt(1.0 + m22 - m00 - m11) * 2.0;
                q = new Quatd(
                    (m02 + m20) / s,
                    (m12 + m21) / s,
                    0.25 * s,
                    (m10 - m01) / s);
            }

            return q.Normalized();
        }

        /// <summary>Heading in degrees (0 = north, 90 = east) of the model forward axis.</summary>
        public double HeadingDegrees(double latitudeDeg, double longitudeDeg)
        {
            Vec3d forward = Rotate(new Vec3d(0, 0, 1));
            double lat = latitudeDeg * Math.PI / 180.0;
            double lon = longitudeDeg * Math.PI / 180.0;

            // Local east/north unit vectors in body-fixed coordinates.
            Vec3d east = new Vec3d(-Math.Sin(lon), 0, Math.Cos(lon));
            Vec3d north = new Vec3d(
                -Math.Sin(lat) * Math.Cos(lon),
                Math.Cos(lat),
                -Math.Sin(lat) * Math.Sin(lon));

            double e = forward.Dot(east);
            double n = forward.Dot(north);
            double deg = Math.Atan2(e, n) * 180.0 / Math.PI;
            if (deg < 0)
            {
                deg += 360.0;
            }
            return deg;
        }

        public override string ToString()
        {
            return "(" + X + ", " + Y + ", " + Z + ", " + W + ")";
        }
    }
}
