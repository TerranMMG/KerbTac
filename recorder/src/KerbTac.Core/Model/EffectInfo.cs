namespace KerbTac.Core
{
    /// <summary>A countermeasure / particle burst spawn point.</summary>
    public sealed class EffectInfo
    {
        public double Ut;
        public string Kind;
        public string Body;
        public string SourceId;
        public string TargetId;
        public double Lat;
        public double Lon;
        public double Alt;
        public int Count = 1;
        public int Seed;
        public double Vx;
        public double Vy;
        public double Vz;
        public double Spread;
        public double Life = 1.0;
    }
}
