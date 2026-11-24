using System.Collections.Generic;

namespace KerbTac.Core
{
    public static class SegmentBoundary
    {
        /// <summary>Keep the closing sample at the boundary, if present.</summary>
        public static int TrimToUt(List<VesselSample> samples, double ut)
        {
            samples.RemoveAll(sample => sample.T > ut);
            return samples.Count;
        }

        /// <summary>The new sampling schedule is anchored at the transition UT.</summary>
        public static double NextStartUt(double ut)
        {
            return ut;
        }

        public static List<VesselSample> ClosePrevious(SampleRingBuffer buffer, double ut)
        {
            List<VesselSample> samples = buffer.Drain();
            TrimToUt(samples, ut);
            return samples;
        }

        /// <summary>Only a segment's unclaimed first instant may equal the cursor.</summary>
        public static bool CanCaptureAt(double ut, double cursorUt, bool boundaryUnclaimed)
        {
            return ut > cursorUt || (boundaryUnclaimed && ut == cursorUt);
        }
    }
}
