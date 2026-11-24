using KerbTac.Core;
using UnityEngine;

namespace KerbTac.Recorder
{
    /// <summary>
    /// Converts a live Vessel into a body-fixed <see cref="VesselSample"/>.
    /// All orientation math is done with our own double-precision quaternions
    /// so the result is independent of Unity's left-handed conventions.
    /// </summary>
    internal static class VesselSampler
    {
        public static VesselSample Capture(Vessel vessel, double ut)
        {
            CelestialBody body = vessel.mainBody;
            Quatd bodyRotation = body != null && body.bodyTransform != null
                ? BodyCatalog.ToQuatd(body.bodyTransform.rotation)
                : Quatd.Identity;
            Quatd inverseBody = bodyRotation.Conjugate();

            // Use the control reference transform: the root part's axes can be
            // rotated arbitrarily (stack axis, docking ports), while the
            // reference transform is the frame KSP itself uses for control and
            // heading. Fall back to the root part when no reference is set.
            Transform reference = vessel.ReferenceTransform != null
                ? vessel.ReferenceTransform
                : vessel.transform;
            // KSP's control reference transform uses +Y as forward and +Z as
            // down. Convert to the format's +Z-forward / +Y-up convention.
            Quatd attitude = Quatd.FromKspReference(
                inverseBody.Rotate(new Vec3d(reference.forward.x, reference.forward.y, reference.forward.z)),
                inverseBody.Rotate(new Vec3d(reference.up.x, reference.up.y, reference.up.z)));
            if (!attitude.IsFinite)
            {
                attitude = Quatd.Identity;
            }

            Vec3d velocityBf = inverseBody.Rotate(new Vec3d(
                vessel.srf_velocity.x,
                vessel.srf_velocity.y,
                vessel.srf_velocity.z));

            double lat = Safe(vessel.latitude);
            double lon = Safe(vessel.longitude);
            double alt = Safe(vessel.altitude);
            FlightAngles angles = FlightAngles.Compute(velocityBf.X, velocityBf.Y, velocityBf.Z);

            VesselSample sample = new VesselSample
            {
                T = ut,
                Latitude = ClampLatitude(lat),
                Longitude = WrapLongitude(lon),
                Altitude = alt,
                Attitude = attitude,
                VelocityX = Finite(velocityBf.X),
                VelocityY = Finite(velocityBf.Y),
                VelocityZ = Finite(velocityBf.Z),
                Throttle = vessel.ctrlState != null && Vec3d.IsFiniteNumber(vessel.ctrlState.mainThrottle)
                    ? Mathf.Clamp(vessel.ctrlState.mainThrottle, 0f, 1f) : (float?)null,
                Mass = Finite(vessel.GetTotalMass() * 1000.0), // KSP reports tonnes; format uses kg.
                GeeForce = Finite(vessel.geeForce),
                Stage = vessel.currentStage,
                Situation = vessel.situation.ToString(),
                VerticalSpeed = Finite(vessel.verticalSpeed),
                SurfaceSpeed = Finite(vessel.srfSpeed),
                Ias = Finite(vessel.indicatedAirSpeed),
                Mach = Finite(vessel.mach),
                Aoa = velocityBf.IsFinite ? Finite(angles.Aoa) : null,
                Aos = velocityBf.IsFinite ? Finite(angles.Aos) : null,
                Agl = Finite(vessel.radarAltitude),
                DynPressure = Finite(vessel.dynamicPressurekPa),
                PitchInput = vessel.ctrlState != null ? Finite(vessel.ctrlState.pitch) : null,
                RollInput = vessel.ctrlState != null ? Finite(vessel.ctrlState.roll) : null,
                YawInput = vessel.ctrlState != null ? Finite(vessel.ctrlState.yaw) : null,
                Gear = vessel.ActionGroups != null ? (vessel.ActionGroups[KSPActionGroup.Gear] ? 1 : 0) : (double?)null,
                Brakes = vessel.ActionGroups != null ? (vessel.ActionGroups[KSPActionGroup.Brakes] ? 1 : 0) : (double?)null
            };

            sample.Heading = attitude.HeadingDegrees(sample.Latitude, sample.Longitude);

            ReadResources(vessel, ref sample);

            return sample;
        }

        /// <summary>True if any part on the vessel carries a resource container.</summary>
        public static bool HasResourceModules(Vessel vessel)
        {
            if (vessel == null || vessel.parts == null)
            {
                return false;
            }
            for (int i = 0; i < vessel.parts.Count; i++)
            {
                Part part = vessel.parts[i];
                if (part != null && part.Resources != null && part.Resources.Count > 0)
                {
                    return true;
                }
            }
            return false;
        }

        private static void ReadResources(Vessel vessel, ref VesselSample sample)
        {
            if (vessel.parts == null)
            {
                return;
            }

            for (int i = 0; i < vessel.parts.Count; i++)
            {
                Part part = vessel.parts[i];
                if (part == null || part.Resources == null)
                {
                    continue;
                }

                foreach (PartResource resource in part.Resources)
                {
                    if (resource == null)
                    {
                        continue;
                    }
                    switch (resource.resourceName)
                    {
                        case "LiquidFuel": AddResource(ref sample.LiquidFuel, resource.amount); break;
                        case "Oxidizer": AddResource(ref sample.Oxidizer, resource.amount); break;
                        case "ElectricCharge": AddResource(ref sample.ElectricCharge, resource.amount); break;
                        case "MonoPropellant": AddResource(ref sample.MonoPropellant, resource.amount); break;
                    }
                }
            }
        }

        private static void AddResource(ref double? total, double amount)
        {
            // Retain non-finite totals until serialization, which omits them.
            // A sum with even one invalid container is not a measured total.
            total = total.GetValueOrDefault() + amount;
        }

        public static string PartName(Part part)
        {
            if (part == null)
            {
                return "unknown";
            }
            if (part.partInfo != null && !string.IsNullOrEmpty(part.partInfo.name))
            {
                return part.partInfo.name;
            }
            return part.name ?? "unknown";
        }

        private static double Safe(double value)
        {
            return Vec3d.IsFiniteNumber(value) ? value : 0.0;
        }

        private static double? Finite(double value)
        {
            return Vec3d.IsFiniteNumber(value) ? value : (double?)null;
        }

        private static double ClampLatitude(double lat)
        {
            if (lat > 90.0) return 90.0;
            if (lat < -90.0) return -90.0;
            return lat;
        }

        private static double WrapLongitude(double lon)
        {
            while (lon >= 180.0) lon -= 360.0;
            while (lon < -180.0) lon += 360.0;
            return lon;
        }
    }
}
