namespace KerbTac.Core
{
    /// <summary>A radar/IR lock interval between a source and a target.</summary>
    public sealed class RadarLockInfo
    {
        public string SourceId;
        public string TargetId;
        public string Sensor;
        public string Mode;
        public double StartUt;
        public double EndUt;
    }
}
