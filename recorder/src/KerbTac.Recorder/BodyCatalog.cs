using System;
using System.Collections.Generic;
using KerbTac.Core;
using UnityEngine;

namespace KerbTac.Recorder
{
    /// <summary>
    /// Captures the celestial bodies referenced by a vessel, including their
    /// ancestors, into the v1 bodies.json model.
    /// </summary>
    internal static class BodyCatalog
    {
        public static Dictionary<string, BodyDef> Capture(Vessel vessel)
        {
            Dictionary<string, BodyDef> result = new Dictionary<string, BodyDef>();
            if (vessel == null || vessel.mainBody == null)
            {
                return result;
            }

            // M3 replays a single SOI. Recording only the main body as a root
            // keeps bodies.json small and avoids drawing the parent star.
            BodyDef def = CreateRoot(vessel.mainBody);
            result[def.Name] = def;
            return result;
        }

        public static string BodyName(CelestialBody body)
        {
            if (body == null)
            {
                return null;
            }
            return string.IsNullOrEmpty(body.bodyName) ? body.name : body.bodyName;
        }

        private static BodyDef CreateRoot(CelestialBody body)
        {
            Quatd q0 = Quatd.Identity;

            try
            {
                if (body.bodyTransform != null)
                {
                    q0 = ToQuatd(body.bodyTransform.rotation);
                }
            }
            catch (Exception ex)
            {
                Log.Exception("Failed to compute rotation for " + BodyName(body), ex);
            }

            double rate = 0.0;
            if (body.rotationPeriod > 1.0)
            {
                rate = 360.0 / body.rotationPeriod;
            }

            return new BodyDef
            {
                Name = BodyName(body),
                Parent = null,
                Radius = body.Radius,
                GravParameter = body.gravParameter,
                AtmosphereDepth = body.atmosphereDepth,
                SphereOfInfluence = body.sphereOfInfluence,
                Style = (BodyName(body) ?? "default").ToLowerInvariant(),
                Rotation = new BodyRotationDef
                {
                    EpochUt = Planetarium.GetUniversalTime(),
                    Q0 = new[] { q0.X, q0.Y, q0.Z, q0.W },
                    Axis = new[] { 0.0, 1.0, 0.0 },
                    RateDegPerSec = rate
                },
                // M3 only needs the frozen body-fixed frame.
                Orbit = null
            };
        }

        public static Quatd ToQuatd(Quaternion q)
        {
            return new Quatd(q.x, q.y, q.z, q.w);
        }
    }
}
