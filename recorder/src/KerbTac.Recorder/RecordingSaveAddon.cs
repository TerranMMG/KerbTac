using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using KSP;
using UnityEngine;

namespace KerbTac.Recorder
{
    // Only plain save data is registered here; no Flight or Vessel callbacks.
    internal abstract class RecordingSaveJob
    {
        public string TempDirectory;
        public string OutputPath;
        public Thread Worker;
        public volatile bool Done;
        public string Error;
        public string CleanupError;

        public string FailureMessage
        {
            get
            {
                string target = OutputPath != null ? " " + OutputPath : "";
                return "Failed to write archive" + target + ": " + Error +
                    "\nRecoverable chunks (if written): " + TempDirectory;
            }
        }
    }

    /// <summary>Main-thread registry for pending saves, independent of the Flight scene.</summary>
    internal sealed class RecordingSaveQueue
    {
        internal static readonly RecordingSaveQueue Shared = new RecordingSaveQueue(Log.Info, Log.Warn, Log.Error);

        private readonly List<RecordingSaveJob> _pending = new List<RecordingSaveJob>();
        private readonly Action<string> _info;
        private readonly Action<string> _warn;
        private readonly Action<string> _error;

        public RecordingSaveQueue(Action<string> info, Action<string> warn, Action<string> error)
        {
            _info = info;
            _warn = warn;
            _error = error;
        }

        public void Start(RecordingSaveJob save)
        {
            _pending.Add(save);
            try { save.Worker.Start(); }
            catch
            {
                _pending.Remove(save);
                throw;
            }
        }

        public void ReportCompleted()
        {
            for (int i = _pending.Count - 1; i >= 0; i--)
            {
                RecordingSaveJob save = _pending[i];
                if (!save.Done) continue;
                _pending.RemoveAt(i);
                if (save.Error != null)
                {
                    _error(save.FailureMessage);
                    continue;
                }
                if (save.CleanupError != null)
                {
                    _warn("Could not delete temp directory " + save.TempDirectory + ": " + save.CleanupError);
                }
                _info("Recording saved: " + save.OutputPath);
            }
        }

        public void WaitForExit(int timeoutMilliseconds)
        {
            Stopwatch elapsed = Stopwatch.StartNew();
            for (int i = 0; i < _pending.Count; i++)
            {
                RecordingSaveJob save = _pending[i];
                int remaining = (int)Math.Max(0L, timeoutMilliseconds - elapsed.ElapsedMilliseconds);
                if (!save.Done && remaining > 0) save.Worker.Join(remaining);
            }
            ReportCompleted();
            foreach (RecordingSaveJob save in _pending)
            {
                _warn("Archive writer still busy at application exit; recovery directory: " + save.TempDirectory);
            }
        }
    }

    /// <summary>Receives save results on Unity's main thread, including after leaving Flight.</summary>
    [KSPAddon(KSPAddon.Startup.MainMenu, true)]
    public sealed class RecordingSaveAddon : MonoBehaviour
    {
        internal RecordingSaveQueue Queue = RecordingSaveQueue.Shared;
        internal int ExitWaitMilliseconds = 10000;

        internal void Awake()
        {
            DontDestroyOnLoad(gameObject);
        }

        internal void Update()
        {
            Queue.ReportCompleted();
        }

        internal void OnApplicationQuit()
        {
            // Unity does not guarantee callback order between objects. Start the
            // active Flight save here before waiting on the shared queue.
            KerbTacAddon flight = KerbTacAddon.Instance;
            try
            {
                if (flight != null && flight.Session != null)
                {
                    flight.Session.Shutdown(applicationQuitting: true);
                }
            }
            finally
            {
                Queue.WaitForExit(ExitWaitMilliseconds);
            }
        }
    }
}
