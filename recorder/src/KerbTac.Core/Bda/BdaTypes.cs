namespace KerbTac
{
    /// <summary>Optional BDArmory data for one vessel at one instant.</summary>
    public struct BdaVesselSnapshot
    {
        public string Team;
        public string Side;
        public float Health;
        public string PrimaryWeapon;
        public string LockedTargetId;
        public int FiredMissiles;
    }

    /// <summary>A radar/IR lock interval reported by BDArmory.</summary>
    public struct BdaLockSnapshot
    {
        public string SourceId;
        public string TargetId;
        public string Sensor;
        public string Mode;
        public double StartUt;
        public double EndUt;
    }

    /// <summary>A one-shot countermeasure or impact effect with deterministic particles.</summary>
    public struct BdaEffectSnapshot
    {
        public double Ut;
        public string Kind;
        public string Body;
        public string SourceId;
        public string TargetId;
        public double Lat;
        public double Lon;
        public double Alt;
        public int Count;
        public int Seed;
        public double Vx;
        public double Vy;
        public double Vz;
        public double Spread;
        public double Life;
    }
}
