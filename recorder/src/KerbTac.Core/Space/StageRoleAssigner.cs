namespace KerbTac.Core
{
    /// <summary>
    /// Assigns a role to a separated stage. The first large piece that leaves a
    /// vessel is its booster; later pieces are upper stages. Fairings and
    /// external tanks win regardless of order.
    /// </summary>
    public static class StageRoleAssigner
    {
        public static string Assign(
            bool isFairing,
            bool isExternalTank,
            bool isDockedSeparation,
            bool isPayload,
            int priorSeparatedStages)
        {
            if (isDockedSeparation || isPayload)
            {
                return "payload";
            }
            if (isFairing)
            {
                return "fairing";
            }
            if (isExternalTank)
            {
                return "stage.et";
            }
            return priorSeparatedStages > 0 ? "stage.upper" : "stage.booster";
        }
    }
}
