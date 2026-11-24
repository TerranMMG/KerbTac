namespace KerbTac.Core
{
    /// <summary>
    /// Maps KSP's VesselType plus part features to the format's stable kind
    /// strings. The replay player uses these to pick a model preset.
    /// </summary>
    public static class VesselKindClassifier
    {
        public static string Classify(
            string vesselType,
            bool hasRotor,
            bool hasWheel,
            bool hasLiftingSurface,
            bool hasFireControl,
            bool hasPilotAi)
        {
            string type = (vesselType ?? string.Empty).Trim().ToLowerInvariant();
            switch (type)
            {
                case "plane":
                    return hasRotor ? "air/rotary" : "air/fixedwing";
                case "rover":
                    return "ground/vehicle";
                case "ship":
                    return "sea/ship";
                case "base":
                case "flag":
                    return "ground/structure";
                case "station":
                case "probe":
                case "relay":
                case "lander":
                    return "space/vessel";
                case "debris":
                    return "debris";
                case "eva":
                    return "eva";
                case "spaceobject":
                    return "unknown";
            }

            if (hasRotor)
            {
                return "air/rotary";
            }
            if (hasWheel)
            {
                return "ground/vehicle";
            }
            if (hasLiftingSurface)
            {
                return "air/fixedwing";
            }
            if (hasFireControl || hasPilotAi)
            {
                return "air/fixedwing";
            }

            return "unknown";
        }
    }
}
