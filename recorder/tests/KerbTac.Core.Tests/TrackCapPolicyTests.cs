using System;
using System.Collections.Generic;
using KerbTac.Core.Sampling;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class TrackCapPolicyTests
    {
        [Fact]
        public void FindsFarthestEvictableTrackWhenCandidateIsNearer()
        {
            var distances = new List<double> { 100, 500, 900 };
            var evictable = new List<bool> { true, true, true };

            Assert.Equal(2, TrackCapPolicy.FindFarthestEvictable(
                distances, evictable, 300));
        }

        [Fact]
        public void DoesNotEvictTracksCloserThanCandidate()
        {
            var distances = new List<double> { 100, 500, 900 };
            var evictable = new List<bool> { true, true, true };

            Assert.Equal(-1, TrackCapPolicy.FindFarthestEvictable(
                distances, evictable, 1000));
        }

        [Fact]
        public void NeverEvictsLoadedOrActiveTracks()
        {
            var distances = new List<double> { 100, 900 };
            var evictable = new List<bool> { false, false };

            Assert.Equal(-1, TrackCapPolicy.FindFarthestEvictable(
                distances, evictable, 50));
        }

        [Fact]
        public void HandlesTheFullCapOf128Tracks()
        {
            var distances = new List<double>();
            var evictable = new List<bool>();
            for (int i = 0; i < 128; i++)
            {
                distances.Add(1000 + i);
                evictable.Add(true);
            }

            int index = TrackCapPolicy.FindFarthestEvictable(
                distances, evictable, 500);
            Assert.Equal(127, index);
        }
    }
}
