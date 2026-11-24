using KerbTac.Core;

namespace KerbTac
{
    /// <summary>
    /// Copies optional BDA hull health into a sample. Zero is a valid measurement.
    /// </summary>
    public static class BdaSampleHealth
    {
        public static void Apply(ref VesselSample sample, bool hasBda, double health)
        {
            sample.Health = hasBda && health >= 0.0 && health <= 1.0 ? health : (double?)null;
        }
    }
}
