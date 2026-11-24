using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace KerbTac.Core
{
    /// <summary>Builds the final .kerbtac ZIP archive from session data.</summary>
    public static class RecordingArchive
    {
        public static string Create(
            string tempDir,
            string outputPath,
            SessionInfo session,
            IList<VesselInfo> vessels,
            IDictionary<string, BodyDef> bodies,
            IList<KerbTacEvent> events,
            IDictionary<string, IList<string>> segmentsByVessel)
        {
            return Create(
                tempDir,
                outputPath,
                session,
                vessels,
                bodies,
                events,
                segmentsByVessel,
                new List<ActorInfo>(),
                new List<EffectInfo>(),
                new List<RadarLockInfo>(),
                null);
        }

        public static string Create(
            string tempDir,
            string outputPath,
            SessionInfo session,
            IList<VesselInfo> vessels,
            IDictionary<string, BodyDef> bodies,
            IList<KerbTacEvent> events,
            IDictionary<string, IList<string>> segmentsByVessel,
            IList<ActorInfo> actors,
            IList<EffectInfo> effects,
            IList<RadarLockInfo> locks,
            SummaryInfo summary)
        {
            return CreateStreaming(outputPath, session, vessels, bodies, events,
                delegate(string id)
                {
                    IList<string> segments;
                    return segmentsByVessel.TryGetValue(id, out segments) ? segments : new string[0];
                }, actors, effects, locks, summary);
        }

        /// <summary>
        /// Reads each track's segments lazily. Stages in the destination directory
        /// and publishes only a completed ZIP; the caller owns its source spills.
        /// </summary>
        public static string CreateStreaming(
            string outputPath,
            SessionInfo session,
            IList<VesselInfo> vessels,
            IDictionary<string, BodyDef> bodies,
            IList<KerbTacEvent> events,
            Func<string, IEnumerable<string>> readSegments,
            IList<ActorInfo> actors,
            IList<EffectInfo> effects,
            IList<RadarLockInfo> locks,
            SummaryInfo summary)
        {
            return CreateStreaming(outputPath, session, vessels, bodies, events, readSegments,
                actors, effects, locks, summary, null);
        }

        // A decorator can observe ZIP writes without taking ownership of the
        // staging file or replacing the archive transaction.
        internal static string CreateStreaming(
            string outputPath,
            SessionInfo session,
            IList<VesselInfo> vessels,
            IDictionary<string, BodyDef> bodies,
            IList<KerbTacEvent> events,
            Func<string, IEnumerable<string>> readSegments,
            IList<ActorInfo> actors,
            IList<EffectInfo> effects,
            IList<RadarLockInfo> locks,
            SummaryInfo summary,
            Func<Stream, Stream> wrapOutput)
        {
            string fullOutput = Path.GetFullPath(outputPath);
            string outputDir = Path.GetDirectoryName(fullOutput);
            Directory.CreateDirectory(outputDir);
            string tempZip = Path.Combine(outputDir, ".kerbtac-" + Guid.NewGuid().ToString("N") + ".partial");
            bool ownsTemp = false;
            try
            {
                using (FileStream stream = new FileStream(tempZip, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    ownsTemp = true;
                    using (Stream decorated = wrapOutput != null ? wrapOutput(stream) : null)
                    {
                        WriteArchive(decorated ?? stream, session, vessels, bodies, events, readSegments,
                            actors, effects, locks, summary);
                    }
                    stream.Flush(true);
                }

                Publish(tempZip, fullOutput);
                return outputPath;
            }
            finally
            {
                if (ownsTemp)
                {
                    try { File.Delete(tempZip); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
        }

        private static void WriteArchive(
            Stream output,
            SessionInfo session,
            IList<VesselInfo> vessels,
            IDictionary<string, BodyDef> bodies,
            IList<KerbTacEvent> events,
            Func<string, IEnumerable<string>> readSegments,
            IList<ActorInfo> actors,
            IList<EffectInfo> effects,
            IList<RadarLockInfo> locks,
            SummaryInfo summary)
        {
            bool hasActors = actors != null && actors.Count > 0;
            bool hasEffects = effects != null && effects.Count > 0;
            bool hasLocks = locks != null && locks.Count > 0;
            bool hasSummary = summary != null;
            using (ZipWriter zip = new ZipWriter(output, true))
            {
                zip.AddText("README.txt", SessionSerializer.WriteReadme(session, vessels, events, summary));
                zip.AddText("manifest.json", SessionSerializer.WriteManifest(session, vessels, hasActors, hasEffects, hasLocks, hasSummary));
                zip.AddText("bodies.json", SessionSerializer.WriteBodies(bodies));
                zip.AddText("events.json", SessionSerializer.WriteEvents(events));
                if (hasActors) zip.AddText("actors.json", SessionSerializer.WriteActors(actors));
                if (hasEffects) zip.AddText("effects.json", SessionSerializer.WriteEffects(effects));
                if (hasLocks) zip.AddText("locks.json", SessionSerializer.WriteLocks(locks));
                if (hasSummary) zip.AddText("summary.json", SessionSerializer.WriteSummary(summary));

                for (int i = 0; i < vessels.Count; i++)
                {
                    VesselInfo vessel = vessels[i];
                    zip.AddStreamedEntry(SessionSerializer.TrackPath(vessel.Id), delegate(Stream entry)
                    {
                        using (StreamWriter text = new StreamWriter(entry, new UTF8Encoding(false), 4096, true))
                        {
                            SessionSerializer.WriteVessel(text, vessel, readSegments(vessel.Id));
                        }
                    });
                }
                zip.Finish();
            }
        }

        private static void Publish(string staging, string destination)
        {
            // A native no-replace operation avoids check-then-rename races and
            // the copy fallbacks that some runtimes use for File.Move.
            bool success = Path.DirectorySeparatorChar == '\\'
                ? MoveFile(staging, destination)
                : Link(staging, destination) == 0;
            if (!success)
            {
                int error = Marshal.GetLastWin32Error();
                throw new IOException("Could not publish recording to " + destination +
                    " (OS error " + error + "); an existing destination was not replaced.");
            }
        }

        [DllImport("kernel32.dll", EntryPoint = "MoveFileW", CharSet = CharSet.Unicode,
            SetLastError = true, ExactSpelling = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool MoveFile(string existing, string destination);

        [DllImport("libc", EntryPoint = "link", SetLastError = true)]
        private static extern int Link(string existing, string destination);
    }
}
