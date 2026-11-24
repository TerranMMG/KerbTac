namespace KerbTac
{
    /// <summary>
    /// Decides whether a loaded vessel is a transient combat actor (a missile or
    /// shell) or a persistent aircraft. A BDA fighter also carries missile
    /// launchers, so the presence of a missile module alone is not enough; fire
    /// control or a pilot module marks the vessel as a persistent platform.
    /// </summary>
    public static class ActorClassifier
    {
        public static bool IsTransientActor(bool hasMissileModule, bool hasFireControl)
        {
            return hasMissileModule && !hasFireControl;
        }
    }
}
