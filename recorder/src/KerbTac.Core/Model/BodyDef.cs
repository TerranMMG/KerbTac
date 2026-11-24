using System;

namespace KerbTac.Core
{
    /// <summary>Rotation parameters of a celestial body (see docs/format-v1.md §4.3).</summary>
    public sealed class BodyRotationDef
    {
        public double EpochUt;
        public double[] Q0 = { 0, 0, 0, 1 };
        public double[] Axis = { 0, 1, 0 };
        public double RateDegPerSec;
    }

    /// <summary>Two-body orbital elements relative to the parent body.</summary>
    public sealed class OrbitDef
    {
        public double Epoch;
        public double SemiMajorAxis;
        public double Eccentricity;
        public double InclinationDeg;
        public double LanDeg;
        public double ArgPeDeg;
        public double MeanAnomalyDeg;
        public OrbitBodyRotationDef BodyFixedRotation;
    }

    /// <summary>Absolute KSP Z-up prime-meridian phase for a vessel orbit.</summary>
    public sealed class OrbitBodyRotationDef
    {
        public const string Kind = "ksp-zup-spin-v1";
        public double EpochUt;
        public double AngleDeg;
        public double RateDegPerSec;
    }

    /// <summary>Serializable description of a celestial body.</summary>
    public sealed class BodyDef
    {
        public string Name;
        public string Parent;
        public double Radius;
        public double GravParameter;
        public double AtmosphereDepth;
        public double SphereOfInfluence;
        public BodyRotationDef Rotation = new BodyRotationDef();
        public OrbitDef Orbit;
        public string Style = "default";
    }
}
