using System.Collections.Generic;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class SegmentChunkTests
    {
        private static int CountOccurrences(string text, string needle)
        {
            int count = 0;
            int index = 0;
            while ((index = text.IndexOf(needle, index, System.StringComparison.Ordinal)) >= 0)
            {
                count++;
                index += needle.Length;
            }
            return count;
        }

        [Fact]
        public void ThreeChunksShareOneLogicalIndex()
        {
            var vessel = new VesselInfo { Id = "v" };
            for (int i = 0; i < 3; i++)
            {
                vessel.Segments.Add(new TrackSegment
                {
                    LogicalIndex = 0, ChunkIndex = i, Kind = SegmentKinds.Flight,
                    Samples = new List<VesselSample> { new VesselSample { T = i * 60.0 } }
                });
            }
            string json = SessionSerializer.WriteVessel(vessel);
            Assert.Contains("\"logicalIndex\":0", json);
            Assert.Contains("\"chunkIndex\":2", json);
            Assert.Equal(3, CountOccurrences(json, "\"samples\""));
        }

        [Fact]
        public void SegmentWritesChunkDefaults()
        {
            string json = SessionSerializer.WriteSegment(new TrackSegment
            {
                Samples = new List<VesselSample> { new VesselSample { T = 1 } }
            });
            Assert.Contains("\"logicalIndex\":0", json);
            Assert.Contains("\"chunkIndex\":0", json);
        }

        [Fact]
        public void BeginningANewFlightAdvancesLogicalIndexAndResetsChunk()
        {
            var tail = new TrackSegment { LogicalIndex = 2, ChunkIndex = 4 };
            SegmentChunker.BeginNewFlight(tail);
            Assert.Equal(3, tail.LogicalIndex);
            Assert.Equal(0, tail.ChunkIndex);
        }
    }
}
