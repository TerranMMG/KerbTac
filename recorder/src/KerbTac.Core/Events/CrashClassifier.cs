namespace KerbTac.Core
{
    /// <summary>
    /// Separates a hard impact that merely damages a vessel from the loss of
    /// the vessel. Only the active vessel's loss is a crash in the timeline;
    /// another vessel's loss is a destroyed event.
    /// </summary>
    public static class CrashClassifier
    {
        public static string Classify(bool vesselDestroyed, bool isActiveVessel, double impactSpeed)
        {
            if (vesselDestroyed)
            {
                return isActiveVessel ? EventTypes.Crash : EventTypes.Destroyed;
            }
            return EventTypes.Impact;
        }
    }
}
