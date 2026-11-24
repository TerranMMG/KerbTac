using System;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class QuatdTests
    {
        private const double Eps = 1e-9;

        private static void AssertVec(Vec3d expected, Vec3d actual, double eps = 1e-7)
        {
            Assert.Equal(expected.X, actual.X, eps);
            Assert.Equal(expected.Y, actual.Y, eps);
            Assert.Equal(expected.Z, actual.Z, eps);
        }

        [Fact]
        public void IdentityBasis_ProducesIdentityQuaternion()
        {
            Quatd q = Quatd.FromForwardUp(new Vec3d(0, 0, 1), new Vec3d(0, 1, 0));

            Assert.Equal(0.0, q.X, Eps);
            Assert.Equal(0.0, q.Y, Eps);
            Assert.Equal(0.0, q.Z, Eps);
            Assert.Equal(1.0, q.W, Eps);
            AssertVec(new Vec3d(0, 0, 1), q.Rotate(new Vec3d(0, 0, 1)));
            AssertVec(new Vec3d(0, 1, 0), q.Rotate(new Vec3d(0, 1, 0)));
        }

        [Fact]
        public void ForwardAlongPlusX_MapsModelForwardToPlusX()
        {
            Quatd q = Quatd.FromForwardUp(new Vec3d(1, 0, 0), new Vec3d(0, 1, 0));

            AssertVec(new Vec3d(1, 0, 0), q.Rotate(new Vec3d(0, 0, 1)));
            AssertVec(new Vec3d(0, 1, 0), q.Rotate(new Vec3d(0, 1, 0)));
            AssertVec(new Vec3d(0, 0, -1), q.Rotate(new Vec3d(1, 0, 0)));
        }

        [Fact]
        public void ForwardAlongMinusZ_MapsModelRightToMinusX()
        {
            Quatd q = Quatd.FromForwardUp(new Vec3d(0, 0, -1), new Vec3d(0, 1, 0));

            AssertVec(new Vec3d(0, 0, -1), q.Rotate(new Vec3d(0, 0, 1)));
            AssertVec(new Vec3d(-1, 0, 0), q.Rotate(new Vec3d(1, 0, 0)));
            AssertVec(new Vec3d(0, 1, 0), q.Rotate(new Vec3d(0, 1, 0)));
        }

        [Fact]
        public void TiltedUpVector_KeepsBasisOrthonormal()
        {
            Quatd q = Quatd.FromForwardUp(new Vec3d(0.3, 0.4, 0.8), new Vec3d(0, 1, 0));

            Vec3d f = q.Rotate(new Vec3d(0, 0, 1));
            Vec3d u = q.Rotate(new Vec3d(0, 1, 0));
            Vec3d r = q.Rotate(new Vec3d(1, 0, 0));

            Assert.Equal(1.0, f.Length, 1e-7);
            Assert.Equal(1.0, u.Length, 1e-7);
            Assert.Equal(1.0, r.Length, 1e-7);
            Assert.Equal(0.0, f.Dot(u), 1e-7);
            Assert.Equal(0.0, f.Dot(r), 1e-7);
            Assert.Equal(0.0, u.Dot(r), 1e-7);
            Assert.Equal(0.0, q.X * q.X + q.Y * q.Y + q.Z * q.Z + q.W * q.W - 1.0, 1e-9);
        }

        [Fact]
        public void DegenerateUpVector_StillReturnsUnitQuaternion()
        {
            Quatd q = Quatd.FromForwardUp(new Vec3d(0, 1, 0), new Vec3d(0, 1, 0));

            double len = q.X * q.X + q.Y * q.Y + q.Z * q.Z + q.W * q.W;
            Assert.Equal(1.0, len, 1e-9);
        }

        [Fact]
        public void HeadingAtEquatorFacingEast_IsNinetyDegrees()
        {
            // At lat 0, lon 0 the body-fixed +Z axis points east.
            Quatd q = Quatd.FromForwardUp(new Vec3d(0, 0, 1), new Vec3d(0, 1, 0));
            Assert.Equal(90.0, q.HeadingDegrees(0, 0), 1e-7);
        }

        [Fact]
        public void HeadingAtEquatorFacingNorth_IsZero()
        {
            Quatd q = Quatd.FromForwardUp(new Vec3d(0, 1, 0), new Vec3d(0, 0, -1));
            Assert.Equal(0.0, q.HeadingDegrees(0, 0), 1e-6);
        }

        [Fact]
        public void HeadingAtEastLongitudeNinety_FacingPlusX_IsWest()
        {
            // lon 90: +X is west, so facing +X means heading 270.
            Quatd q = Quatd.FromForwardUp(new Vec3d(1, 0, 0), new Vec3d(0, 1, 0));
            Assert.Equal(270.0, q.HeadingDegrees(0, 90), 1e-6);
        }

        [Fact]
        public void FromKspReference_MapsModelAxesToFormatConvention()
        {
            // KSP reference: +Y forward, +Z down. With an arbitrary frame where
            // reference forward is +X and reference up is +Z, the produced
            // attitude must map model +Z to the reference up axis and model +Y
            // to the negative reference forward axis.
            Quatd q = Quatd.FromKspReference(new Vec3d(1, 0, 0), new Vec3d(0, 0, 1));

            AssertVec(new Vec3d(0, 0, 1), q.Rotate(new Vec3d(0, 0, 1)));
            AssertVec(new Vec3d(-1, 0, 0), q.Rotate(new Vec3d(0, 1, 0)));
        }

        [Fact]
        public void QuaternionMultiply_ComposesRotations()
        {
            Quatd q = Quatd.FromForwardUp(new Vec3d(1, 0, 0), new Vec3d(0, 1, 0));
            Quatd composed = q * Quatd.Identity;

            AssertVec(q.Rotate(new Vec3d(0, 0, 1)), composed.Rotate(new Vec3d(0, 0, 1)));
        }
    }
}
