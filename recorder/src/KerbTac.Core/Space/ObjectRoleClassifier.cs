using System;

namespace KerbTac.Core
{
    /// <summary>Maps vessel type plus part evidence to a format v1.3 model role.</summary>
    public static class ObjectRoleClassifier
    {
        public static string Classify(string vesselType, RoleFeatures features, string landedAt = null,
            bool onLand = false)
        {
            RoleFeatures f = features ?? new RoleFeatures();
            string type = (vesselType ?? string.Empty).Trim().ToLowerInvariant();
            if (f.IsFairing && type == "debris")
            {
                return "space.fairing";
            }
            if (f.IsStage)
            {
                return "space.stage";
            }

            bool launchPad = RecordingModeResolver.Resolve(RecordingModeResolver.Auto, landedAt) ==
                             RecordingModeResolver.Space;
            if (type == "probe" || type == "relay" || type == "station")
            {
                if (type == "probe" && onLand && !f.StartedSplashed && f.HasWheel)
                {
                    return Ground(f);
                }
                if (type == "probe" && launchPad && !f.StartedSplashed &&
                    f.HasRocketEngine && f.HasDecoupler)
                {
                    return "space.rocket";
                }
                // Satellites and stations keep the player's VesselType preset;
                // even a station with engines/decouplers must not become a
                // ground vehicle or a rocket marker.
                return null;
            }

            if (f.StartedSplashed)
            {
                return "sea.ship";
            }

            // A rocket still attached to its boosters is reported as Ship by
            // KSP; the engine + decoupler pair is what makes it a rocket.
            if (type == "lander")
            {
                return null;
            }
            if (f.HasRocketEngine && (f.HasDecoupler || (type == "ship" && launchPad)))
            {
                return "space.rocket";
            }

            switch (type)
            {
                case "ship":
                    return "sea.ship";
                case "plane":
                    return f.HasWeapon || f.HasLauncher ? "air.fighter" : "air.support";
                case "rover":
                case "base":
                    return Ground(f);
                case "probe":
                case "relay":
                case "station":
                    // Satellites and stations keep the player's VesselType
                    // preset; returning a role here would override it.
                    return null;
                case "debris":
                    return "debris";
            }

            if (f.HasWheel)
            {
                return "ground.vehicle";
            }
            if (f.HasRotor)
            {
                return "air.support";
            }
            if (f.HasWeapon || f.HasLauncher)
            {
                return "air.fighter";
            }
            return "unknown";
        }

        private static string Ground(RoleFeatures f)
        {
            if (f.HasRadar && f.HasLauncher)
            {
                return "ground.sam";
            }
            if (f.HasRadar)
            {
                return "ground.radar";
            }
            if (f.HasLauncher)
            {
                return "ground.launcher";
            }
            return "ground.vehicle";
        }
    }
}
