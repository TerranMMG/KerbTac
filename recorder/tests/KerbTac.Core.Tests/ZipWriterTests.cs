using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class ZipWriterTests
    {
        private static ZipArchive Read(byte[] bytes)
        {
            return new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read, false, Encoding.UTF8);
        }

        private sealed class CentralDirectoryFailure : MemoryStream
        {
            public int Attempts { get; private set; }

            public override void Write(ReadOnlySpan<byte> buffer)
            {
                if (buffer.SequenceEqual(new byte[] { 0x50, 0x4b, 0x01, 0x02 }) && ++Attempts == 1)
                    throw new IOException("injected central-directory failure");
                base.Write(buffer);
            }
        }

        [Fact]
        public void FailedFinishIsNotRetriedByDisposal()
        {
            using var output = new CentralDirectoryFailure();
            var writer = new ZipWriter(output);
            writer.AddText("manifest.json", "{}");
            Assert.Throws<IOException>(writer.Finish);
            writer.Dispose();
            Assert.Equal(1, output.Attempts);
            Assert.Throws<InvalidDataException>(() => Read(output.ToArray()));
        }

        [Theory]
        [InlineData(true, 8)]
        [InlineData(false, 0)]
        public void StreamedEntryRoundTripsWithCrcAndSizes(bool allowDeflate, ushort method)
        {
            byte[] first = Encoding.UTF8.GetBytes(new string('a', 8000));
            byte[] last = Encoding.UTF8.GetBytes("尾段");
            byte[] expected = first.Concat(last).ToArray();
            using var output = new MemoryStream();
            using (var writer = new ZipWriter(output, allowDeflate))
            {
                writer.AddStreamedEntry("track.json", stream =>
                {
                    stream.Write(first, 0, first.Length);
                    stream.Write(last, 0, last.Length);
                });
                writer.AddText("next.txt", "done");
                writer.Finish();
            }

            byte[] bytes = output.ToArray();
            Assert.Equal(method, BitConverter.ToUInt16(bytes, 8));
            Assert.Equal(Crc32.Compute(expected), BitConverter.ToUInt32(bytes, 14));
            Assert.Equal((uint)expected.Length, BitConverter.ToUInt32(bytes, 22));
            using ZipArchive archive = Read(bytes);
            using Stream entry = archive.GetEntry("track.json")!.Open();
            using var read = new MemoryStream();
            entry.CopyTo(read);
            Assert.Equal(expected, read.ToArray());
            Assert.NotNull(archive.GetEntry("next.txt"));
        }

        [Fact]
        public void RoundTripsEntriesWithDeflate()
        {
            MemoryStream output = new MemoryStream();
            using (ZipWriter writer = new ZipWriter(output, true))
            {
                writer.AddText("manifest.json", "{\"format\":\"kerbtac\"}");
                writer.AddText("vessels/abc.json", new string('x', 5000));
                writer.Finish();
            }

            byte[] bytes = output.ToArray();
            Assert.Equal(0x50, bytes[0]);
            Assert.Equal(0x4B, bytes[1]);

            using ZipArchive archive = Read(bytes);
            Assert.Equal(2, archive.Entries.Count);

            using StreamReader manifest = new StreamReader(archive.GetEntry("manifest.json")!.Open());
            Assert.Equal("{\"format\":\"kerbtac\"}", manifest.ReadToEnd());

            using StreamReader track = new StreamReader(archive.GetEntry("vessels/abc.json")!.Open());
            Assert.Equal(5000, track.ReadToEnd().Length);
        }

        [Fact]
        public void StoredModeIsAlsoValid()
        {
            MemoryStream output = new MemoryStream();
            using (ZipWriter writer = new ZipWriter(output, false))
            {
                writer.AddText("a.txt", "hello");
                writer.Finish();
            }

            using ZipArchive archive = Read(output.ToArray());
            using StreamReader reader = new StreamReader(archive.GetEntry("a.txt")!.Open());
            Assert.Equal("hello", reader.ReadToEnd());
        }

        [Fact]
        public void DeflateReducesRepetitivePayload()
        {
            byte[] payload = Encoding.UTF8.GetBytes(new string('a', 20000));

            MemoryStream compressed = new MemoryStream();
            using (ZipWriter writer = new ZipWriter(compressed, true))
            {
                writer.AddEntry("data.txt", payload);
                writer.Finish();
            }

            MemoryStream stored = new MemoryStream();
            using (ZipWriter writer = new ZipWriter(stored, false))
            {
                writer.AddEntry("data.txt", payload);
                writer.Finish();
            }

            Assert.True(compressed.Length < stored.Length / 10);
        }

        [Fact]
        public void BackslashesAreNormalizedToSlashes()
        {
            MemoryStream output = new MemoryStream();
            using (ZipWriter writer = new ZipWriter(output, false))
            {
                writer.AddText("vessels\\abc.json", "{}");
                writer.Finish();
            }

            using ZipArchive archive = Read(output.ToArray());
            Assert.NotNull(archive.GetEntry("vessels/abc.json"));
        }

        [Fact]
        public void Utf8EntryNamesSurvive()
        {
            MemoryStream output = new MemoryStream();
            using (ZipWriter writer = new ZipWriter(output, false))
            {
                writer.AddText("vessels/测试.json", "{}");
                writer.Finish();
            }

            using ZipArchive archive = Read(output.ToArray());
            Assert.NotNull(archive.GetEntry("vessels/测试.json"));
        }

        [Fact]
        public void Crc32MatchesKnownVector()
        {
            byte[] data = Encoding.ASCII.GetBytes("123456789");
            Assert.Equal(0xCBF43926u, Crc32.Compute(data));
            Assert.Equal(0u, Crc32.Compute(new byte[0]));
        }

        [Fact]
        public void LocalHeaderCarriesCorrectCrcAndSizes()
        {
            byte[] payload = Encoding.ASCII.GetBytes("hello world");
            MemoryStream output = new MemoryStream();
            using (ZipWriter writer = new ZipWriter(output, false))
            {
                writer.AddText("a.txt", "hello world");
                writer.Finish();
            }

            byte[] bytes = output.ToArray();
            uint crc = BitConverter.ToUInt32(bytes, 14);
            uint compressedSize = BitConverter.ToUInt32(bytes, 18);
            uint uncompressedSize = BitConverter.ToUInt32(bytes, 22);

            Assert.Equal(Crc32.Compute(payload), crc);
            Assert.Equal((uint)payload.Length, compressedSize);
            Assert.Equal((uint)payload.Length, uncompressedSize);
        }
    }
}
