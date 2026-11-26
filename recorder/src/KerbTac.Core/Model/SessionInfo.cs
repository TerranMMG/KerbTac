using System;
using System.Collections.Generic;
using System.Globalization;

namespace KerbTac.Core
{
    /// <summary>Session-wide metadata written to manifest.json.</summary>
    public sealed class SessionInfo
    {
        public string Id;
        public string Name;
        public string SaveName;
        public string Scene = "FLIGHT";
        public string KspVersion = "unknown";
        public string UnityVersion;
        public double StartUt;
        public double EndUt;
        public DateTime StartWallUtc = DateTime.UtcNow;
        public DateTime EndWallUtc = DateTime.UtcNow;
        public string GeneratorName = "KerbTac Recorder";
        public string GeneratorVersion = KerbTacVersion.RecorderVersion;

        public MissionInfo Mission;

        /// <summary>"combat" or "space"; null in recordings made before v1.3.</summary>
        public string RecordingMode;

        public List<SessionGap> Gaps = new List<SessionGap>();
        public List<ChapterInfo> Chapters = new List<ChapterInfo>();

        /// <summary>Reference UT for T+ display; defaults to StartUt for old files.</summary>
        public double Ut0;

        public double Duration
        {
            get { return Math.Max(0.0, EndUt - StartUt); }
        }

        public static string FormatIsoUtc(DateTime utc)
        {
            return utc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
        }

        /// <summary>Creates a session id such as 20261103T120000Z-a1b2c3.</summary>
        public static string NewId(DateTime utc)
        {
            string stamp = utc.ToUniversalTime()
                .ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
            string suffix = Guid.NewGuid().ToString("N").Substring(0, 6);
            return stamp + "-" + suffix;
        }
    }

    /// <summary>Version constants shared by the recorder and the format writer.</summary>
    public static class KerbTacVersion
    {
        public const string RecorderVersion = "0.1.1";
        public const int FormatVersion = 1;
        public const int FormatRevision = 4;
        public const string FormatName = "kerbtac";
    }
}
