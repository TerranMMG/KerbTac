using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using KerbTac.Core;
using KerbTac.Recorder;
using UnityEngine;
using Xunit.Abstractions;

namespace KerbTac.Recorder.Tests;

[Collection("KSP flight globals")]
public sealed class RecordingSessionSaveTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "kerbtac-session-" + Guid.NewGuid().ToString("N"));
    private readonly ITestOutputHelper _output;
    private readonly List<string> _saved = new();
    private readonly List<string> _errors = new();
    private readonly List<string> _warnings = new();
    private readonly RecordingSaveQueue _saveQueue;

    public RecordingSessionSaveTests(ITestOutputHelper output)
    {
        _output = output;
        _saveQueue = new RecordingSaveQueue(_saved.Add, _warnings.Add, _errors.Add);
    }

    private (RecordingSession Session, string Temp, double Ut) Record(
        int samples, Func<Stream, Stream> wrapArchiveOutput = null, string vesselName = "Trainer")
    {
        HighLogic.SaveFolder = "test";
        var body = new CelestialBody
        {
            bodyName = "Kerbin", Radius = 600_000, rotationPeriod = 21_600,
            bodyTransform = new Transform { rotation = Quaternion.identity }
        };
        var vessel = new Vessel
        {
            id = Guid.NewGuid(), vesselName = vesselName, vesselType = VesselType.Plane,
            mainBody = body, loaded = true, situation = Vessel.Situations.FLYING,
            ReferenceTransform = new Transform()
        };
        FlightGlobals.Bodies = new List<CelestialBody> { body };
        FlightGlobals.Vessels = new List<Vessel> { vessel };
        FlightGlobals.VesselsLoaded = new List<Vessel> { vessel };
        FlightGlobals.ActiveVessel = vessel;
        var settings = KerbTacSettings.Load(_root);
        settings.RecordCombatDetail = false;
        var session = new RecordingSession(settings, _saveQueue, wrapArchiveOutput);
        session.Start(vessel, "test", 1000, DateTime.UtcNow);
        for (int i = 0; i < samples; i++)
            session.FixedTick(vessel, settings.SampleInterval, 1000 + i * 0.125);
        Assert.Equal(RecorderState.Recording, session.State);
        Assert.Equal(samples, session.SampleCount);
        return (session, Path.Combine(settings.RecordingsDirectory, ".tmp_" + session.SessionId), 1000 + samples * 0.125);
    }

    private const string CentralDirectoryFault = "injected central-directory write failure";

    [Fact]
    public void CentralDirectoryWriteFailureDoesNotPublishOrDiscardSpills()
    {
        var (session, temp, ut) = Record(1950,
            stream => new CentralDirectoryStream(stream, () => throw new IOException(CentralDirectoryFault)));
        string[] chunks = Chunks(temp);
        Assert.Equal(2, chunks.Length);
        byte[][] originals = chunks.Select(File.ReadAllBytes).ToArray();

        session.Stop("test", ut);
        AwaitSave(session);

        Assert.Equal(RecorderState.Error, session.State);
        Assert.Contains(CentralDirectoryFault, session.LastError);
        Assert.Contains(temp, session.LastError);
        Assert.Null(session.LastFilePath);
        Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.kerbtac"));
        Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.partial"));
        for (int i = 0; i < chunks.Length; i++)
            Assert.Equal(originals[i], File.ReadAllBytes(chunks[i]));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void PersistentReceiverReportsAfterFlightAddonIsDestroyed(bool fail)
    {
        using var closedFlight = new ManualResetEventSlim();
        using var finishing = new ManualResetEventSlim();
        var (session, temp, _) = Record(1950, stream => new CentralDirectoryStream(stream, () =>
        {
            finishing.Set();
            if (!closedFlight.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException();
            if (fail) throw new IOException(CentralDirectoryFault);
        }));
        var receiver = new RecordingSaveAddon { Queue = _saveQueue };
        var flight = new KerbTacAddon { Session = session };
        var exitTime = Stopwatch.StartNew();
        flight.OnDestroy();
        _output.WriteLine($"Flight destroy={exitTime.Elapsed.TotalMilliseconds:F3}ms (failure={fail})");
        try
        {
            Assert.Null(flight.Session);
            Assert.True(finishing.Wait(TimeSpan.FromSeconds(5)));
            Assert.Empty(_saved);
            Assert.Empty(_errors);
            Assert.True(Directory.Exists(temp));
        }
        finally { closedFlight.Set(); }

        Assert.True(SpinWait.SpinUntil(() =>
        {
            receiver.Update();
            return _saved.Count + _errors.Count != 0;
        }, TimeSpan.FromSeconds(10)));
        receiver.Update();
        if (fail)
        {
            string error = Assert.Single(_errors);
            Assert.Contains(CentralDirectoryFault, error);
            Assert.Contains(temp, error);
            Assert.Equal(3, Chunks(temp).Length);
            Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.kerbtac"));
            Assert.Empty(_saved);
        }
        else
        {
            string path = Assert.Single(Directory.GetFiles(session.RecordingsDirectory, "*.kerbtac"));
            Assert.Contains(path, Assert.Single(_saved));
            Assert.False(Directory.Exists(temp));
            Assert.Empty(_errors);
        }
    }

    [Fact]
    public void ProcessQuitWaitsForSavesDetachedFromFlightWithOneSharedBudget()
    {
        using var release = new ManualResetEventSlim();
        using var finishing = new CountdownEvent(2);
        Stream Gated(Stream stream) => new CentralDirectoryStream(stream, () =>
        {
            finishing.Signal();
            if (!release.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException();
        });

        var first = Record(1950, Gated);
        new KerbTacAddon { Session = first.Session }.OnDestroy();
        var second = Record(1950, Gated, "Second trainer");
        new KerbTacAddon { Session = second.Session }.OnDestroy();
        try
        {
            Assert.True(finishing.Wait(TimeSpan.FromSeconds(5)));
            var receiver = new RecordingSaveAddon { Queue = _saveQueue, ExitWaitMilliseconds = 200 };
            var elapsed = Stopwatch.StartNew();
            receiver.OnApplicationQuit();
            _output.WriteLine($"Quit budget 200ms for two detached saves: {elapsed.Elapsed.TotalMilliseconds:F3}ms");
            Assert.InRange(elapsed.Elapsed.TotalMilliseconds, 100, 360);
            Assert.Empty(_saved);
            Assert.Equal(2, _warnings.Count);
            Assert.Contains(_warnings, text => text.Contains(first.Temp));
            Assert.Contains(_warnings, text => text.Contains(second.Temp));
            Assert.Empty(Directory.GetFiles(first.Session.RecordingsDirectory, "*.kerbtac"));
        }
        finally
        {
            release.Set();
            _saveQueue.WaitForExit(10_000);
        }
        Assert.Equal(2, _saved.Count);
        Assert.Empty(_errors);
    }

    private sealed class CentralDirectoryStream(Stream inner, Action onCentralDirectory) : Stream
    {
        private bool _triggered;
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => inner.CanSeek;
        public override bool CanWrite => inner.CanWrite;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => inner.Position = value; }
        public override void Flush() => inner.Flush();
        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
        public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
        public override void SetLength(long value) => inner.SetLength(value);
        public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));
        public override void Write(ReadOnlySpan<byte> buffer)
        {
            if (!_triggered && buffer.SequenceEqual(new byte[] { 0x50, 0x4b, 0x01, 0x02 }))
            {
                _triggered = true;
                onCentralDirectory();
            }
            inner.Write(buffer);
        }
    }

    private static string[] Chunks(string temp) =>
        Directory.GetFiles(Path.Combine(temp, "segments"), "*.json").OrderBy(p => p).ToArray();

    private static void AwaitSave(RecordingSession session)
    {
        Assert.True(SpinWait.SpinUntil(() =>
        {
            session.TickFinalize();
            return session.State != RecorderState.Finalizing;
        }, TimeSpan.FromSeconds(15)));
    }

    [Fact]
    public void MissingSecondSpillDoesNotDeleteTheFirstOrReportSaved()
    {
        var (session, temp, ut) = Record(1950);
        string[] chunks = Chunks(temp);
        Assert.Equal(2, chunks.Length);
        byte[] intact = File.ReadAllBytes(chunks[0]);
        File.Delete(chunks[1]);

        session.Stop("test", ut);
        AwaitSave(session);

        Assert.Equal(RecorderState.Error, session.State);
        Assert.True(File.Exists(chunks[0]), "A previously written spill must survive Stop failure.");
        Assert.Equal(intact, File.ReadAllBytes(chunks[0]));
        Assert.Contains(temp, session.LastError);
        Assert.Null(session.LastFilePath);
        Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.kerbtac"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DamagedSecondSpillIsNotPublishedEvenIfItsLengthStillMatches(bool sameLength)
    {
        var (session, temp, ut) = Record(1950);
        string[] chunks = Chunks(temp);
        Assert.Equal(2, chunks.Length);
        byte[] intact = File.ReadAllBytes(chunks[0]);
        byte[] damaged = sameLength ? File.ReadAllBytes(chunks[1]) : new byte[] { (byte)'{' };
        if (sameLength) damaged[0] = (byte)'!';
        File.WriteAllBytes(chunks[1], damaged);

        session.Stop("test", ut);
        AwaitSave(session);

        Assert.Equal(RecorderState.Error, session.State);
        Assert.Equal(intact, File.ReadAllBytes(chunks[0]));
        Assert.Equal(damaged, File.ReadAllBytes(chunks[1]));
        Assert.Contains(temp, session.LastError);
        Assert.Contains(Path.GetFileName(chunks[1]), session.LastError);
        Assert.Null(session.LastFilePath);
        Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.kerbtac"));
        Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.partial"));
    }

    [Fact]
    public void BlockedTailWriteLeavesPriorSpillsAndRecoveryPath()
    {
        var (session, temp, ut) = Record(1950);
        string[] chunks = Chunks(temp);
        Assert.Equal(2, chunks.Length);
        Directory.CreateDirectory(Path.Combine(temp, "segments", "2.json"));

        session.Stop("test", ut);
        AwaitSave(session);

        Assert.Equal(RecorderState.Error, session.State);
        Assert.True(Directory.Exists(temp), "The spill directory must survive Stop failure.");
        Assert.Equal(chunks, Chunks(temp));
        Assert.Contains(temp, session.LastError);
        Assert.Null(session.LastFilePath);
        Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.kerbtac"));
    }

    [Theory]
    [InlineData(1950)]
    [InlineData(60150)]
    public void SuccessfulStopPublishesReadableWholeTrackThenRemovesSpills(int samples)
    {
        var (session, temp, ut) = Record(samples);
        int oldChunks = Chunks(temp).Length;
        long allocatedBefore = GC.GetAllocatedBytesForCurrentThread();
        long memoryBefore = GC.GetTotalMemory(forceFullCollection: true);
        long observedPeak = memoryBefore;
        var elapsed = Stopwatch.StartNew();
        session.Stop("test", ut);
        double stopMs = elapsed.Elapsed.TotalMilliseconds;
        long stopAllocated = GC.GetAllocatedBytesForCurrentThread() - allocatedBefore;
        bool completed = SpinWait.SpinUntil(() =>
        {
            observedPeak = Math.Max(observedPeak, GC.GetTotalMemory(forceFullCollection: false));
            session.TickFinalize();
            return session.State != RecorderState.Finalizing;
        }, TimeSpan.FromSeconds(15));
        long memoryAfter = GC.GetTotalMemory(forceFullCollection: false);
        _output.WriteLine($"samples={samples}, spills={oldChunks}, stop={stopMs:F3}ms, stop allocations={stopAllocated:N0}B, whole save={elapsed.Elapsed.TotalMilliseconds:F3}ms, managed memory before/observed peak/after={memoryBefore:N0}/{observedPeak:N0}/{memoryAfter:N0}B");
        Assert.True(completed);
        Assert.Equal(RecorderState.Idle, session.State);
        Assert.False(Directory.Exists(temp));
        using var archive = ZipFile.OpenRead(session.LastFilePath);
        using var trackStream = archive.Entries.Single(e => e.FullName.StartsWith("vessels/")).Open();
        using var track = JsonDocument.Parse(trackStream);
        var segments = track.RootElement.GetProperty("segments").EnumerateArray().ToArray();
        Assert.Equal(oldChunks + 1, segments.Length);
        Assert.Equal(samples, segments.Sum(segment => segment.GetProperty("samples").GetProperty("t").GetArrayLength()));
        Assert.True(stopAllocated < 64_000, $"Stop allocated {stopAllocated:N0} B on the caller.");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SceneExitDoesNotWaitForSlowSpillAndFinalNameAppearsOnlyAfterCompletion(bool collision)
    {
        // A real, gated input stream: mkfifo is available on the POSIX test runners.
        if (OperatingSystem.IsWindows()) return;
        var (session, temp, ut) = Record(1950);
        string spill = Chunks(temp)[0];
        byte[] original = File.ReadAllBytes(spill);
        File.Delete(spill);
        using var mkfifo = Process.Start("mkfifo", spill);
        await mkfifo.WaitForExitAsync();
        Assert.Equal(0, mkfifo.ExitCode);
        using var allowWrite = new ManualResetEventSlim();
        using var connected = new ManualResetEventSlim();
        Task producer = Task.Run(() =>
        {
            using var sink = File.OpenWrite(spill);
            connected.Set();
            allowWrite.Wait(TimeSpan.FromSeconds(15));
            sink.Write(original);
        });
        DateTime beforeStop = DateTime.UtcNow;
        Task sceneExit = Task.Run(() =>
        {
            session.Stop("test", ut);
            session.Shutdown();
        });
        List<string> competingPaths = new();
        try
        {
            Assert.True(connected.Wait(TimeSpan.FromSeconds(10)));
            await sceneExit.WaitAsync(TimeSpan.FromSeconds(2));
            Assert.Equal(RecorderState.Finalizing, session.State);
            Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.kerbtac"));
            Assert.Single(Directory.GetFiles(session.RecordingsDirectory, "*.partial"));
            Assert.True(Directory.Exists(temp));
            if (collision)
            {
                // The output name was selected before the worker started reading.
                DateTime afterStop = DateTime.UtcNow;
                for (DateTime t = beforeStop; t <= afterStop.AddSeconds(1); t = t.AddSeconds(1))
                {
                    string path = Path.Combine(session.RecordingsDirectory,
                        FileNameUtil.BuildRecordingFileName("test", "Trainer", t));
                    File.WriteAllText(path, "competing recording");
                    competingPaths.Add(path);
                }
            }
        }
        finally
        {
            allowWrite.Set();
            await producer.WaitAsync(TimeSpan.FromSeconds(15));
            await sceneExit.WaitAsync(TimeSpan.FromSeconds(15));
            AwaitSave(session);
        }
        Assert.Empty(Directory.GetFiles(session.RecordingsDirectory, "*.partial"));
        if (collision)
        {
            Assert.Equal(RecorderState.Error, session.State);
            Assert.Null(session.LastFilePath);
            Assert.Contains(temp, session.LastError);
            Assert.Equal(3, Chunks(temp).Length);
            Assert.All(competingPaths, path => Assert.Equal("competing recording", File.ReadAllText(path)));
        }
        else
        {
            Assert.Equal(RecorderState.Idle, session.State);
            using var archive = ZipFile.OpenRead(session.LastFilePath);
            Assert.NotNull(archive.GetEntry("manifest.json"));
        }
    }

    [Fact]
    public void ApplicationQuitWaitsForSaveFromActiveFlight()
    {
        var (session, temp, _) = Record(1950);
        KerbTacAddon.Instance = new KerbTacAddon { Session = session };
        try { new RecordingSaveAddon { Queue = _saveQueue }.OnApplicationQuit(); }
        finally { KerbTacAddon.Instance = null; }
        string path = Assert.Single(Directory.GetFiles(session.RecordingsDirectory, "*.kerbtac"));
        Assert.Contains(path, Assert.Single(_saved));
        Assert.False(Directory.Exists(temp));
        using var archive = ZipFile.OpenRead(path);
        using var eventStream = archive.GetEntry("events.json")!.Open();
        using var events = JsonDocument.Parse(eventStream);
        var end = events.RootElement.EnumerateArray().Last(e => e.GetProperty("type").GetString() == "flight_end");
        Assert.Equal("application_quit", end.GetProperty("data").GetProperty("reason").GetString());
    }

    public void Dispose()
    {
        _saveQueue.WaitForExit(10_000);
        FlightGlobals.ActiveVessel = null;
        FlightGlobals.Vessels.Clear();
        FlightGlobals.VesselsLoaded.Clear();
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
