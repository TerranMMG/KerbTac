using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using KerbTac.Core;
using KerbTac.Recorder;
using KSP;
using UnityEngine;

[CollectionDefinition("KSP flight globals", DisableParallelization = true)]
public sealed class KspFlightGlobalsCollection { }

[Collection("KSP flight globals")]
public sealed class RecordingSessionEventTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "kerbtac-events-" + Guid.NewGuid());
    private readonly List<Vessel> _previousVessels = FlightGlobals.Vessels;
    private readonly List<Vessel> _previousLoaded = FlightGlobals.VesselsLoaded;
    private readonly Vessel _previousActive = FlightGlobals.ActiveVessel;
    private readonly double _previousUt = Planetarium.UniversalTime;
    private readonly CelestialBody _body = new CelestialBody
    {
        bodyName = "Kerbin", Radius = 600000, bodyTransform = new Transform { rotation = Quaternion.identity }
    };
    private readonly RecordingSession _session;

    public RecordingSessionEventTests()
    {
        FlightGlobals.Vessels = new List<Vessel>();
        FlightGlobals.VesselsLoaded = new List<Vessel>();
        FlightGlobals.ActiveVessel = null;
        _session = new RecordingSession(KerbTacSettings.Load(_directory));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void NewlyFocused129thVesselGetsActiveSamplesAndStageEvent(bool inLoadedListOnly)
    {
        Vessel first = AddVessel("First");
        for (int i = 2; i <= 128; i++)
        {
            AddVessel("Vessel " + i);
        }
        Start(first);
        Tick(10.1);
        Vessel next = AddVessel("Vessel 129");
        if (inLoadedListOnly)
        {
            FlightGlobals.Vessels.Remove(next);
            next.loaded = false;
        }
        Focus(next, 10.2);
        _session.RecordStage(2);
        Tick(10.3);

        using ZipArchive archive = Stop(10.4);
        using JsonDocument events = Read(archive, "events.json");
        JsonElement stage = Assert.Single(Events(events, EventTypes.Stage));
        Assert.Equal(next.id.ToString(), stage.GetProperty("vessel").GetString());
        using JsonDocument manifest = Read(archive, "manifest.json");
        Assert.Equal(129, manifest.RootElement.GetProperty("vessels").GetArrayLength());
        using JsonDocument track = Read(archive, SessionSerializer.TrackPath(next.id.ToString()));
        JsonElement segment = Assert.Single(track.RootElement.GetProperty("segments").EnumerateArray());
        Assert.Equal("active", segment.GetProperty("source").GetString());
        Assert.Equal(10.3, Assert.Single(segment.GetProperty("samples").GetProperty("t").EnumerateArray()).GetDouble());
    }

    [Fact]
    public void TickRecoversFocusWhenTheVesselChangeCallbackIsMissing()
    {
        Vessel a = AddVessel("A");
        Vessel b = AddVessel("B");
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = b;
        Tick(10.2);
        Assert.Same(b, _session.Vessel);
    }

    [Fact]
    public void StageBeforeFocusCallbackUsesTheActualVesselAndSkipsExcludedFocus()
    {
        Vessel a = AddVessel("A");
        Vessel b = AddVessel("B");
        Vessel eva = AddVessel("EVA");
        eva.vesselType = VesselType.EVA;
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = b;
        _session.RecordStage(2);
        Tick(10.2);
        FlightGlobals.ActiveVessel = eva;
        _session.RecordStage(1);
        Tick(10.3);

        using ZipArchive archive = Stop(10.4);
        using JsonDocument events = Read(archive, "events.json");
        JsonElement stage = Assert.Single(Events(events, EventTypes.Stage));
        Assert.Equal(b.id.ToString(), stage.GetProperty("vessel").GetString());
    }

    [Fact]
    public void ExcludedFocusCanReturnToAWithoutInheritingGearChanges()
    {
        Vessel a = AddVessel("A");
        Vessel eva = AddVessel("EVA");
        eva.vesselType = VesselType.EVA;
        Start(a);
        Tick(10.1);
        Focus(eva, 10.2);
        a.ActionGroups[KSPActionGroup.Gear] = true;
        Tick(10.2);
        Focus(a, 10.3);
        Tick(10.3);
        a.ActionGroups[KSPActionGroup.Gear] = false;
        Tick(10.4);
        using ZipArchive archive = Stop(10.5);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Empty(Events(events, EventTypes.GearDown));
        var toggle = Assert.Single(Events(events, EventTypes.GearUp));
        Assert.Equal(a.id.ToString(), toggle.GetProperty("vessel").GetString());
        Assert.Equal(a.id.ToString(), Assert.Single(Events(events, EventTypes.FlightEnd))
            .GetProperty("vessel").GetString());
        Assert.Null(archive.GetEntry(SessionSerializer.TrackPath(eva.id.ToString())));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DestroyingDistanceReferenceDuringEvaDoesNotAutoSaveAndFlightEndHasNoVessel(bool notifyFocus)
    {
        Vessel a = AddVessel("A");
        Vessel eva = AddVessel("EVA");
        eva.vesselType = VesselType.EVA;
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = eva;
        if (notifyFocus) Focus(eva, 10.2);
        Destroy(a, 10.2);
        Tick(12.4);
        Assert.Equal(RecorderState.Recording, _session.State);
        using ZipArchive archive = Stop(12.5);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Equal(a.id.ToString(), Assert.Single(Events(events, EventTypes.Destroyed))
            .GetProperty("vessel").GetString());
        Assert.Empty(Events(events, EventTypes.Crash));
        Assert.Equal(JsonValueKind.Null, Assert.Single(Events(events, EventTypes.FlightEnd))
            .GetProperty("vessel").ValueKind);
    }

    [Fact]
    public void ManualStopBeforeExcludedFocusCallbackDoesNotCreditPreviousVessel()
    {
        Vessel a = AddVessel("A");
        Vessel eva = AddVessel("EVA");
        eva.vesselType = VesselType.EVA;
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = eva;
        using ZipArchive archive = Stop(10.2);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Equal(JsonValueKind.Null, Assert.Single(Events(events, EventTypes.FlightEnd))
            .GetProperty("vessel").ValueKind);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DestroyedFocusCannotBeReclaimedWhileStaleAndAnotherVesselCanTakeOver(bool takeover)
    {
        Vessel a = AddVessel("A");
        Vessel b = takeover ? AddVessel("B") : null;
        Start(a);
        Tick(10.1);
        Destroy(a, 10.2);
        Tick(10.3); // KSP still reports A as the active vessel.
        FlightGlobals.ActiveVessel = b;
        Tick(10.4);
        Tick(12.4);
        if (takeover)
        {
            Assert.Equal(RecorderState.Recording, _session.State);
            _session.RecordStage(2);
            _session.Stop("test", 12.5);
        }

        using ZipArchive archive = AwaitArchive(_session);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Equal(a.id.ToString(), Assert.Single(Events(events, EventTypes.Crash))
            .GetProperty("vessel").GetString());
        var end = Assert.Single(Events(events, EventTypes.FlightEnd));
        if (takeover)
        {
            Assert.Equal(b.id.ToString(), end.GetProperty("vessel").GetString());
            Assert.Equal(b.id.ToString(), Assert.Single(Events(events, EventTypes.Stage))
                .GetProperty("vessel").GetString());
        }
        else
        {
            Assert.Equal(JsonValueKind.Null, end.GetProperty("vessel").ValueKind);
            Assert.Equal("no_active_vessel", end.GetProperty("data").GetProperty("reason").GetString());
        }
        using JsonDocument track = Read(archive, SessionSerializer.TrackPath(a.id.ToString()));
        Assert.Equal(new[] { 10.1 }, SampleTimes(track));
    }

    [Fact]
    public void StopBeforeNewFocusHasSamplesLeavesFlightEndGlobal()
    {
        Vessel a = AddVessel("A");
        Start(a);
        Tick(10.1);
        Vessel b = AddVessel("B");
        Focus(b, 10.2);

        using ZipArchive archive = Stop(10.2);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Null(archive.GetEntry(SessionSerializer.TrackPath(b.id.ToString())));
        Assert.Equal(JsonValueKind.Null, Assert.Single(Events(events, EventTypes.FlightEnd))
            .GetProperty("vessel").ValueKind);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void AddonHandlesUntrackedActiveDestructionAndIgnoresUnrelatedUntrackedVessel(bool stalePointer)
    {
        Vessel a = AddVessel("A");
        Start(a);
        Tick(10.1);
        Vessel unrelated = AddVessel("Unrelated");
        Vessel b = AddVessel("B");
        FlightGlobals.ActiveVessel = b;
        Planetarium.UniversalTime = 10.2;
        var addon = new KerbTacAddon { Session = _session };
        var callback = typeof(KerbTacAddon)
            .GetMethod("OnVesselWillDestroy", BindingFlags.Instance | BindingFlags.NonPublic);
        foreach (Vessel destroyed in new[] { unrelated, b })
        {
            Assert.False(_session.IsTracking(destroyed));
            callback.Invoke(addon, new object[] { destroyed });
            FlightGlobals.Vessels.Remove(destroyed);
            FlightGlobals.VesselsLoaded.Remove(destroyed);
        }
        if (!stalePointer) FlightGlobals.ActiveVessel = null;
        Tick(10.3);
        Assert.False(_session.IsTracking(b));
        FlightGlobals.ActiveVessel = null;
        Tick(12.4);

        using ZipArchive archive = AwaitArchive(_session);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Empty(Events(events, EventTypes.Destroyed));
        Assert.Equal(b.id.ToString(), Assert.Single(Events(events, EventTypes.Crash))
            .GetProperty("vessel").GetString());
        var end = Assert.Single(Events(events, EventTypes.FlightEnd));
        Assert.Equal(JsonValueKind.Null, end.GetProperty("vessel").ValueKind);
        Assert.Equal("no_active_vessel", end.GetProperty("data").GetProperty("reason").GetString());
        using JsonDocument aTrack = Read(archive, SessionSerializer.TrackPath(a.id.ToString()));
        Assert.Equal(new[] { 10.1 }, SampleTimes(aTrack));
        Assert.Null(archive.GetEntry(SessionSerializer.TrackPath(b.id.ToString())));
    }

    [Fact]
    public void EmptyFocusBeforeUnobservedVesselDestructionStartsGraceWithoutInferringACrash()
    {
        Vessel a = AddVessel("A");
        Start(a);
        Tick(10.1);
        Vessel b = AddVessel("B");
        FlightGlobals.ActiveVessel = b; // Not yet observed by a tick or a focus callback.
        FlightGlobals.ActiveVessel = null;
        Planetarium.UniversalTime = 10.2;
        var addon = new KerbTacAddon { Session = _session };
        typeof(KerbTacAddon).GetMethod("OnVesselWillDestroy", BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(addon, new object[] { b });
        FlightGlobals.Vessels.Remove(b);
        FlightGlobals.VesselsLoaded.Remove(b);

        Tick(10.3);
        Tick(11.4);
        Assert.Equal(RecorderState.Recording, _session.State);
        Tick(12.4);

        using ZipArchive archive = AwaitArchive(_session);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Empty(Events(events, EventTypes.Crash));
        Assert.Empty(Events(events, EventTypes.Destroyed));
        Assert.Empty(Events(events, EventTypes.Kill));
        AssertAutomaticNoFocusEnd(events);
        Assert.Null(archive.GetEntry(SessionSerializer.TrackPath(b.id.ToString())));
        using JsonDocument track = Read(archive, SessionSerializer.TrackPath(a.id.ToString()));
        Assert.Equal(new[] { 10.1 }, SampleTimes(track));
    }

    [Fact]
    public void KnownFocusDestroyedAfterFirstNullTickStillRecordsCrash()
    {
        Vessel a = AddVessel("A");
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = null;
        Tick(10.2);
        Planetarium.UniversalTime = 11.0;
        var addon = new KerbTacAddon { Session = _session };
        typeof(KerbTacAddon).GetMethod("OnVesselWillDestroy", BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(addon, new object[] { a });
        FlightGlobals.Vessels.Remove(a);
        FlightGlobals.VesselsLoaded.Remove(a);
        Tick(12.3);

        using ZipArchive archive = AwaitArchive(_session);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Empty(Events(events, EventTypes.Destroyed));
        Assert.Equal(a.id.ToString(), Assert.Single(Events(events, EventTypes.Crash))
            .GetProperty("vessel").GetString());
        AssertAutomaticNoFocusEnd(events);
        using JsonDocument track = Read(archive, SessionSerializer.TrackPath(a.id.ToString()));
        Assert.Equal(new[] { 10.1 }, SampleTimes(track));
    }

    [Fact]
    public void SustainedEmptyFocusAutoSavesEvenWithoutAnyDestroyCallback()
    {
        Vessel a = AddVessel("A");
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = null;
        Tick(10.2);
        Tick(12.1);
        Assert.Equal(RecorderState.Recording, _session.State);
        Tick(12.3);

        using ZipArchive archive = AwaitArchive(_session);
        using JsonDocument events = Read(archive, "events.json");
        AssertAutomaticNoFocusEnd(events);
        using JsonDocument track = Read(archive, SessionSerializer.TrackPath(a.id.ToString()));
        Assert.Equal(new[] { 10.1 }, SampleTimes(track));
    }

    [Fact]
    public void BriefEmptyFocusPausesSamplingAndReturningToACancelsGrace()
    {
        Vessel a = AddVessel("A");
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = null;
        Tick(10.2);
        Tick(10.3);
        FlightGlobals.ActiveVessel = a;
        Tick(10.4);
        Tick(12.5);

        Assert.Equal(RecorderState.Recording, _session.State);
        using ZipArchive archive = Stop(12.6);
        using JsonDocument track = Read(archive, SessionSerializer.TrackPath(a.id.ToString()));
        Assert.Equal(new[] { 10.1, 10.4, 12.5 }, SampleTimes(track));
        using JsonDocument events = Read(archive, "events.json");
        Assert.Equal(a.id.ToString(), Assert.Single(Events(events, EventTypes.FlightEnd))
            .GetProperty("vessel").GetString());
    }

    [Fact]
    public void NonemptyExcludedFocusCancelsGraceWithoutBecomingTheActiveTrack()
    {
        Vessel a = AddVessel("A");
        Vessel eva = AddVessel("EVA");
        eva.vesselType = VesselType.EVA;
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = null;
        Tick(10.2);
        FlightGlobals.ActiveVessel = eva;
        Tick(10.3);
        Tick(12.5);

        Assert.Equal(RecorderState.Recording, _session.State);
        using ZipArchive archive = Stop(12.6);
        Assert.Null(archive.GetEntry(SessionSerializer.TrackPath(eva.id.ToString())));
        using JsonDocument events = Read(archive, "events.json");
        Assert.Equal(JsonValueKind.Null, Assert.Single(Events(events, EventTypes.FlightEnd))
            .GetProperty("vessel").ValueKind);
    }

    private static void AssertAutomaticNoFocusEnd(JsonDocument events)
    {
        var end = Assert.Single(Events(events, EventTypes.FlightEnd));
        Assert.Equal(JsonValueKind.Null, end.GetProperty("vessel").ValueKind);
        Assert.Equal("no_active_vessel", end.GetProperty("data").GetProperty("reason").GetString());
    }

    [Fact]
    public void SoiBetweenFocusTicksAcceptsOnlyTheActualActiveHost()
    {
        Vessel a = AddVessel("A");
        Vessel b = AddVessel("B");
        Start(a);
        Tick(10.1);
        FlightGlobals.ActiveVessel = b;
        Planetarium.UniversalTime = 10.2;
        var addon = new KerbTacAddon { Session = _session };
        var callback = typeof(KerbTacAddon).GetMethod("OnSoiChanged", BindingFlags.Instance | BindingFlags.NonPublic);
        var destination = new CelestialBody { bodyName = "Mun" };
        callback.Invoke(addon, new object[] { new GameEvents.HostedFromToAction<Vessel, CelestialBody>
            { host = a, from = _body, to = destination } });
        callback.Invoke(addon, new object[] { new GameEvents.HostedFromToAction<Vessel, CelestialBody>
            { host = b, from = _body, to = destination } });
        Tick(10.3);
        using ZipArchive archive = Stop(10.4);
        using JsonDocument events = Read(archive, "events.json");
        var soi = Assert.Single(Events(events, EventTypes.SoiChange));
        Assert.Equal(b.id.ToString(), soi.GetProperty("vessel").GetString());
        Assert.Equal(10.2, soi.GetProperty("ut").GetDouble());
    }

    [Fact]
    public void CapPreservesExistingLoadedOnlyTrackAndRetiresFarthestUnloadedFirst()
    {
        var settings = KerbTacSettings.Load(_directory);
        settings.UnloadedRangeKm = 50;
        var session = new RecordingSession(settings);
        Vessel a = AddVessel("A");
        Vessel protectedVessel = AddVessel("Loaded-list-only");
        protectedVessel.altitude = 20000;
        Vessel near = AddVessel("Near");
        near.altitude = 5000;
        Vessel far = AddVessel("Far");
        far.altitude = 10000;
        foreach (Vessel vessel in new[] { near, far })
        {
            vessel.loaded = false;
            vessel.orbit = new Orbit { referenceBody = _body, semiMajorAxis = _body.Radius + vessel.altitude };
            FlightGlobals.VesselsLoaded.Remove(vessel);
        }
        for (int i = 0; i < 124; i++) AddVessel("Other " + i);
        Start(a, session);
        Tick(10.1, session);
        Tick(10.7, session);
        protectedVessel.loaded = false;
        FlightGlobals.Vessels.Remove(protectedVessel);
        Vessel next = AddVessel("New focus");
        FlightGlobals.ActiveVessel = next;
        Tick(10.8, session);
        Tick(20.4, session);
        using ZipArchive archive = Stop(20.5, session);
        using JsonDocument protectedTrack = Read(archive, SessionSerializer.TrackPath(protectedVessel.id.ToString()));
        using JsonDocument farTrack = Read(archive, SessionSerializer.TrackPath(far.id.ToString()));
        using JsonDocument nearTrack = Read(archive, SessionSerializer.TrackPath(near.id.ToString()));
        Assert.Contains(20.4, SampleTimes(protectedTrack));
        Assert.Equal(new[] { 10.1, 20.1 }, SampleTimes(nearTrack));
        Assert.Equal(new[] { 10.1 }, SampleTimes(farTrack));
    }

    [Fact]
    public void GearIsReseededOnEachSwitchAndOnlyActualTogglesAreRecorded()
    {
        Vessel a = AddVessel("A");
        Vessel b = AddVessel("B");
        b.ActionGroups[KSPActionGroup.Gear] = true;
        Start(a);
        Tick(10.1);
        Focus(b, 10.2);
        Tick(10.2);
        Focus(a, 10.3);
        Tick(10.3);
        a.ActionGroups[KSPActionGroup.Gear] = true;
        Tick(10.4);

        using ZipArchive archive = Stop(10.5);
        using JsonDocument events = Read(archive, "events.json");
        Assert.Empty(Events(events, EventTypes.GearUp));
        JsonElement down = Assert.Single(Events(events, EventTypes.GearDown));
        Assert.Equal(a.id.ToString(), down.GetProperty("vessel").GetString());
        Assert.Equal(10.4, down.GetProperty("ut").GetDouble());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void StopFlushesAnOpenGunfireBurstOnlyWhenGunfireIsEnabled(bool recordGunfire)
    {
        Vessel vessel = AddVessel("Shooter");
        var weapon = new ModuleWeapon();
        AddModule(vessel, weapon);
        var settings = KerbTacSettings.Load(_directory);
        settings.RecordGunfire = recordGunfire;
        var session = new RecordingSession(settings);
        Start(vessel, session);
        session.FixedTick(vessel, 0.1f, 10.1);
        weapon.timeFired = 10.2f;
        session.FixedTick(vessel, 0.1f, 10.2);

        using ZipArchive archive = Stop(10.3, session);
        using JsonDocument events = Read(archive, "events.json");
        var bursts = Events(events, EventTypes.Gunfire);
        if (!recordGunfire)
        {
            Assert.Empty(bursts);
            return;
        }
        JsonElement burst = Assert.Single(bursts);
        Assert.Equal(vessel.id.ToString(), burst.GetProperty("vessel").GetString());
        Assert.Equal(10.2, burst.GetProperty("ut").GetDouble());
        Assert.Equal(1, burst.GetProperty("data").GetProperty("rounds").GetInt32());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void TerminalActorStopsSamplingAndSameGuidCannotEmitAnotherRelease(bool explicitEnd)
    {
        Vessel parent = AddVessel("Parent");
        Vessel actor = AddVessel("Transient");
        var missile = new MissileBase { SourceVessel = parent };
        AddModule(actor, missile);
        Start(parent);
        Tick(10.1);
        Tick(10.3);
        Assert.Equal(new[] { 10.1, 10.3 }, Assert.Single(_session.Actors).Samples.Select(sample => sample.T));

        if (explicitEnd)
        {
            missile.HasExploded = true;
            Tick(10.7);
            // The game may keep a terminal actor loaded after the end signal.
            Tick(10.8);
        }
        actor.loaded = false;
        FlightGlobals.VesselsLoaded.Remove(actor);
        Tick(13.0);
        actor.loaded = true;
        FlightGlobals.VesselsLoaded.Add(actor);
        Tick(13.6);

        using ZipArchive archive = Stop(13.7);
        using JsonDocument actors = Read(archive, "actors.json");
        JsonElement track = Assert.Single(actors.RootElement.GetProperty("actors").EnumerateArray());
        Assert.Equal(actor.id.ToString(), track.GetProperty("id").GetString());
        Assert.Equal(10.3, track.GetProperty("endUt").GetDouble());
        Assert.Equal(new[] { 10.1, 10.3 },
            track.GetProperty("samples").GetProperty("t").EnumerateArray().Select(t => t.GetDouble()));
        using JsonDocument events = Read(archive, "events.json");
        Assert.Single(Events(events, EventTypes.WeaponRelease));
        string terminalType = explicitEnd ? EventTypes.ProximityDetonation : EventTypes.Miss;
        Assert.Single(Events(events, terminalType));
        Assert.Empty(Events(events, explicitEnd ? EventTypes.Miss : EventTypes.ProximityDetonation));
    }

    private Vessel AddVessel(string name)
    {
        var frame = new Transform { rotation = Quaternion.identity };
        var vessel = new Vessel
        {
            id = Guid.NewGuid(), vesselName = name, vesselType = VesselType.Plane, mainBody = _body,
            transform = frame, ReferenceTransform = frame, loaded = true, situation = Vessel.Situations.FLYING
        };
        FlightGlobals.Vessels.Add(vessel);
        FlightGlobals.VesselsLoaded.Add(vessel);
        return vessel;
    }

    private static void AddModule(Vessel vessel, PartModule module)
    {
        var part = new Part
        {
            vessel = vessel, flightID = Guid.NewGuid(), transform = new Transform { rotation = Quaternion.identity }
        };
        module.part = part;
        part.Modules.Add(module);
        vessel.parts.Add(part);
    }

    private void Start(Vessel vessel, RecordingSession session = null)
    {
        FlightGlobals.ActiveVessel = vessel;
        (session ?? _session).Start(vessel, "test", 10, DateTime.UtcNow);
    }

    private void Focus(Vessel vessel, double ut)
    {
        FlightGlobals.ActiveVessel = vessel;
        Planetarium.UniversalTime = ut;
        _session.SetActiveVessel(vessel, ut);
    }

    private void Tick(double ut, RecordingSession session = null)
    {
        Planetarium.UniversalTime = ut;
        (session ?? _session).FixedTick(FlightGlobals.ActiveVessel, 0.1f, ut);
    }

    private void Destroy(Vessel vessel, double ut)
    {
        Planetarium.UniversalTime = ut;
        _session.RecordDestroyed(vessel, "vessel_destroyed");
        FlightGlobals.Vessels.Remove(vessel);
        FlightGlobals.VesselsLoaded.Remove(vessel);
    }

    private ZipArchive Stop(double ut, RecordingSession session = null)
    {
        session ??= _session;
        session.Stop("test", ut);
        return AwaitArchive(session);
    }

    private static ZipArchive AwaitArchive(RecordingSession session)
    {
        Assert.True(SpinWait.SpinUntil(() =>
        {
            session.TickFinalize();
            return session.State != RecorderState.Finalizing;
        }, TimeSpan.FromSeconds(10)), "archive worker did not finish");
        Assert.True(session.State == RecorderState.Idle, session.LastError);
        Assert.NotNull(session.LastFilePath);
        return ZipFile.OpenRead(session.LastFilePath);
    }

    private static JsonDocument Read(ZipArchive archive, string path)
    {
        ZipArchiveEntry entry = archive.GetEntry(path);
        Assert.NotNull(entry);
        using Stream stream = entry.Open();
        return JsonDocument.Parse(stream);
    }

    private static IEnumerable<JsonElement> Events(JsonDocument doc, string type) =>
        doc.RootElement.EnumerateArray().Where(e => e.GetProperty("type").GetString() == type);

    private static IEnumerable<double> SampleTimes(JsonDocument doc) =>
        doc.RootElement.GetProperty("segments").EnumerateArray()
            .SelectMany(segment => segment.GetProperty("samples").GetProperty("t").EnumerateArray())
            .Select(t => t.GetDouble());

    public void Dispose()
    {
        FlightGlobals.ActiveVessel = _previousActive;
        FlightGlobals.Vessels = _previousVessels;
        FlightGlobals.VesselsLoaded = _previousLoaded;
        Planetarium.UniversalTime = _previousUt;
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }

    // Match the adapter's reflected BDA names without loading the game or BDA.
    public sealed class ModuleWeapon : PartModule
    {
        public float timeFired;
    }

    public sealed class MissileBase : PartModule
    {
        public Vessel SourceVessel;
        public bool HasExploded;
        public string GetWeaponClass() => "Missile";
    }
}
