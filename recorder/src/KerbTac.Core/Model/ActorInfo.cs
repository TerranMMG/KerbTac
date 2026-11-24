using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>A short-lived object (missile, shell, debris) with its own track.</summary>
    public sealed class ActorInfo
    {
        public string Id;
        public string Name;
        public string Kind;
        public string Side = "neutral";
        public string ParentId;
        public string TargetId;
        public string Weapon;
        public string Body;
        public List<VesselSample> Samples = new List<VesselSample>();
        public double StartUt;
        public double EndUt;
    }
}
