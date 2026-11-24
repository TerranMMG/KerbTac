namespace KerbTac.Core
{
    /// <summary>Part/module evidence used to choose a stable model role.</summary>
    public sealed class RoleFeatures
    {
        public bool IsFairing;
        public bool IsStage;
        public bool HasRadar;
        public bool HasLauncher;
        public bool HasWeapon;
        public bool HasWheel;
        public bool HasRotor;
        public bool HasRocketEngine;
        public bool HasDecoupler;
        public bool StartedSplashed;
    }
}
