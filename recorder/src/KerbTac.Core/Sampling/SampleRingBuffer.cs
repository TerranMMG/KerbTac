using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>
    /// Fixed-capacity sample buffer. When full, the oldest block is handed to
    /// the caller so it can be serialized to disk while the session keeps
    /// recording; the buffer never discards data silently.
    /// </summary>
    public sealed class SampleRingBuffer
    {
        private readonly List<VesselSample> _samples = new List<VesselSample>();
        private readonly int _capacity;

        public SampleRingBuffer(int capacity)
        {
            if (capacity < 1)
            {
                capacity = 1;
            }
            _capacity = capacity;
        }

        public int Count
        {
            get { return _samples.Count; }
        }

        public int Capacity
        {
            get { return _capacity; }
        }

        public bool IsFull
        {
            get { return _samples.Count >= _capacity; }
        }

        public double OldestT
        {
            get { return _samples.Count > 0 ? _samples[0].T : 0.0; }
        }

        public double NewestT
        {
            get { return _samples.Count > 0 ? _samples[_samples.Count - 1].T : 0.0; }
        }

        public void Add(VesselSample sample)
        {
            _samples.Add(sample);
        }

        /// <summary>
        /// Removes and returns the oldest <paramref name="count"/> samples.
        /// Used when the buffer exceeds its memory budget.
        /// </summary>
        public List<VesselSample> TakeOldest(int count)
        {
            if (count <= 0)
            {
                return new List<VesselSample>();
            }
            if (count > _samples.Count)
            {
                count = _samples.Count;
            }

            List<VesselSample> taken = _samples.GetRange(0, count);
            _samples.RemoveRange(0, count);
            return taken;
        }

        /// <summary>Removes and returns all samples.</summary>
        public List<VesselSample> Drain()
        {
            List<VesselSample> all = new List<VesselSample>(_samples);
            _samples.Clear();
            return all;
        }

        /// <summary>Returns a copy without modifying the buffer.</summary>
        public List<VesselSample> Snapshot()
        {
            return new List<VesselSample>(_samples);
        }
    }
}
