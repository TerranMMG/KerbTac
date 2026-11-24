namespace KerbTac.Core
{
    /// <summary>A named chapter marker on the replay timeline.</summary>
    public sealed class ChapterInfo
    {
        public string Id;
        public string Name;
        public double StartUt;
        public double EndUt;
        public string Reason;
    }
}
