using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using Xunit;

namespace KerbTac.Core.Tests;

public sealed class ArchiveReadmeTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "kerbtac-readme-" + Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void FinalZipReadmeSharesActualEventAndSummaryData(bool streaming)
    {
        var session = new SessionInfo
        {
            Name = "Session name", Mission = new MissionInfo { Title = "Northern Traverse" },
            StartUt = 400, EndUt = 430, KspVersion = "1.12.5.3190",
            StartWallUtc = new DateTime(2026, 11, 24, 12, 0, 0, DateTimeKind.Utc),
            EndWallUtc = new DateTime(2026, 11, 24, 12, 0, 30, DateTimeKind.Utc),
        };
        session.Chapters.Add(new ChapterInfo { Name = "Arrival", StartUt = 410, EndUt = 418 });
        var vessels = new List<VesselInfo> { new VesselInfo { Id = "r1", Name = "Surveyor" } };
        var events = new List<KerbTacEvent>
        {
            new KerbTacEvent { Ut = 400, Type = EventTypes.FlightStart },
            new KerbTacEvent { Ut = 408, Type = EventTypes.Note },
            new KerbTacEvent { Ut = 425, Type = EventTypes.Note },
        };
        // The readable archive consumes the same precomputed statistics as summary.json;
        // none of this telemetry is retained in VesselInfo.Segments.
        var stats = new VesselSummaryStats();
        stats.Observe(new VesselSample { T = 400, Altitude = 100, SurfaceSpeed = 70 }, "Kerbin", 600000);
        stats.Observe(new VesselSample { T = 430, Altitude = 4321.25, SurfaceSpeed = 234.5, Mach = 0.75, GeeForce = 2.25 },
            "Kerbin", 600000);
        var summary = SummaryBuilder.Build(session, vessels, events, null, null,
            new Dictionary<string, VesselSummaryStats> { ["r1"] = stats });
        using var zip = ZipFile.OpenRead(Write(streaming, session, vessels, events, summary));
        var readme = Read(zip, "README.txt");
        Assert.Contains("Mission: Northern Traverse", readme);
        Assert.Contains("Created: 2026-11-24T12:00:00Z", readme);
        Assert.Contains("Finished: 2026-11-24T12:00:30Z", readme);
        Assert.Contains("KSP: 1.12.5.3190", readme);
        Assert.Contains("Chapters: 1", readme);
        Assert.Contains("Arrival", readme);
        Assert.Contains("Vessels: 1", readme);
        Assert.Contains("Surveyor", readme);
        Assert.Contains("Events: 3", readme);
        Assert.Contains("flight_start: 1", readme);
        Assert.Contains("note: 2", readme);
        Assert.Contains("Missing optional columns or null cells mean unknown.", readme);
        Assert.Contains("t must be strictly increasing", readme);
        Assert.Contains("Required columns: t, lat, lon, alt, q", readme);
        Assert.Contains("q has 4N values", readme);
        Assert.Contains("the later chunk wins", readme);
        Assert.Contains("boundary=true marks a position jump", readme);
        using var json = JsonDocument.Parse(Read(zip, "summary.json"));
        var totals = json.RootElement.GetProperty("session");
        Assert.Equal(4321.25, totals.GetProperty("maxAltitude").GetDouble());
        Assert.Contains($"Max altitude: {totals.GetProperty("maxAltitude").GetRawText()} m", readme);
        Assert.Contains($"Max speed: {totals.GetProperty("maxSpeed").GetRawText()} m/s", readme);
        Assert.Contains("Max Mach: 0.75", readme);
        Assert.Contains("Max g-force: 2.25 g", readme);
        Assert.Contains("Duration: 30 s", readme);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, true)]
    public void FinalZipReadmeIsUsefulWhenSummaryIsAbsent(bool streaming, bool empty)
    {
        var session = new SessionInfo { Name = "Untitled sortie" };
        var vessels = new List<VesselInfo>();
        var events = new List<KerbTacEvent>();
        if (!empty)
        {
            vessels.Add(new VesselInfo { Id = "r1", Name = "Surveyor" });
            events.Add(new KerbTacEvent { Type = EventTypes.Note });
        }
        using var zip = ZipFile.OpenRead(Write(streaming, session, vessels, events, null));
        Assert.Null(zip.GetEntry("summary.json"));
        var readme = Read(zip, "README.txt");
        Assert.Contains("Mission: Untitled sortie", readme);
        Assert.Contains("Chapters: 0", readme);
        Assert.Contains(empty ? "Vessels: 0" : "Vessels: 1", readme);
        Assert.Contains(empty ? "Events: 0" : "note: 1", readme);
        Assert.Contains("Statistics: unavailable", readme);
        Assert.DoesNotContain("Max altitude:", readme);
    }

    private string Write(bool streaming, SessionInfo session, List<VesselInfo> vessels,
        List<KerbTacEvent> events, SummaryInfo? summary)
    {
        var output = Path.Combine(_root, "recording.kerbtac");
        var bodies = new Dictionary<string, BodyDef>();
        return streaming
            ? RecordingArchive.CreateStreaming(output, session, vessels, bodies, events,
                _ => Array.Empty<string>(), null, null, null, summary)
            : RecordingArchive.Create(_root, output, session, vessels, bodies, events,
                new Dictionary<string, IList<string>>(), null, null, null, summary);
    }

    private static string Read(ZipArchive zip, string entry)
    {
        using var reader = new StreamReader(zip.GetEntry(entry)!.Open());
        return reader.ReadToEnd();
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
