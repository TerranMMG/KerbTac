using System;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class BodyFixedTests
    {
        private const double Radius = 600_000;

        [Fact]
        public void ToLatLonAlt_handles_equator_and_poles()
        {
            BodyFixed.ToLatLonAlt(new Vec3d(Radius + 1000, 0, 0), Radius, out var lat, out var lon, out var alt);
            Assert.Equal(0, lat, 6);
            Assert.Equal(0, lon, 6);
            Assert.Equal(1000, alt, 6);

            BodyFixed.ToLatLonAlt(new Vec3d(0, Radius + 1000, 0), Radius, out lat, out lon, out alt);
            Assert.Equal(90, lat, 6);
            Assert.Equal(1000, alt, 6);
        }

        [Fact]
        public void ToLatLonAlt_uses_positive_z_for_east_longitude()
        {
            BodyFixed.ToLatLonAlt(new Vec3d(0, 0, Radius + 1000), Radius, out var lat, out var lon, out var alt);
            Assert.Equal(0, lat, 6);
            Assert.Equal(90, lon, 6);
            Assert.Equal(1000, alt, 6);
        }

        [Fact]
        public void FromLatLonAlt_round_trips_a_surface_point()
        {
            var bf = BodyFixed.FromLatLonAlt(12.5, -45.25, 1000, Radius);
            BodyFixed.ToLatLonAlt(bf, Radius, out var lat, out var lon, out var alt);
            Assert.Equal(12.5, lat, 6);
            Assert.Equal(-45.25, lon, 6);
            Assert.Equal(1000, alt, 6);
        }

        [Fact]
        public void FromWorld_is_the_inverse_of_body_rotation()
        {
            var rotation = Quatd.FromForwardUp(new Vec3d(0, 0, 1), new Vec3d(1, 0, 0));
            var body = new Vec3d(100, 200, 300);
            var world = body + rotation.Rotate(new Vec3d(10, 0, 0));
            var bf = BodyFixed.FromWorld(world, body, rotation);
            Assert.Equal(10, bf.X, 6);
            Assert.Equal(0, bf.Y, 6);
            Assert.Equal(0, bf.Z, 6);
        }

        [Fact]
        public void DirectionFromWorld_rotates_without_translating()
        {
            var rotation = Quatd.FromForwardUp(new Vec3d(0, 0, 1), new Vec3d(1, 0, 0));
            var world = rotation.Rotate(new Vec3d(10, 0, 0));
            var bf = BodyFixed.DirectionFromWorld(world, rotation);
            Assert.Equal(10, bf.X, 6);
            Assert.Equal(0, bf.Y, 6);
            Assert.Equal(0, bf.Z, 6);
        }

        [Fact]
        public void Distance_is_cartesian()
        {
            Assert.Equal(5, BodyFixed.Distance(new Vec3d(1, 2, 3), new Vec3d(4, 6, 3)), 6);
        }

        [Fact]
        public void TryDistance_rejects_non_finite_points()
        {
            Assert.False(BodyFixed.TryDistance(
                new Vec3d(double.NaN, 0, 0), new Vec3d(1, 2, 3), out _));
            Assert.False(BodyFixed.TryDistance(
                new Vec3d(1, 2, 3), new Vec3d(0, double.PositiveInfinity, 0), out _));

            Assert.True(BodyFixed.TryDistance(
                new Vec3d(1, 2, 3), new Vec3d(4, 6, 3), out var distance));
            Assert.Equal(5, distance, 6);
        }

        [Fact]
        public void FromRelative_unflips_the_ksp_orbit_axes()
        {
            var relative = new Vec3d(1, 2, 3);
            var x = BodyFixed.FromRelative(relative, Quatd.Identity);
            Assert.Equal(1, x.X, 6);
            Assert.Equal(3, x.Y, 6);
            Assert.Equal(2, x.Z, 6);
        }

        [Fact]
        public void SurfaceAttitude_maps_plus_z_north_and_plus_y_up()
        {
            const double lat = 12.5;
            const double lon = -45.25;
            var q = BodyFixed.SurfaceAttitude(lat, lon);

            Assert.True(q.IsFinite);
            double norm = Math.Sqrt(q.X * q.X + q.Y * q.Y + q.Z * q.Z + q.W * q.W);
            Assert.Equal(1.0, norm, 6);

            double latRad = lat * Math.PI / 180.0;
            double lonRad = lon * Math.PI / 180.0;
            var up = new Vec3d(
                Math.Cos(latRad) * Math.Cos(lonRad),
                Math.Sin(latRad),
                Math.Cos(latRad) * Math.Sin(lonRad));
            var north = new Vec3d(
                -Math.Sin(latRad) * Math.Cos(lonRad),
                Math.Cos(latRad),
                -Math.Sin(latRad) * Math.Sin(lonRad));

            Assert.Equal(1.0, q.Rotate(new Vec3d(0, 0, 1)).Dot(north), 6);
            Assert.Equal(1.0, q.Rotate(new Vec3d(0, 1, 0)).Dot(up), 6);
        }
    }
}
