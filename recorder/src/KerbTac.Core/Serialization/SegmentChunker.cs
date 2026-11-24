using System;

namespace KerbTac.Core
{
    /// <summary>Logical flight boundaries shared by spilled storage chunks.</summary>
    public static class SegmentChunker
    {
        /// <summary>
        /// Starts a new logical flight after the previous buffer has been
        /// flushed. Storage chunks restart at zero for the new flight.
        /// </summary>
        public static void BeginNewFlight(TrackSegment tail)
        {
            if (tail == null)
            {
                throw new ArgumentNullException("tail");
            }
            tail.LogicalIndex++;
            tail.ChunkIndex = 0;
        }
    }
}
