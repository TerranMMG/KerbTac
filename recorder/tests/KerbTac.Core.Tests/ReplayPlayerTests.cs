using System.Diagnostics;

namespace KerbTac.Core.Tests;

public sealed class ReplayPlayerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "KerbTac test " + Guid.NewGuid());

    [Fact]
    public void OpensTheBundledHtmlUsingTheShell()
    {
        var html = Path.Combine(_root, "Player", "index.html");
        Directory.CreateDirectory(Path.GetDirectoryName(html)!);
        File.WriteAllText(html, "<title>KerbTac</title>");
        ProcessStartInfo? launched = null;

        KerbTac.Recorder.ReplayPlayer.Open(_root, info => launched = info);

        Assert.NotNull(launched);
        Assert.Equal(html, launched.FileName);
        Assert.True(launched.UseShellExecute);
    }

    [Fact]
    public void MissingHtmlDoesNotLaunchTheBrowser()
    {
        var error = Assert.Throws<FileNotFoundException>(() =>
            KerbTac.Recorder.ReplayPlayer.Open(_root, _ => Assert.Fail("Unexpected launch")));
        Assert.Equal(Path.Combine(_root, "Player", "index.html"), error.FileName);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
