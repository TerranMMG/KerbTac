using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    /// <summary>M4B: recording mode selection, model roles and stage inclusion.</summary>
    public sealed class SpaceRoleTests
    {
        [Theory]
        [InlineData("auto", "Runway", "combat")]
        [InlineData("auto", "LaunchPad", "space")]
        [InlineData("auto", "Launch Pad", "space")]
        [InlineData("auto", null, "combat")]
        [InlineData("auto", "", "combat")]
        [InlineData("space", "Runway", "space")]
        [InlineData("combat", "LaunchPad", "combat")]
        [InlineData(" Space ", "Runway", "space")]
        [InlineData("bogus", "LaunchPad", "space")]
        public void RecordingModeResolvesFromSettingAndLaunchSite(string setting, string landedAt, string expected)
        {
            Assert.Equal(expected, RecordingModeResolver.Resolve(setting, landedAt));
        }

        [Fact]
        public void RecordingModeSettingNormalizes()
        {
            Assert.Equal("space", RecordingModeResolver.Normalize(" SPACE "));
            Assert.Equal("combat", RecordingModeResolver.Normalize("Combat"));
            Assert.Equal("auto", RecordingModeResolver.Normalize("bogus"));
            Assert.Equal("auto", RecordingModeResolver.Normalize(null));
        }

        [Fact]
        public void FairingAndStageBeatEveryOtherRole()
        {
            var features = new RoleFeatures { IsFairing = true, IsStage = true, HasRadar = true, HasLauncher = true };
            Assert.Equal("space.fairing", ObjectRoleClassifier.Classify("Debris", features));

            features = new RoleFeatures { IsStage = true, HasRadar = true, HasLauncher = true };
            Assert.Equal("space.stage", ObjectRoleClassifier.Classify("Rover", features));
        }

        [Theory]
        [InlineData("Probe", "space.rocket")]
        [InlineData("Lander", null)]
        public void AttachedFairingDoesNotTurnAnIntactVesselIntoDebris(string type, string? expected)
        {
            var features = new RoleFeatures { IsFairing = true, HasRocketEngine = true, HasDecoupler = true };
            Assert.Equal(expected, ObjectRoleClassifier.Classify(type, features, "LaunchPad"));
        }

        [Theory]
        [InlineData("ModuleDecouple", true)]
        [InlineData("ModuleAnchoredDecoupler", true)]
        [InlineData("ModuleProceduralFairing", false)]
        public void RecognizesStockSeparationModules(string moduleName, bool expected)
        {
            Assert.Equal(expected, ModuleSignatures.IsDecoupler(moduleName));
        }

        [Fact]
        public void RocketWithDecouplerIsSpaceRocketEvenWhenKspCallsItShip()
        {
            var features = new RoleFeatures { HasRocketEngine = true, HasDecoupler = true };
            Assert.Equal("space.rocket", ObjectRoleClassifier.Classify("Ship", features));
        }

        [Fact]
        public void SingleStageLaunchpadRocketDoesNotBecomeASurfaceShip()
        {
            var features = new RoleFeatures { HasRocketEngine = true };
            Assert.Equal("space.rocket", ObjectRoleClassifier.Classify("Ship", features, "LaunchPad"));
            features.StartedSplashed = true;
            Assert.Equal("sea.ship", ObjectRoleClassifier.Classify("Ship", features, "LaunchPad"));
        }

        [Theory]
        [InlineData(true, "ground.vehicle")]
        [InlineData(false, null)]
        public void WheeledProbeIsGroundVehicleOnlyOnLand(bool onLand, string? expected)
        {
            Assert.Equal(expected, ObjectRoleClassifier.Classify("Probe",
                new RoleFeatures { HasWheel = true }, onLand: onLand));
        }

        [Fact]
        public void SeaRolesWinForShipsAndSplashedVessels()
        {
            Assert.Equal("sea.ship", ObjectRoleClassifier.Classify("Ship", new RoleFeatures()));
            Assert.Equal("sea.ship", ObjectRoleClassifier.Classify("Base", new RoleFeatures { StartedSplashed = true }));
        }

        [Fact]
        public void AircraftSplitByWeapons()
        {
            Assert.Equal("air.fighter", ObjectRoleClassifier.Classify("Plane", new RoleFeatures { HasWeapon = true }));
            Assert.Equal("air.fighter", ObjectRoleClassifier.Classify("Plane", new RoleFeatures { HasLauncher = true }));
            Assert.Equal("air.support", ObjectRoleClassifier.Classify("Plane", new RoleFeatures()));
        }

        [Theory]
        [InlineData(false, false, "ground.vehicle")]
        [InlineData(true, false, "ground.radar")]
        [InlineData(false, true, "ground.launcher")]
        [InlineData(true, true, "ground.sam")]
        public void GroundRolesSplitByRadarAndLauncher(bool radar, bool launcher, string expected)
        {
            var features = new RoleFeatures { HasRadar = radar, HasLauncher = launcher };
            Assert.Equal(expected, ObjectRoleClassifier.Classify("Rover", features));
            Assert.Equal(expected, ObjectRoleClassifier.Classify("Base", features));
        }

        [Fact]
        public void DebrisStaysDebris()
        {
            Assert.Equal("debris", ObjectRoleClassifier.Classify("Debris", new RoleFeatures()));
        }

        [Fact]
        public void UnknownTypeFallsBackToPartFeatures()
        {
            Assert.Equal("ground.vehicle", ObjectRoleClassifier.Classify("Unknown", new RoleFeatures { HasWheel = true }));
            Assert.Equal("air.support", ObjectRoleClassifier.Classify("Unknown", new RoleFeatures { HasRotor = true }));
            Assert.Equal("unknown", ObjectRoleClassifier.Classify("Unknown", new RoleFeatures()));
        }

        [Fact]
        public void ThreatRadiusNeedsBothMissileAndRadarRanges()
        {
            ThreatInfo both = ThreatRanges.From(12_000, 40_000);
            Assert.NotNull(both);
            Assert.Equal(12_000, both!.ThreatRadiusM);
            Assert.Equal(40_000, both.RadarRangeM);

            Assert.Null(ThreatRanges.From(12_000, 0));
            Assert.Null(ThreatRanges.From(0, 40_000));
            Assert.Null(ThreatRanges.From(0, 0));
        }

        [Fact]
        public void RadarOnlyUnitUsesRadarCoverageCircle()
        {
            ThreatInfo radar = ThreatRanges.RadarCoverage(30_000);
            Assert.NotNull(radar);
            Assert.Equal(0, radar!.MissileRangeM);
            Assert.Equal(30_000, radar.RadarRangeM);
            Assert.Equal(30_000, radar.ThreatRadiusM);

            Assert.Null(ThreatRanges.RadarCoverage(0));
            Assert.Null(ThreatRanges.RadarCoverage(double.NaN));
        }

        [Fact]
        public void LargePartThresholdAcceptsAnyOfTheThreeRules()
        {
            Assert.True(LargePartPolicy.IsLarge(500, 1, false, false));
            Assert.False(LargePartPolicy.IsLarge(499, 7, false, false));
            Assert.True(LargePartPolicy.IsLarge(10, 8, false, false));
            Assert.True(LargePartPolicy.IsLarge(10, 2, true, true));
            Assert.False(LargePartPolicy.IsLarge(10, 2, true, false));
        }

        [Fact]
        public void FairingIsTrackedEvenWhenSmall()
        {
            Assert.True(LargePartPolicy.IsSeparatedPartLarge(2, 2, false, false, true));
            Assert.False(LargePartPolicy.IsSeparatedPartLarge(50, 2, false, false, false));
            Assert.True(LargePartPolicy.IsSeparatedPartLarge(600, 1, true, false, false));
        }

        [Fact]
        public void InertSupportStructureIsNeverAStage()
        {
            // A 1000 t launch erector has no engine, tank or command module.
            Assert.False(LargePartPolicy.IsSeparatedPartLarge(1_000_000, 1, false, false, false));
        }

        [Fact]
        public void PayloadWithCommandModuleIsTrackedEvenWhenSmall()
        {
            // A probe payload can be light and have no engine or tank; the
            // command module is what makes it worth recording.
            Assert.True(LargePartPolicy.IsSeparatedPartLarge(50, 1, false, false, false, true));
            Assert.False(LargePartPolicy.IsSeparatedPartLarge(50, 1, false, false, false));
        }

        [Fact]
        public void StageRoleFollowsSeparationOrder()
        {
            Assert.Equal("fairing", StageRoleAssigner.Assign(true, false, false, false, 0));
            Assert.Equal("stage.et", StageRoleAssigner.Assign(false, true, false, false, 0));
            Assert.Equal("stage.booster", StageRoleAssigner.Assign(false, false, false, false, 0));
            Assert.Equal("stage.upper", StageRoleAssigner.Assign(false, false, false, false, 1));
            Assert.Equal("stage.upper", StageRoleAssigner.Assign(false, false, false, false, 2));
        }

        [Fact]
        public void UndockingIsPayloadNotAStage()
        {
            Assert.Equal("payload", StageRoleAssigner.Assign(false, false, true, false, 3));
        }

        [Fact]
        public void PayloadWithoutEngineIsPayload()
        {
            Assert.Equal("payload", StageRoleAssigner.Assign(false, false, false, true, 0));
        }

        [Fact]
        public void PiecesFromOneStagingActionShareTheSameRole()
        {
            Assert.True(SeparationHierarchy.IsSameSeparationEvent(100.0, 101.4));
            Assert.False(SeparationHierarchy.IsSameSeparationEvent(100.0, 104.0));
        }

        [Fact]
        public void FocusSwitchPromotesMuchLighterChild()
        {
            // Payload released from a 26 t upper stage at the moment the player
            // takes control of it.
            Assert.True(SeparationHierarchy.ShouldPromotePayload(
                null, "stage.upper", "prev", "prev", 3863, 26255));
            // Switching from S1 to the similar-mass upper stage is not a payload.
            Assert.False(SeparationHierarchy.ShouldPromotePayload(
                null, "stage.upper", "prev", "prev", 24400, 26460));
            // A booster that already has a role stays a child.
            Assert.False(SeparationHierarchy.ShouldPromotePayload(
                "stage.booster", "stage.upper", "prev", "prev", 100, 26000));
        }

        [Fact]
        public void StationAndProbesKeepTheirVesselTypePreset()
        {
            Assert.Null(ObjectRoleClassifier.Classify("Station", new RoleFeatures()));
            Assert.Null(ObjectRoleClassifier.Classify("Probe", new RoleFeatures()));
            Assert.Null(ObjectRoleClassifier.Classify("Relay", new RoleFeatures()));
            var rocketEvidence = new RoleFeatures { HasRocketEngine = true, HasDecoupler = true };
            Assert.Null(ObjectRoleClassifier.Classify("Station", rocketEvidence));
        }
    }
}
