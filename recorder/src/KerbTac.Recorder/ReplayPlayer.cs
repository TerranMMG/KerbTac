using System;
using System.Diagnostics;
using System.IO;

namespace KerbTac.Recorder
{
    internal static class ReplayPlayer
    {
        public static void Open(string modDirectory, Action<ProcessStartInfo> start)
        {
            string path = Path.GetFullPath(Path.Combine(modDirectory, "Player", "index.html"));
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Bundled replay player not found. Reinstall the KerbTac mod ZIP.", path);
            }

            start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
        }
    }
}
