using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace KerbTac.Core
{
    /// <summary>File naming rules from the plan (§16.3).</summary>
    public static class FileNameUtil
    {
        private const int MaxVesselLength = 40;

        private static readonly char[] Invalid = { '\\', '/', ':', '*', '?', '"', '<', '>', '|' };

        public static string Sanitize(string value, int maxLength = MaxVesselLength)
        {
            if (string.IsNullOrEmpty(value))
            {
                return "recording";
            }

            StringBuilder sb = new StringBuilder(value.Length);
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                bool invalid = false;
                for (int j = 0; j < Invalid.Length; j++)
                {
                    if (c == Invalid[j])
                    {
                        invalid = true;
                        break;
                    }
                }
                if (invalid || c < 0x20)
                {
                    sb.Append('_');
                }
                else
                {
                    sb.Append(c);
                }
            }

            string result = sb.ToString().Trim().TrimEnd('.');
            if (result.Length > maxLength)
            {
                result = result.Substring(0, maxLength).Trim();
            }
            return result.Length == 0 ? "recording" : result;
        }

        /// <summary>
        /// Builds "&lt;saveName&gt;_&lt;vesselName&gt;_&lt;yyyyMMdd-HHmmss&gt;.kerbtac".
        /// </summary>
        public static string BuildRecordingFileName(string saveName, string vesselName, DateTime utc)
        {
            string save = Sanitize(string.IsNullOrEmpty(saveName) ? "KSP" : saveName, 24);
            string vessel = Sanitize(string.IsNullOrEmpty(vesselName) ? "vessel" : vesselName);
            string stamp = utc.ToUniversalTime()
                .ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            return save + "_" + vessel + "_" + stamp + ".kerbtac";
        }

        /// <summary>Adds _2, _3... until the path does not exist.</summary>
        public static string EnsureUnique(string directory, string fileName)
        {
            string path = Path.Combine(directory, fileName);
            if (!File.Exists(path))
            {
                return path;
            }

            string baseName = Path.GetFileNameWithoutExtension(fileName);
            string extension = Path.GetExtension(fileName);
            for (int i = 2; i < 1000; i++)
            {
                string candidate = Path.Combine(directory, baseName + "_" + i + extension);
                if (!File.Exists(candidate))
                {
                    return candidate;
                }
            }
            return Path.Combine(directory, baseName + "_" + Guid.NewGuid().ToString("N").Substring(0, 6) + extension);
        }
    }

    /// <summary>Deterministic replay colors for vessels.</summary>
    public static class ColorPalette
    {
        private static readonly string[] Colors =
        {
            "#4fc3f7", // cyan
            "#ff8a65", // orange
            "#81c784", // green
            "#ba68c8", // purple
            "#ffd54f", // amber
            "#e57373", // red
            "#4db6ac", // teal
            "#f06292", // pink
            "#9575cd", // violet
            "#a1887f"  // brown
        };

        public static string Get(int index)
        {
            if (index < 0)
            {
                index = 0;
            }
            return Colors[index % Colors.Length];
        }

        public static string ForId(string vesselId)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                return Colors[0];
            }
            int hash = 0;
            for (int i = 0; i < vesselId.Length; i++)
            {
                hash = unchecked(hash * 31 + vesselId[i]);
            }
            return Get(Math.Abs(hash));
        }
    }
}
