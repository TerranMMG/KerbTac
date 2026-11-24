using System;

namespace KerbTac.Core
{
    /// <summary>
    /// Double-precision 3D vector. Kept independent of UnityEngine so the
    /// recording logic can be unit-tested without KSP.
    /// </summary>
    public struct Vec3d
    {
        public double X;
        public double Y;
        public double Z;

        public Vec3d(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public double LengthSquared
        {
            get { return X * X + Y * Y + Z * Z; }
        }

        public double Length
        {
            get { return Math.Sqrt(LengthSquared); }
        }

        public bool IsFinite
        {
            get { return IsFiniteNumber(X) && IsFiniteNumber(Y) && IsFiniteNumber(Z); }
        }

        public Vec3d Normalized()
        {
            double len = Length;
            if (len < 1e-12 || double.IsNaN(len))
            {
                return new Vec3d(0, 0, 0);
            }
            return new Vec3d(X / len, Y / len, Z / len);
        }

        public double Dot(Vec3d other)
        {
            return X * other.X + Y * other.Y + Z * other.Z;
        }

        public Vec3d Cross(Vec3d other)
        {
            return new Vec3d(
                Y * other.Z - Z * other.Y,
                Z * other.X - X * other.Z,
                X * other.Y - Y * other.X);
        }

        /// <summary>Angle between two directions in degrees; zero if either is degenerate.</summary>
        public double AngleDegrees(Vec3d other)
        {
            double lenA = Length;
            double lenB = other.Length;
            if (lenA < 1e-12 || lenB < 1e-12)
            {
                return 0.0;
            }

            double dot = Dot(other) / (lenA * lenB);
            if (dot > 1.0) dot = 1.0;
            if (dot < -1.0) dot = -1.0;
            return Math.Acos(dot) * (180.0 / Math.PI);
        }

        public static Vec3d operator +(Vec3d a, Vec3d b)
        {
            return new Vec3d(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        }

        public static Vec3d operator -(Vec3d a)
        {
            return new Vec3d(-a.X, -a.Y, -a.Z);
        }

        public static Vec3d operator -(Vec3d a, Vec3d b)
        {
            return new Vec3d(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        }

        public static Vec3d operator *(Vec3d a, double s)
        {
            return new Vec3d(a.X * s, a.Y * s, a.Z * s);
        }

        public static Vec3d operator *(double s, Vec3d a)
        {
            return new Vec3d(a.X * s, a.Y * s, a.Z * s);
        }

        public static bool IsFiniteNumber(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        public override string ToString()
        {
            return "(" + X + ", " + Y + ", " + Z + ")";
        }
    }
}
