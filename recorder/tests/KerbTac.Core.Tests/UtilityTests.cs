using System;
using System.Collections.Generic;
using System.IO;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class UtilityTests
    {
        [Fact]
        public void SanitizeRemovesWindowsInvalidCharacters()
        {
            Assert.Equal("F-16_Test_v2", FileNameUtil.Sanitize("F-16/Test:v2"));
            Assert.Equal("a_b_c", FileNameUtil.Sanitize("a\\b*c"));
        }

        [Fact]
        public void SanitizeTruncatesLongNames()
        {
            string result = FileNameUtil.Sanitize(new string('x', 100));
            Assert.Equal(40, result.Length);
        }

        [Fact]
        public void SanitizeFallsBackForEmptyInput()
        {
            Assert.Equal("recording", FileNameUtil.Sanitize(""));
            Assert.Equal("recording", FileNameUtil.Sanitize("   "));
        }

        [Fact]
        public void RecordingFileNameFollowsPlanConvention()
        {
            string name = FileNameUtil.BuildRecordingFileName(
                "MNCS", "F-16 Test", new DateTime(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc));

            Assert.Equal("MNCS_F-16 Test_20261103-120000.kerbtac", name);
        }

        [Fact]
        public void UniquePathAddsSuffix()
        {
            string dir = Path.Combine(Path.GetTempPath(), "kerbtac-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                string first = Path.Combine(dir, "a.kerbtac");
                File.WriteAllText(first, "");
                string unique = FileNameUtil.EnsureUnique(dir, "a.kerbtac");
                Assert.Equal(Path.Combine(dir, "a_2.kerbtac"), unique);
            }
            finally
            {
                Directory.Delete(dir, true);
            }
        }

        [Fact]
        public void RingBufferHandsOutOldestSamples()
        {
            SampleRingBuffer buffer = new SampleRingBuffer(4);
            for (int i = 0; i < 4; i++)
            {
                buffer.Add(new VesselSample { T = i });
            }

            Assert.True(buffer.IsFull);
            List<VesselSample> taken = buffer.TakeOldest(2);

            Assert.Equal(2, taken.Count);
            Assert.Equal(0.0, taken[0].T);
            Assert.Equal(1.0, taken[1].T);
            Assert.Equal(2, buffer.Count);
            Assert.Equal(2.0, buffer.OldestT);

            buffer.Add(new VesselSample { T = 4 });
            List<VesselSample> all = buffer.Drain();
            Assert.Equal(3, all.Count);
            Assert.Equal(4.0, all[2].T);
            Assert.Equal(0, buffer.Count);
        }

        [Fact]
        public void PaletteIsStableForSameId()
        {
            Assert.Equal(ColorPalette.ForId("abc"), ColorPalette.ForId("abc"));
            Assert.StartsWith("#", ColorPalette.Get(0));
        }
    }
}
