using KerbTac.Core;
using UnityEngine;

namespace KerbTac.Recorder
{
    /// <summary>
    /// Builds position-only keyframes for vessels that are not loaded. KSP's
    /// Orbit API is valid for on-rails vessels and avoids creating a full
    /// PartModule sample for every satellite in the save.
    /// </summary>
    internal static class UnloadedPositionSampler
    {
        private static CelestialBody _trackedBody;
        private static ObservedBodyRotation _rotation = new ObservedBodyRotation();

        /// <summary>
        /// Sample the actual transform, which KSP can freeze during warp.
        /// Catch-up keyframes use their own UT within the observed interval.
        /// </summary>
        public static void ObserveBodyRotation(CelestialBody body, double ut, bool reset = false)
        {
            if (reset || body != _trackedBody)
            {
                _trackedBody = body;
                _rotation = new ObservedBodyRotation();
            }
            if (body != null && body.bodyTransform != null)
                _rotation.Observe(ut, BodyCatalog.ToQuatd(body.bodyTransform.rotation));
        }

        private static Quatd BodyRotation(CelestialBody body, double ut)
        {
            if (body == _trackedBody)
            {
                return _rotation.At(ut);
            }
            return BodyCatalog.ToQuatd(body.bodyTransform.rotation);
        }

        public static ObservedBodyRotation BeginBatch(CelestialBody body, double lastSampleUt,
            Quatd? lastSampleRotation)
        {
            if (body != _trackedBody) return null;
            return lastSampleRotation.HasValue
                ? _rotation.ForBatch(lastSampleUt, lastSampleRotation.Value)
                : _rotation;
        }

        public static bool IsStaticSituation(Vessel vessel)
        {
            var situation = vessel.situation;
            return situation == Vessel.Situations.LANDED
                || situation == Vessel.Situations.SPLASHED
                || situation == Vessel.Situations.PRELAUNCH;
        }

        public static double DistanceMeters(Vessel active, Vessel other, double ut)
        {
            if (active == null || other == null)
            {
                return double.PositiveInfinity;
            }

            var body = other.mainBody ?? active.mainBody;
            if (body == null)
            {
                return double.PositiveInfinity;
            }

            // Landed/prelaunch vessels (including the active one) have
            // degenerate orbits. Resolve every vessel through the same
            // body-fixed frame so a launchpad recording still sees the
            // unloaded satellites around it.
            var a = BodyFixedPosition(active, ut, body);
            var b = BodyFixedPosition(other, ut, body);
            double distance;
            if (!BodyFixed.TryDistance(a, b, out distance))
            {
                return double.PositiveInfinity;
            }
            return distance;
        }

        private static Vec3d BodyFixedPosition(Vessel vessel, double ut, CelestialBody body)
        {
            if (IsStaticSituation(vessel) || vessel.orbit == null)
            {
                return BodyFixed.FromLatLonAlt(
                    vessel.latitude,
                    vessel.longitude,
                    vessel.altitude,
                    body.Radius);
            }

            var relative = vessel.orbit.getRelativePositionAtUT(ut);
            return BodyFixed.FromRelative(
                new Vec3d(relative.x, relative.y, relative.z),
                BodyRotation(body, ut));
        }

        public static VesselSample Capture(Vessel vessel, double ut, Quatd? rotation,
            double longitudeCorrection = 0.0)
        {
            var body = vessel.mainBody;
            double lat;
            double lon;
            double alt;

            if (IsStaticSituation(vessel))
            {
                // Landed, splashed and prelaunch vessels already report their
                // body-fixed position; their Orbit can be stale or meaningless.
                lat = vessel.latitude;
                lon = vessel.longitude;
                alt = vessel.altitude;
            }
            else
            {
                var relative = vessel.orbit.getRelativePositionAtUT(ut);
                // KSP Orbit vectors are YZ-flipped; convert through the
                // geographic orientation at the keyframe's own UT.
                var bodyFixed = BodyFixed.FromRelative(
                    new Vec3d(relative.x, relative.y, relative.z),
                    rotation ?? BodyRotation(body, ut));
                BodyFixed.ToLatLonAlt(
                    bodyFixed,
                    body.Radius,
                    out lat,
                    out lon,
                    out alt);
                lon = OrbitBatchCorrection.Wrap(lon + longitudeCorrection);
            }

            return VesselSample.PositionOnly(
                ut,
                lat,
                lon,
                alt,
                Attitude(vessel, body, lat, lon),
                vessel.situation.ToString());
        }

        private static Quatd Attitude(Vessel vessel, CelestialBody body, double lat, double lon)
        {
            // Loaded vessels (including the active one during warp) have a
            // real control reference; use the same convention as full-rate
            // samples. Unloaded vessels have no parts, so use the local
            // north/up frame instead of writing raw srfRelRotation.
            if (vessel.loaded && body != null && body.bodyTransform != null &&
                vessel.ReferenceTransform != null)
            {
                // The control transform is live, not reconstructed at the
                // historical keyframe UT. Use its corresponding live frame.
                var inverseBody = BodyCatalog.ToQuatd(body.bodyTransform.rotation).Conjugate();
                var reference = vessel.ReferenceTransform;
                var q = Quatd.FromKspReference(
                    inverseBody.Rotate(new Vec3d(
                        reference.forward.x, reference.forward.y, reference.forward.z)),
                    inverseBody.Rotate(new Vec3d(
                        reference.up.x, reference.up.y, reference.up.z)));
                if (q.IsFinite)
                {
                    return q.Normalized();
                }
            }

            return BodyFixed.SurfaceAttitude(lat, lon);
        }
    }
}
