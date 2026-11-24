using System;

namespace KerbTac.Core
{
    /// <summary>Recording mode constants and the launch-site default rule.</summary>
    public static class RecordingModeResolver
    {
        public const string Combat = "combat";
        public const string Space = "space";
        public const string Auto = "auto";

        /// <summary>Normalizes a stored setting to auto, combat, or space.</summary>
        public static string Normalize(string setting)
        {
            string value = (setting ?? string.Empty).Trim().ToLowerInvariant();
            if (value == Space) return Space;
            if (value == Combat) return Combat;
            return Auto;
        }

        /// <summary>
        /// Resolves the mode once, when recording starts. Only the auto setting
        /// looks at the launch site: Runway means Combat, LaunchPad means Space.
        /// </summary>
        public static string Resolve(string setting, string landedAt)
        {
            string value = (setting ?? string.Empty).Trim().ToLowerInvariant();
            if (value == Space)
            {
                return Space;
            }
            if (value == Combat)
            {
                return Combat;
            }

            string site = (landedAt ?? string.Empty).Trim().ToLowerInvariant();
            if (site.Contains("launchpad") || site.Contains("launch pad"))
            {
                return Space;
            }
            return Combat;
        }
    }
}
