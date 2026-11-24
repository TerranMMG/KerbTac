using System.IO.Compression;
using System.Text.Json;
using KerbTac.Core;

namespace KerbTac.Core.Tests;

public class SelfTestRecordingTests
{
    private static string ReadEntry(ZipArchive zip, string name)
    {
        ZipArchiveEntry entry = zip.GetEntry(name) ?? throw new InvalidOperationException($"missing entry {name}");
        using StreamReader reader = new StreamReader(entry.Open());
        return reader.ReadToEnd();
    }

    [Fact]
    public void WritesArchiveThatSatisfiesFormatV1()
    {
        string directory = Path.Combine(Path.GetTempPath(), "kerbtac-selftest-" + Guid.NewGuid().ToString("N"));
        try
        {
            DateTime utc = new DateTime(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc);
            string path = SelfTestRecording.Write(directory, utc, "1.12.5.3190");

            Assert.True(File.Exists(path));
            Assert.EndsWith(".kerbtac", path);
            Assert.True(new FileInfo(path).Length > 500);

            using ZipArchive zip = ZipFile.OpenRead(path);
            Assert.NotNull(zip.GetEntry("README.txt"));
            Assert.NotNull(zip.GetEntry("bodies.json"));
            Assert.NotNull(zip.GetEntry("events.json"));

            string manifest = ReadEntry(zip, "manifest.json");
            using JsonDocument manifestDoc = JsonDocument.Parse(manifest);
            JsonElement root = manifestDoc.RootElement;
            Assert.Equal("kerbtac", root.GetProperty("format").GetString());
            Assert.Equal(1, root.GetProperty("formatVersion").GetInt32());
            Assert.Equal("1.12.5.3190", root.GetProperty("game").GetProperty("kspVersion").GetString());
            JsonElement vessel = root.GetProperty("vessels")[0];
            string vesselId = vessel.GetProperty("id").GetString()!;
            Assert.Equal("vessels/" + vesselId + ".json", vessel.GetProperty("track").GetString());

            using JsonDocument eventsDoc = JsonDocument.Parse(ReadEntry(zip, "events.json"));
            Assert.Equal(6, eventsDoc.RootElement.GetArrayLength());
            Assert.NotNull(zip.GetEntry("actors.json"));
            Assert.NotNull(zip.GetEntry("effects.json"));
            Assert.NotNull(zip.GetEntry("locks.json"));
            Assert.NotNull(zip.GetEntry("summary.json"));
            Assert.Equal(2, root.GetProperty("vessels").GetArrayLength());
            Assert.Equal("KerbTac Self Test", root.GetProperty("mission").GetProperty("title").GetString());

            using JsonDocument actorDoc = JsonDocument.Parse(ReadEntry(zip, "actors.json"));
            Assert.Equal("weapon/missile", actorDoc.RootElement.GetProperty("actors")[0].GetProperty("kind").GetString());

            using JsonDocument trackDoc = JsonDocument.Parse(ReadEntry(zip, "vessels/" + vesselId + ".json"));
            JsonElement segment = trackDoc.RootElement.GetProperty("segments")[0];
            JsonElement samples = segment.GetProperty("samples");
            Assert.Equal(SelfTestRecording.SampleCount, samples.GetProperty("t").GetArrayLength());
            Assert.Equal(SelfTestRecording.SampleCount, samples.GetProperty("lat").GetArrayLength());
            Assert.Equal(SelfTestRecording.SampleCount, samples.GetProperty("q").GetArrayLength() / 4);
            Assert.Equal(SelfTestRecording.SampleCount, samples.GetProperty("lf").GetArrayLength());
            Assert.Equal("flight", segment.GetProperty("kind").GetString());
        }
        finally
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }
        }
    }

    [Fact]
    public void SecondRunGetsUniqueFileName()
    {
        string directory = Path.Combine(Path.GetTempPath(), "kerbtac-selftest-" + Guid.NewGuid().ToString("N"));
        try
        {
            DateTime utc = new DateTime(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc);
            string first = SelfTestRecording.Write(directory, utc, "1.12.5.3190");
            string second = SelfTestRecording.Write(directory, utc, "1.12.5.3190");
            Assert.NotEqual(first, second);
            Assert.True(File.Exists(first));
            Assert.True(File.Exists(second));
        }
        finally
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }
        }
    }
}
