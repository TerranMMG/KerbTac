namespace KerbTac.Core
{
    /// <summary>A pause or missing-data interval in the recording timeline.</summary>
    public sealed class SessionGap
    {
        public double StartUt;
        public double EndUt;
        public string Reason;
    }
}
