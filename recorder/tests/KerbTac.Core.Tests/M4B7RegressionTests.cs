using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    /// <summary>
    /// Regressions found during the 2026-11-18 M4B-7 air-defence acceptance:
    /// RWR was treated as radar, missile range read the surface-AI field, and
    /// pre-existing ground units were treated as freshly separated payloads.
    /// </summary>
    public sealed class M4B7RegressionTests
    {
        [Theory]
        [InlineData("ModuleRadar", true)]
        [InlineData("RadarWarningReceiver", false)]
        [InlineData("ModuleIRST", false)]
        [InlineData("ModuleWeapon", false)]
        public void OnlyActiveRadarModuleCountsAsRadar(string typeName, bool expected)
        {
            Assert.Equal(expected, ModuleSignatures.IsRadar(typeName));
        }

        [Theory]
        [InlineData("MissileLauncher", true)]
        [InlineData("BDModularGuidance", false)]
        [InlineData("MissileFire", false)]
        public void OnlyLauncherModulesCountAsMissileEvidence(string typeName, bool expected)
        {
            Assert.Equal(expected, ModuleSignatures.IsMissileLauncher(typeName));
        }

        [Fact]
        public void ThreatReaderUsesLauncherEngagementRangeNotSurfaceAiField()
        {
            Assert.Equal("engageRangeMax", ModuleSignatures.MissileRangeMembers[0]);
            Assert.DoesNotContain("MaxEngagementRange", ModuleSignatures.MissileRangeMembers);
        }

        [Theory]
        [InlineData(false, false, 0, false)]
        [InlineData(true, false, 0, true)]
        [InlineData(false, true, 0, true)]
        [InlineData(false, false, 30_000, true)]
        public void RadarReceiverIsNotAnActiveRadar(
            bool canScan,
            bool canLock,
            double maxRangeM,
            bool expected)
        {
            // BDA's radarDataReceiver is a ModuleRadar with canScan/canLock
            // false and canReceiveRadarData true. It must not make a pure
            // launcher look like a SAM vehicle.
            Assert.Equal(expected, ModuleSignatures.IsActiveRadar(canScan, canLock, maxRangeM));
        }

        [Fact]
        public void RadarCurveKilometresConvertToMetres()
        {
            Assert.Equal(20_000, ModuleSignatures.PickRadarRange(0, 20, 0));
            Assert.Equal(30_000, ModuleSignatures.PickRadarRange(0, 0, 30_000));
            Assert.Equal(25_000, ModuleSignatures.PickRadarRange(25_000, 20, 0));
            Assert.Equal(0, ModuleSignatures.PickRadarRange(0, 0, 0));
        }

        [Fact]
        public void MissileFireFallbackRequiresAnActualLauncher()
        {
            // MissileFire also manages guns; a radar+gun unit must not get a
            // missile threat circle from selectedWeaponsEngageRangeMax.
            Assert.Equal(0, ModuleSignatures.PickMissileRange(false, 0, 5_000));
            Assert.Equal(5_000, ModuleSignatures.PickMissileRange(true, 0, 5_000));
            Assert.Equal(12_000, ModuleSignatures.PickMissileRange(true, 12_000, 5_000));
        }

        [Fact]
        public void ThreatRangePickKeepsLargestFinitePositiveValue()
        {
            Assert.Equal(12_000, ModuleSignatures.PickRange(0, 12_000));
            Assert.Equal(12_000, ModuleSignatures.PickRange(12_000, 8_000));
            Assert.Equal(12_000, ModuleSignatures.PickRange(12_000, double.NaN));
            Assert.Equal(12_000, ModuleSignatures.PickRange(12_000, -1));
            Assert.Equal(12_000, ModuleSignatures.PickRange(12_000, double.PositiveInfinity));
        }

        [Fact]
        public void InitialVesselsAreNotStageLineageCandidates()
        {
            // A ground unit already present when recording starts must keep its
            // modelRole instead of becoming a payload of a nearby unit.
            Assert.False(StageLineagePolicy.IsEligibleForLineage(
                existedAtStart: true, loaded: true, dockedSeparation: false));
            Assert.True(StageLineagePolicy.IsEligibleForLineage(
                existedAtStart: false, loaded: true, dockedSeparation: false));
            Assert.False(StageLineagePolicy.IsEligibleForLineage(
                existedAtStart: false, loaded: false, dockedSeparation: false));
            // A recording that starts docked must still classify undock as payload.
            Assert.True(StageLineagePolicy.IsEligibleForLineage(
                existedAtStart: true, loaded: true, dockedSeparation: true));
        }
    }
}
