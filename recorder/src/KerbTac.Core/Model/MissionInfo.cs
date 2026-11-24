using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>Optional mission briefing/debriefing metadata (format revision 2).</summary>
    public sealed class MissionInfo
    {
        public string Title;
        public string Category;
        public string Briefing;
        public string Debriefing;
        public string Theater;
        public string Author;
        public string Notes;
        public List<string> Tags = new List<string>();
    }
}
