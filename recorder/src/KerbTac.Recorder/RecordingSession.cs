using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using KerbTac.Core;
using KerbTac.Core.Bda;
using KerbTac.Core.Sampling;
using KerbTac.Recorder.Bda;
using UnityEngine;

namespace KerbTac.Recorder
{
    internal enum RecorderState
    {
        Idle,
        Armed,
        Recording,
        Finalizing,
        Error
    }

    /// <summary>
    /// Owns one recording: arming, sampling, ring buffer spilling, events and
    /// final ZIP creation. Only main-thread methods touch Unity objects; the
    /// final archive is written on a background thread.
    /// </summary>
    internal sealed class VesselTrackState
    {
        public Vessel Vessel;
        public VesselInfo Info;
        public SampleRingBuffer Buffer;
        public TrackSegment Tail;
        public readonly List<SegmentSpill> Spills = new List<SegmentSpill>();
        public bool IncludeResources;
        public double LastSampleUt;
        public double LastWrittenSampleUt = double.NegativeInfinity;
        public bool BoundaryUnclaimed;
        public Quatd? LastPositionRotation;
        public VesselSample? LastPositionSample;
        public long SampleCount;
        public BdaVesselSnapshot Bda;
        public double LastActiveUt = double.NegativeInfinity;
        public double PositionIntervalSeconds = TrackPolicy.PositionIntervalSeconds;
        public readonly VesselSummaryStats Summary = new VesselSummaryStats();
        public TrackSampleMode Mode = TrackSampleMode.Full;
        public string Source = "active";
        public bool StaticWritten;
        public bool WasTracked;
        public bool Retired;
    }

    internal sealed class SegmentSpill
    {
        private readonly string _path;
        private readonly int _size;
        private readonly byte[] _digest;

        public SegmentSpill(string path, int size, byte[] digest)
        {
            _path = path;
            _size = size;
            _digest = digest;
        }

        public string ReadVerified()
        {
            byte[] bytes = new byte[_size];
            using (FileStream stream = File.OpenRead(_path))
            {
                int offset = 0;
                while (offset < bytes.Length)
                {
                    int count = stream.Read(bytes, offset, bytes.Length - offset);
                    if (count == 0) throw Corrupt();
                    offset += count;
                }
                if (stream.ReadByte() != -1) throw Corrupt();
            }
            using (SHA256 sha = SHA256.Create())
            {
                byte[] actual = sha.ComputeHash(bytes);
                for (int i = 0; i < actual.Length; i++)
                {
                    if (actual[i] != _digest[i]) throw Corrupt();
                }
            }
            return Encoding.UTF8.GetString(bytes);
        }

        private InvalidDataException Corrupt()
        {
            return new InvalidDataException("Recording spill changed after capture: " + _path);
        }
    }

    internal sealed class ActorTrackState
    {
        public Vessel Vessel;
        public ActorInfo Info;
        public double LastSampleUt;
    }

    /// <summary>An open Kepler interval for the active vessel in Space mode.</summary>
    internal sealed class OrbitSpan
    {
        public VesselTrackState State;
        public OrbitDef Orbit;
        public double StartUt;
        public double EndUt;
    }

    internal sealed class ImpactAttributionRecord
    {
        public double Ut;
        public string SourceId;
        public string TargetId;
        public string Weapon;
        public string ActorId;
        public string Body;
        public double Lat;
        public double Lon;
        public double Alt;
    }

    internal sealed class RecordingSession
    {
        private const int MaxTrackedVessels = 128;

        private readonly KerbTacSettings _settings;
        private readonly RecordingSaveQueue _saveQueue;
        private readonly Func<Stream, Stream> _wrapArchiveOutput;
        private readonly EventRecorder _events = new EventRecorder();
        private readonly PartStateWatcher _watchers = new PartStateWatcher();
        private readonly FlightPhaseDetector _phases = new FlightPhaseDetector();
        private readonly List<FlightPhaseEvent> _phaseEvents = new List<FlightPhaseEvent>(4);
        private readonly Dictionary<Guid, VesselTrackState> _tracks = new Dictionary<Guid, VesselTrackState>();
        private readonly List<VesselTrackState> _trackList = new List<VesselTrackState>();
        private readonly SampleScheduler _scheduler = new SampleScheduler();
        private readonly GapDetector _gapDetector = new GapDetector();
        private readonly BdaReflectionAdapter _bda;
        private BdaCombatAdapter _combat;
        private readonly List<GunfireBurstSignal> _gunfireSignals = new List<GunfireBurstSignal>();
        private readonly List<CountermeasureReleaseSignal> _countermeasureSignals = new List<CountermeasureReleaseSignal>();
        private readonly HealthDropTracker _healthDrops = new HealthDropTracker();
        private readonly CombatAttribution _attribution = new CombatAttribution();
        private readonly Dictionary<string, double> _lastDamageUt = new Dictionary<string, double>();
        private readonly List<ImpactAttributionRecord> _recentImpacts = new List<ImpactAttributionRecord>();
        private const double ImpactAttributionWindowSeconds = 15.0;
        private const double ImpactAttributionRadiusMeters = 200.0;
        private const double DamageAttributionWindowSeconds = 30.0;
        private readonly CountermeasureBurstTracker _countermeasureBursts = new CountermeasureBurstTracker();
        private readonly List<BdaLockSnapshot> _bdaLocks = new List<BdaLockSnapshot>();
        private readonly List<BdaEffectSnapshot> _bdaEffects = new List<BdaEffectSnapshot>();
        private readonly Dictionary<Guid, ActorTrackState> _actorTracks = new Dictionary<Guid, ActorTrackState>();
        private readonly HashSet<Guid> _actorIds = new HashSet<Guid>();
        private readonly HashSet<Guid> _splashedAtStart = new HashSet<Guid>();
        private readonly HashSet<Guid> _initialVesselIds = new HashSet<Guid>();
        private double _lastActorScanUt = double.NegativeInfinity;
        private double _lastScanUt = double.NegativeInfinity;
        private double _lastScanDiagUt = double.NegativeInfinity;
        private string _lastScanDiag;

        private SessionInfo _info;
        private VesselInfo _vesselInfo;
        private VesselTrackState _activeTrack;
        private string _recordingMode = RecordingModeResolver.Combat;
        private OrbitSpan _openOrbit;
        private Dictionary<string, BodyDef> _bodies;
        private bool _warnedTrackLimit;
        private string _tempDir;
        private int _nextSegmentIndex;
        private float _accumulator;
        // KSP's focus can be excluded even while Vessel remains the distance reference.
        private Vessel _focusedVessel;
        private readonly HashSet<Guid> _destroyedVesselIds = new HashSet<Guid>();
        // Attribution only: never use this to restore sampling or focus.
        private Guid? _lostFocusVesselId;
        private const double FocusLossGraceSeconds = 2.0;
        private double _activeLostUt = -1.0;
        private double _maxSampleGap;
        private double _sampleMillisecondsTotal;
        private int _sampleCountForPerf;

        private SaveOperation _save;

        private sealed class SaveTrack
        {
            public IList<SegmentSpill> Spills;
            public TrackSegment Orbit;
            public TrackSegment Tail;
            public SampleRingBuffer TailSamples;
        }

        // Only plain Core data and paths cross this boundary. The session stops
        // mutating this data before the worker starts and cannot restart until
        // it publishes the worker result.
        private sealed class SaveOperation : RecordingSaveJob
        {
            public SessionInfo Info;
            public Dictionary<string, BodyDef> Bodies;
            public List<KerbTacEvent> Events;
            public List<ActorInfo> Actors;
            public List<EffectInfo> Effects;
            public List<RadarLockInfo> Locks;
            public readonly List<VesselInfo> Vessels = new List<VesselInfo>();
            public readonly Dictionary<string, VesselSummaryStats> Stats = new Dictionary<string, VesselSummaryStats>();
            public readonly Dictionary<string, SaveTrack> Tracks = new Dictionary<string, SaveTrack>();
            public Func<Stream, Stream> WrapArchiveOutput;

            public void Run(string outputDirectory, string fileName)
            {
                try
                {
                    // Persist all remaining chunks before attempting to read any
                    // prior spill, so a failed archive leaves as much data as possible.
                    foreach (SaveTrack track in Tracks.Values)
                    {
                        if (track.Orbit == null && track.Tail == null) continue;
                        List<SegmentSpill> paths = new List<SegmentSpill>(track.Spills);
                        if (track.Orbit != null)
                        {
                            paths.Add(WriteSpill(TempDirectory, track.Orbit));
                            track.Orbit = null;
                        }
                        if (track.Tail != null)
                        {
                            track.Tail.Samples = track.TailSamples.Drain();
                            paths.Add(WriteSpill(TempDirectory, track.Tail));
                            track.Tail = null;
                            track.TailSamples = null;
                        }
                        track.Spills = paths;
                    }

                    SummaryInfo summary = SummaryBuilder.Build(Info, Vessels, Events, Actors, Bodies, Stats);
                    OutputPath = FileNameUtil.EnsureUnique(outputDirectory, fileName);
                    RecordingArchive.CreateStreaming(OutputPath, Info, Vessels, Bodies, Events,
                        id => ReadSpills(Tracks[id].Spills), Actors, Effects, Locks, summary, WrapArchiveOutput);
                    try { Directory.Delete(TempDirectory, true); }
                    catch (Exception ex) { CleanupError = ex.Message; }
                }
                catch (Exception ex)
                {
                    Error = ex.ToString();
                }
                finally
                {
                    Done = true;
                }
            }

            private static IEnumerable<string> ReadSpills(IList<SegmentSpill> spills)
            {
                for (int i = 0; i < spills.Count; i++)
                {
                    yield return spills[i].ReadVerified();
                }
            }
        }

        public RecordingSession(KerbTacSettings settings)
            : this(settings, RecordingSaveQueue.Shared, null)
        {
        }

        internal RecordingSession(KerbTacSettings settings, RecordingSaveQueue saveQueue,
            Func<Stream, Stream> wrapArchiveOutput)
        {
            _settings = settings;
            _saveQueue = saveQueue;
            _wrapArchiveOutput = wrapArchiveOutput;
            _bda = new BdaReflectionAdapter(
                AppDomain.CurrentDomain.GetAssemblies(),
                () => Planetarium.GetUniversalTime(),
                Log.Warn);
            _combat = new BdaCombatAdapter(AppDomain.CurrentDomain.GetAssemblies());
        }

        public RecorderState State { get; private set; }

        public Vessel Vessel { get; private set; }

        public string LastError { get; private set; }

        public string LastFilePath { get; private set; }

        public string SessionId
        {
            get { return _info != null ? _info.Id : null; }
        }

        public string VesselName
        {
            get { return Vessel != null ? Vessel.vesselName : "-"; }
        }

        private readonly RecordingClock _clock = new RecordingClock();

        public double StartUt { get; private set; }

        public double LastSampleUt { get; private set; }

        public int SampleCount { get; private set; }

        public int EventCount
        {
            get { return _events.Count; }
        }

        public List<ActorInfo> Actors { get; } = new List<ActorInfo>();

        public List<EffectInfo> Effects { get; } = new List<EffectInfo>();

        public List<RadarLockInfo> Locks { get; } = new List<RadarLockInfo>();

        public double ElapsedSeconds
        {
            get { return State == RecorderState.Idle || State == RecorderState.Armed ? 0 : _clock.ElapsedSeconds; }
        }

        /// <summary>Largest gap between consecutive samples, in seconds.</summary>
        public double MaxSampleGap
        {
            get { return _maxSampleGap; }
        }

        /// <summary>Mean time spent capturing one sample, in milliseconds.</summary>
        public double AverageSampleMilliseconds
        {
            get { return _sampleCountForPerf > 0 ? _sampleMillisecondsTotal / _sampleCountForPerf : 0.0; }
        }

        public string RecordingsDirectory
        {
            get { return _settings.RecordingsDirectory; }
        }

        /// <summary>Short BDA capability line for the recorder window.</summary>
        public string BdaStatus
        {
            get
            {
                if (_combat == null || !_combat.IsAvailable)
                {
                    return "not detected";
                }

                return (_combat.HasGuns ? "guns " : "") +
                       (_combat.HasCountermeasures ? "cm " : "") +
                       (_combat.HasActors ? "actors " : "") +
                       "actors=" + Actors.Count + " effects=" + Effects.Count;
            }
        }

        // ---------------------------------------------------------------- arming

        public void Arm(Vessel vessel)
        {
            if (State == RecorderState.Recording || State == RecorderState.Finalizing)
            {
                return;
            }
            if (vessel == null)
            {
                return;
            }

            Vessel = vessel;
            State = RecorderState.Armed;
            if (LastError != null)
            {
                LastError = null;
                State = RecorderState.Armed;
            }
        }

        public void Disarm()
        {
            if (State == RecorderState.Armed)
            {
                State = RecorderState.Idle;
                Vessel = null;
            }
        }

        public bool ShouldAutoStart(Vessel vessel)
        {
            if (State != RecorderState.Armed || vessel == null || !_settings.AutoStart)
            {
                return false;
            }
            if (!VesselTrackFilter.IsActiveAllowed(vessel.vesselType.ToString()))
            {
                return false;
            }
            bool throttle = vessel.ctrlState != null && vessel.ctrlState.mainThrottle > 0.05f;
            bool moving = vessel.srfSpeed > 3.0;
            return throttle || moving;
        }

        // -------------------------------------------------------------- recording

        public void Start(Vessel vessel, string reason, double ut, DateTime wallUtc)
        {
            if (State == RecorderState.Recording || State == RecorderState.Finalizing)
            {
                return;
            }
            if (vessel == null || vessel.mainBody == null)
            {
                return;
            }
            if (!VesselTrackFilter.IsActiveAllowed(vessel.vesselType.ToString()))
            {
                LastError = "Cannot record an active " + vessel.vesselType + " vessel";
                Log.Warn("Recording start refused: active vessel type " +
                         vessel.vesselType + " is excluded from M3");
                return;
            }

            try
            {
                Vessel = vessel;
                _focusedVessel = vessel;
                _lostFocusVesselId = null;
                _destroyedVesselIds.Clear();
                _tempDir = null;
                LastFilePath = null;
                _events.Clear();
                _watchers.Reset();
                _tracks.Clear();
                _trackList.Clear();
                _actorTracks.Clear();
                _actorIds.Clear();
                _splashedAtStart.Clear();
                _initialVesselIds.Clear();
                Actors.Clear();
                Effects.Clear();
                Locks.Clear();
                _bdaLocks.Clear();
                _bdaEffects.Clear();
                _bda.Reset();
                _combat.Reset();
                _gunfireSignals.Clear();
                _countermeasureSignals.Clear();
                _healthDrops.Clear();
                _attribution.Clear();
                _lastDamageUt.Clear();
                _recentImpacts.Clear();
                _countermeasureBursts.Reset();
                _lastActorScanUt = double.NegativeInfinity;
                _activeTrack = null;
                _openOrbit = null;
                _warnedTrackLimit = false;
                _nextSegmentIndex = 0;
                _accumulator = 0f;
                SampleCount = 0;
                LastError = null;
                _maxSampleGap = 0;
                _sampleMillisecondsTotal = 0;
                _sampleCountForPerf = 0;

                _info = new SessionInfo
                {
                    Id = SessionInfo.NewId(wallUtc),
                    Name = vessel.vesselName,
                    SaveName = HighLogic.SaveFolder,
                    Scene = "FLIGHT",
                    KspVersion = PluginInfo.KspVersion(),
                    UnityVersion = PluginInfo.UnityVersion(),
                    StartUt = ut,
                    EndUt = ut,
                    StartWallUtc = wallUtc,
                    EndWallUtc = wallUtc,
                    GeneratorName = PluginInfo.Name,
                    GeneratorVersion = PluginInfo.Version
                };
                _recordingMode = RecordingModeResolver.Resolve(_settings.RecordingMode, vessel.landedAt);
                _info.RecordingMode = _recordingMode;

                _bodies = BodyCatalog.Capture(vessel);
                _combat.SetBodyRotation(BodyCatalog.ToQuatd(vessel.mainBody.bodyTransform.rotation));
                UnloadedPositionSampler.ObserveBodyRotation(vessel.mainBody, ut, reset: true);
                // Only vessels that are already floating when recording starts
                // are allowed to use the ship model. A probe core or wreck that
                // falls into the sea later must stay debris.
                foreach (Vessel existing in KnownVessels())
                {
                    // Vessels present at recording start are not separation
                    // candidates; otherwise parked ground units are mistaken
                    // for payloads of a nearby unit on the first scan.
                    _initialVesselIds.Add(existing.id);
                    if (existing.situation == Vessel.Situations.SPLASHED)
                    {
                        _splashedAtStart.Add(existing.id);
                    }
                }

                _activeTrack = CreateTrack(vessel, "active", TrackSampleMode.Full, ut);
                _vesselInfo = _activeTrack.Info;

                _tempDir = Path.Combine(_settings.RecordingsDirectory, ".tmp_" + _info.Id);
                Directory.CreateDirectory(Path.Combine(_tempDir, "segments"));

                StartUt = ut;
                LastSampleUt = ut;
                _clock.Start(ut);
                _activeLostUt = -1.0;
                _lastScanUt = double.NegativeInfinity;
                _phases.Reset(vessel.situation.ToString(), ut);
                PartStateWatcher.LogRelevantModules(vessel);
                State = RecorderState.Recording;

                KerbTacEvent start = _events.Add(EventTypes.FlightStart, ut, vessel);
                start.WithData("reason", JsonValue.Str(reason));

                Log.Info("Recording started: vessel=" + vessel.vesselName +
                         " id=" + _vesselInfo.Id + " rate=" + _settings.SampleRateHz + "Hz" +
                         " mode=" + _recordingMode);
                LogAttitudeFrame(vessel);
            }
            catch (Exception ex)
            {
                Fail("Failed to start recording: " + ex.Message, ex);
            }
        }

        public void SetActiveVessel(Vessel vessel, double ut)
        {
            if (State != RecorderState.Recording || vessel == null || vessel.mainBody == null ||
                _destroyedVesselIds.Contains(vessel.id))
            {
                return;
            }
            if (_focusedVessel == vessel)
            {
                return;
            }
            VesselTrackState previous = _activeTrack;
            FlushOrbitSpan();
            _focusedVessel = vessel;
            _lostFocusVesselId = null;
            _activeLostUt = -1.0;
            _lastScanUt = double.NegativeInfinity;
            _watchers.Reset();
            if (!IsRecordableFocus(vessel))
            {
                // Keep the session alive and the last valid active vessel as a
                // distance reference, but never create a track for a Flag,
                // EVA, debris, asteroid or space object. The previous vessel
                // falls back to loaded/unloaded tracking on the next scan.
                _activeTrack = null;
                Log.Warn("Recording focus changed to an excluded vessel: " +
                         vessel.vesselName + "; continuing without an active track");
                return;
            }

            VesselTrackState state;
            if (!_tracks.TryGetValue(vessel.id, out state))
            {
                // Focus takes priority. The scan retires farthest unloaded
                // tracks first; the cap is soft when only loaded tracks remain.
                state = CreateTrack(vessel, "active", TrackSampleMode.Full, ut);
                if (_recordingMode == RecordingModeResolver.Space)
                {
                    ApplyStageLineage(state, vessel, ut);
                }
            }
            else
            {
                state.Vessel = vessel;
                if (state.Retired || state.Mode != TrackSampleMode.Full || state.Source != "active")
                {
                    // Returning from dormant, unloaded, or static tracking starts a
                    // new active segment so the archive does not mix sample policies.
                    state.Retired = false;
                    StartNewSegment(state, SegmentKinds.Flight, "active", ut, TrackSampleMode.Full);
                }
            }

            _activeTrack = state;
            if (_recordingMode == RecordingModeResolver.Space &&
                previous != null && previous != state &&
                previous.Info != null && state.Info != null &&
                SeparationHierarchy.ShouldPromotePayload(
                    previous.Info.Role,
                    state.Info.Role,
                    state.Info.ParentId,
                    previous.Info.Id,
                    MassKg(vessel),
                    MassKg(previous.Vessel)))
            {
                // The player switched to the newly released payload. The old
                // active vessel is the spent upper stage, not the parent.
                state.Info.Role = "payload";
                // Let the player use the VesselType preset (satellite/probe)
                // instead of drawing a released payload as a rocket.
                state.Info.ModelRole = null;
                state.Info.ParentId = null;
                state.Info.SeparatedUt = null;
                state.Info.StageIndex = -1;
                previous.Info.Role = "stage.upper";
                previous.Info.ParentId = state.Info.Id;
                previous.Info.SeparatedUt = ut;
                previous.Info.ModelRole = "space.stage";
                Log.Info("Payload separated: payload=" + state.Info.Id +
                         " spentStage=" + previous.Info.Id);
            }
            Vessel = vessel;
            _accumulator = 0f;
            _phases.Reset(vessel.situation.ToString(), ut);
            Log.Info("Recording focus changed: vessel=" + vessel.vesselName +
                     " elapsed=" + ElapsedSeconds.ToString("F1") + "s");
        }

        public void FixedTick(Vessel vessel, float fixedDeltaTime, double ut)
        {
            if (State != RecorderState.Recording)
            {
                return;
            }
            _clock.Tick(ut);
            try
            {
                // There may be no destruction or vessel-change callback. The
                // actual focus, not the last distance reference, owns grace.
                if (vessel == null || _destroyedVesselIds.Contains(vessel.id))
                {
                    BeginFocusLoss(ut);
                    if (ut - _activeLostUt > FocusLossGraceSeconds)
                    {
                        Stop("no_active_vessel", ut);
                    }
                    return;
                }
                if (vessel != _focusedVessel)
                {
                    SetActiveVessel(vessel, ut);
                }
                Vessel reference = ReferenceVessel;
                if (reference == null)
                {
                    return;
                }

                UnloadedPositionSampler.ObserveBodyRotation(reference.mainBody, ut);
                UpdateTrackedVessels(ut);
                UpdateOrbitSpan(ut);

                // The active vessel keeps the configured rate; other loaded
                // vessels are sampled on their own adaptive schedule. There is
                // no active track while the player is focused on an excluded
                // type (Flag/EVA/debris/asteroid/space object).
                if (_activeTrack != null)
                {
                    _accumulator += fixedDeltaTime;
                    float interval = _settings.SampleInterval;
                    if (_accumulator >= interval || AtUnclaimedBoundary(_activeTrack, ut))
                    {
                        // Do not burst after a pause; keep at most one interval of debt.
                        _accumulator = Math.Max(0f, Math.Min(_accumulator - interval, interval));
                        CaptureInto(_activeTrack, ut, true);
                    }
                }

                if (State != RecorderState.Recording)
                {
                    return;
                }

                for (int i = 0; i < _trackList.Count; i++)
                {
                    VesselTrackState state = _trackList[i];
                    if (state == _activeTrack || state.Vessel == null || state.Retired ||
                        state.Mode == TrackSampleMode.None)
                    {
                        continue;
                    }

                    if (state.Mode == TrackSampleMode.Static)
                    {
                        if (!state.StaticWritten)
                        {
                            CaptureInto(state, ut, false);
                        }
                        continue;
                    }

                    if (state.Mode == TrackSampleMode.Position)
                    {
                        if (AtUnclaimedBoundary(state, ut) ||
                            ut - state.LastSampleUt >= state.PositionIntervalSeconds - 0.01)
                        {
                            CaptureInto(state, ut, false);
                        }
                        continue;
                    }

                    if (!state.Vessel.loaded && (FlightGlobals.VesselsLoaded == null ||
                        !FlightGlobals.VesselsLoaded.Contains(state.Vessel)))
                    {
                        continue;
                    }
                    double distance = DistanceMeters(ReferenceVessel, state.Vessel);
                    double otherInterval = _scheduler.IntervalFor(false, false, distance);
                    if (AtUnclaimedBoundary(state, ut) ||
                        _scheduler.ShouldSample(ut, state.LastSampleUt, otherInterval))
                    {
                        CaptureInto(state, ut, false);
                    }
                }

                DrainBda();
                PollCombat(ut);
                UpdateActors(ut);
            }
            catch (Exception ex)
            {
                Fail("Sampling failed: " + ex.Message, ex);
            }
        }

        private static void LogAttitudeFrame(Vessel vessel)
        {
            try
            {
                Transform root = vessel.transform;
                Transform reference = vessel.ReferenceTransform;
                Log.Info("Attitude frame: ref=" + (reference != null ? reference.name : "null") +
                         " refF=" + FormatVector(reference != null ? reference.forward : Vector3.zero) +
                         " refU=" + FormatVector(reference != null ? reference.up : Vector3.zero) +
                         " rootF=" + FormatVector(root != null ? root.forward : Vector3.zero) +
                         " rootU=" + FormatVector(root != null ? root.up : Vector3.zero));
            }
            catch (Exception ex)
            {
                Log.Warn("Could not log attitude frame: " + ex.Message);
            }
        }

        private static string FormatVector(Vector3 value)
        {
            return "(" + value.x.ToString("F2") + "," + value.y.ToString("F2") + "," + value.z.ToString("F2") + ")";
        }

        public void Stop(string reason, double ut)
        {
            if (State != RecorderState.Recording)
            {
                return;
            }

            try
            {
                _clock.Tick(ut);
                State = RecorderState.Finalizing;
                _bda.Stop();
                DrainBda();
                IReadOnlyList<GunfireBurstSignal> gunfire = _combat.Stop();
                if (_settings.RecordGunfire)
                {
                    for (int i = 0; i < gunfire.Count; i++)
                    {
                        RecordGunfire(gunfire[i]);
                    }
                }
                OrbitSpan orbit = _openOrbit;
                TrackSegment orbitSegment = CloseOrbitSpan();
                if (_settings.RecordCombatDetail)
                {
                    IReadOnlyList<CountermeasureReleaseSignal> pending = _countermeasureBursts.FlushAll();
                    for (int i = 0; i < pending.Count; i++)
                    {
                        RecordCountermeasure(pending[i]);
                    }
                }
                AppendBdaLocks();
                AppendBdaEffects();
                _info.EndUt = Math.Max(Math.Max(ut, StartUt), LastSampleUt);
                _info.EndWallUtc = DateTime.UtcNow;
                LastSampleUt = _info.EndUt;

                // Freeze ownership; there is no disk I/O from here to the handoff.
                SaveOperation save = new SaveOperation
                {
                    TempDirectory = _tempDir,
                    Info = _info,
                    Bodies = _bodies,
                    Actors = new List<ActorInfo>(Actors),
                    Effects = new List<EffectInfo>(Effects),
                    Locks = new List<RadarLockInfo>(Locks),
                    WrapArchiveOutput = _wrapArchiveOutput
                };
                for (int i = 0; i < _trackList.Count; i++)
                {
                    VesselTrackState state = _trackList[i];
                    bool hasOrbit = orbitSegment != null && orbit.State == state;
                    if (state.Buffer.Count == 0 && state.Spills.Count == 0 && !hasOrbit)
                    {
                        continue;
                    }

                    SaveTrack track = new SaveTrack { Spills = state.Spills };
                    if (hasOrbit) track.Orbit = orbitSegment;
                    if (state.Buffer.Count > 0)
                    {
                        state.Tail.Index = _nextSegmentIndex++;
                        state.Tail.Body = state.Info.Body;
                        track.Tail = state.Tail;
                        track.TailSamples = state.Buffer;
                        state.Buffer = null;
                        state.Tail = null;
                    }
                    save.Vessels.Add(state.Info);
                    save.Stats.Add(state.Info.Id, state.Summary);
                    save.Tracks.Add(state.Info.Id, track);
                }

                if (save.Vessels.Count == 0)
                {
                    // Nothing recorded: no file to write.
                    Log.Warn("Recording stopped with no samples; no file written.");
                    CleanupTemp();
                    State = RecorderState.Idle;
                    return;
                }

                Vessel actual = FlightGlobals.ActiveVessel;
                KerbTacEvent end = _events.Add(EventTypes.FlightEnd, _info.EndUt,
                    IsRecordableFocus(actual) && save.Tracks.ContainsKey(actual.id.ToString()) ? actual : null);
                end.WithData("reason", JsonValue.Str(reason));
                end.WithData("duration", JsonValue.Num(_info.Duration));
                _events.NormalizeCombat();
                save.Events = _events.Sorted();

                string fileName = FileNameUtil.BuildRecordingFileName(
                    _info.SaveName, _vesselInfo.Name, DateTime.UtcNow);

                Log.Info("Stopping recording (" + reason + "): " + SampleCount + " samples, " +
                         save.Events.Count + " events, max gap " + _maxSampleGap.ToString("F2") +
                         " s, avg capture " + AverageSampleMilliseconds.ToString("F3") +
                         " ms; writing archive...");
                string outputDir = Path.GetDirectoryName(_tempDir);
                save.Worker = new Thread(() => save.Run(outputDir, fileName))
                {
                    IsBackground = true,
                    Name = "KerbTacFinalize"
                };
                _saveQueue.Start(save);
                _save = save;
            }
            catch (Exception ex)
            {
                Fail("Failed to stop recording: " + ex.Message, ex);
            }
        }

        /// <summary>Updates the Flight UI if the owning scene still exists.</summary>
        public void TickFinalize()
        {
            SaveOperation save = _save;
            if (State != RecorderState.Finalizing || save == null || !save.Done)
            {
                return;
            }

            _save = null;
            if (save.Error != null)
            {
                LastError = save.FailureMessage;
                State = RecorderState.Error;
            }
            else
            {
                LastFilePath = save.OutputPath;
                State = RecorderState.Idle;
                _tempDir = null;
            }
        }

        public void ClearError()
        {
            if (State == RecorderState.Error)
            {
                LastError = null;
                State = RecorderState.Idle;
            }
        }

        public void Shutdown(bool applicationQuitting = false)
        {
            if (State == RecorderState.Recording)
            {
                Stop(applicationQuitting ? "application_quit" : "scene_exit", Planetarium.GetUniversalTime());
            }

            // Both paths hand off immediately. The persistent addon owns
            // reporting and applies the quit budget across all pending saves.
        }

        // --------------------------------------------------------------- helpers

        private void SpillHalf(VesselTrackState state)
        {
            int take = Math.Max(1, state.Buffer.Count / 2);
            List<VesselSample> samples = state.Buffer.TakeOldest(take);
            TrackSegment segment = new TrackSegment
            {
                Index = _nextSegmentIndex++,
                LogicalIndex = state.Tail.LogicalIndex,
                ChunkIndex = state.Tail.ChunkIndex,
                Kind = state.Tail.Kind,
                Body = state.Info.Body,
                Source = state.Tail.Source,
                IncludeResources = state.IncludeResources,
                PositionOnly = state.Tail.PositionOnly,
                Samples = samples
            };
            WriteSegmentToDisk(state, segment);

            // The remaining in-memory samples are the next storage chunk of the
            // same logical flight.
            state.Tail.ChunkIndex = segment.ChunkIndex + 1;
        }

        /// <summary>
        /// Opens, extends, or closes the Kepler interval for the active vessel.
        /// Only Space mode writes orbit segments, and only while the vessel is
        /// packed or under time warp; samples stay authoritative otherwise.
        /// </summary>
        private void UpdateOrbitSpan(double ut)
        {
            if (_recordingMode != RecordingModeResolver.Space || _activeTrack == null || Vessel == null)
            {
                FlushOrbitSpan();
                return;
            }

            bool warping = Vessel.packed || TimeWarp.CurrentRate > 1.0;
            if (!warping)
            {
                FlushOrbitSpan();
                return;
            }

            OrbitDef orbit = CaptureOrbit(Vessel, ut);
            if (orbit == null)
            {
                FlushOrbitSpan();
                return;
            }

            if (_openOrbit != null && !SameOrbitShape(_openOrbit.Orbit, orbit))
            {
                FlushOrbitSpan();
            }
            if (_openOrbit == null)
            {
                _openOrbit = new OrbitSpan
                {
                    State = _activeTrack,
                    Orbit = orbit,
                    StartUt = ut,
                    EndUt = ut
                };
            }
            else
            {
                _openOrbit.EndUt = ut;
            }
        }

        private void FlushOrbitSpan()
        {
            OrbitSpan span = _openOrbit;
            TrackSegment segment = CloseOrbitSpan();
            if (segment == null) return;
            WriteSegmentToDisk(span.State, segment);
            Log.Info("Orbit span written: " + span.StartUt.ToString("F1") + ".." +
                     span.EndUt.ToString("F1") + " s");
        }

        private TrackSegment CloseOrbitSpan()
        {
            OrbitSpan span = _openOrbit;
            _openOrbit = null;
            if (span == null || span.State == null)
            {
                return null;
            }
            if (span.EndUt - span.StartUt < 1.0)
            {
                return null;
            }

            int index = _nextSegmentIndex++;
            return new TrackSegment
            {
                Index = index,
                // Orbit segments are not storage chunks of a flight segment;
                // a negative logical index keeps them in their own group.
                LogicalIndex = -1 - index,
                ChunkIndex = 0,
                Kind = SegmentKinds.Orbit,
                Body = span.State.Info.Body,
                StartUtOverride = span.StartUt,
                EndUtOverride = span.EndUt,
                Orbit = span.Orbit
            };
        }

        private static OrbitDef CaptureOrbit(Vessel vessel, double ut)
        {
            Orbit orbit = vessel != null ? vessel.orbit : null;
            if (orbit == null || orbit.semiMajorAxis <= 0 || orbit.referenceBody == null)
            {
                return null;
            }
            const double toDegrees = 180.0 / Math.PI;
            return new OrbitDef
            {
                Epoch = orbit.epoch,
                SemiMajorAxis = orbit.semiMajorAxis,
                Eccentricity = orbit.eccentricity,
                InclinationDeg = orbit.inclination,
                LanDeg = orbit.LAN,
                ArgPeDeg = orbit.argumentOfPeriapsis,
                MeanAnomalyDeg = orbit.meanAnomalyAtEpoch * toDegrees,
                BodyFixedRotation = orbit.referenceBody == vessel.mainBody
                    ? CaptureOrbitRotation(orbit.referenceBody, ut)
                    : null
            };
        }

        private static OrbitBodyRotationDef CaptureOrbitRotation(CelestialBody body, double ut)
        {
            double period = body.rotationPeriod;
            if (!body.rotates || period == 0.0 || !Vec3d.IsFiniteNumber(period)
                || !Vec3d.IsFiniteNumber(ut))
            {
                return null;
            }

            // Evaluate KSP 1.12.5 CelestialBody.CBUpdate's absolute rotationAngle
            // at this tick's Planetarium UT. The cached rotationAngle may not
            // have been updated yet; directRotAngle excludes the Zup rebase.
            double rate = 360.0 * (1.0 / period);
            double phase = (body.initialRotation + rate * ut) % 360.0;
            if (rate == 0.0 || !Vec3d.IsFiniteNumber(phase))
            {
                return null;
            }

            return new OrbitBodyRotationDef { EpochUt = ut, AngleDeg = phase, RateDegPerSec = rate };
        }

        private static bool SameOrbitShape(OrbitDef a, OrbitDef b)
        {
            if (a == null || b == null)
            {
                return false;
            }
            double scale = Math.Max(1.0, Math.Abs(a.SemiMajorAxis));
            if (Math.Abs(a.SemiMajorAxis - b.SemiMajorAxis) / scale > 1e-4)
            {
                return false;
            }
            if (Math.Abs(a.Eccentricity - b.Eccentricity) > 1e-4)
            {
                return false;
            }
            return AngleClose(a.InclinationDeg, b.InclinationDeg)
                && AngleClose(a.LanDeg, b.LanDeg)
                && AngleClose(a.ArgPeDeg, b.ArgPeDeg)
                && SameOrbitRotation(a.BodyFixedRotation, b.BodyFixedRotation);
        }

        private static bool SameOrbitRotation(OrbitBodyRotationDef a, OrbitBodyRotationDef b)
        {
            if (a == null || b == null) return a == b;
            double expected = a.AngleDeg + a.RateDegPerSec * (b.EpochUt - a.EpochUt);
            return a.RateDegPerSec == b.RateDegPerSec
                && Math.Abs(OrbitBatchCorrection.Wrap(b.AngleDeg - expected)) <= 1e-6;
        }

        private static bool AngleClose(double a, double b)
        {
            double diff = Math.Abs(a - b) % 360.0;
            if (diff > 180.0)
            {
                diff = 360.0 - diff;
            }
            return diff < 0.25;
        }

        /// <summary>Closes the current buffer and starts a new logical segment. Used when
        /// a vessel changes between active, loaded, unloaded and static modes.
        /// </summary>
        private void StartNewSegment(
            VesselTrackState state,
            string kind,
            string source,
            double ut,
            TrackSampleMode mode)
        {
            List<VesselSample> samples = SegmentBoundary.ClosePrevious(state.Buffer, ut);
            if (samples.Count > 0)
            {
                TrackSegment previous = new TrackSegment
                {
                    Index = _nextSegmentIndex++,
                    LogicalIndex = state.Tail.LogicalIndex,
                    ChunkIndex = state.Tail.ChunkIndex,
                    Kind = state.Tail.Kind,
                    Body = state.Info.Body,
                    Source = state.Tail.Source,
                    IncludeResources = state.IncludeResources,
                    PositionOnly = state.Tail.PositionOnly,
                    Samples = samples
                };
                WriteSegmentToDisk(state, previous);
            }

            bool includeResources = mode == TrackSampleMode.Full
                && state.Vessel != null
                && VesselSampler.HasResourceModules(state.Vessel);
            state.Mode = mode;
            state.Source = source;
            state.IncludeResources = includeResources;
            state.StaticWritten = false;
            state.WasTracked = true;
            // Never give position catch-up a cursor before the transition.
            // If the old tail already owns this instant, do not sample it twice.
            state.LastSampleUt = SegmentBoundary.NextStartUt(ut);
            state.BoundaryUnclaimed = state.LastWrittenSampleUt < ut;
            state.LastPositionRotation = null;
            state.LastPositionSample = null;
            state.Tail = new TrackSegment
            {
                Index = 0,
                LogicalIndex = state.Tail.LogicalIndex + 1,
                ChunkIndex = 0,
                Kind = kind,
                Body = state.Info.Body,
                Source = source,
                IncludeResources = includeResources,
                PositionOnly = mode != TrackSampleMode.Full
            };
        }

        private void WriteSegmentToDisk(VesselTrackState state, TrackSegment segment)
        {
            state.Spills.Add(WriteSpill(_tempDir, segment));
            if (segment.Samples.Count > 0)
            {
                state.LastWrittenSampleUt = Math.Max(state.LastWrittenSampleUt, segment.EndUt);
            }
        }

        private static SegmentSpill WriteSpill(string tempDirectory, TrackSegment segment)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(SessionSerializer.WriteSegment(segment));
            string path = Path.Combine(tempDirectory, "segments", segment.Index.ToString() + ".json");
            byte[] digest;
            using (SHA256 sha = SHA256.Create()) digest = sha.ComputeHash(bytes);
            using (FileStream stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(bytes, 0, bytes.Length);
            }
            return new SegmentSpill(path, bytes.Length, digest);
        }

        private VesselTrackState CreateTrack(
            Vessel vessel,
            string source,
            TrackSampleMode mode,
            double ut)
        {
            bool loaded = vessel.loaded;
            var info = new VesselInfo
            {
                Id = vessel.id.ToString(),
                Name = vessel.vesselName,
                Type = vessel.vesselType.ToString(),
                Body = BodyCatalog.BodyName(vessel.mainBody),
                Color = ColorPalette.ForId(vessel.id.ToString()),
                RootPart = loaded ? VesselSampler.PartName(vessel.rootPart) : "",
                PartCount = loaded && vessel.parts != null ? vessel.parts.Count : 0,
                CrewCount = loaded ? vessel.GetCrewCount() : 0,
                Kind = loaded
                    ? VesselKindClassifier.Classify(
                        vessel.vesselType.ToString(),
                        FindModuleByName(vessel, "ModuleRoboticServoRotor", "ModuleRotor", "ModuleDeployableRotor") != null,
                        FindModuleByName(vessel, "ModuleWheelBase", "ModuleWheelBogey", "ModuleWheelMotor", "KSPWheelBase") != null,
                        FindModuleByName(vessel, "ModuleLiftingSurface", "ModuleControlSurface", "FARControllableSurface") != null,
                        FindModuleByName(vessel, "MissileFire") != null,
                        FindModuleByName(vessel, "BDModulePilotAI") != null)
                    : "unknown"
            };

            if (_splashedAtStart.Contains(vessel.id) &&
                UsesShipModelWhenSplashed(vessel.vesselType))
            {
                info.Kind = "sea/ship";
            }
            bool detachedCore = LooksLikeDetachedCore(vessel);
            if (detachedCore)
            {
                info.Kind = "debris";
            }
            if (loaded)
            {
                info.ModelRole = _recordingMode == RecordingModeResolver.Space &&
                                 vessel.vesselType == VesselType.Debris
                    ? "debris"
                    : ObjectRoleClassifier.Classify(
                         vessel.vesselType.ToString(), BuildRoleFeatures(vessel), vessel.landedAt,
                         vessel.situation == Vessel.Situations.LANDED ||
                         vessel.situation == Vessel.Situations.PRELAUNCH);
                if (detachedCore)
                {
                    info.ModelRole = "debris";
                }
                else if (info.ModelRole != null &&
                         (info.ModelRole.StartsWith("ground.") || info.ModelRole.StartsWith("sea.")))
                {
                    info.Threat = ThreatRangeReader.Read(vessel);
                }
            }

            foreach (KeyValuePair<string, BodyDef> pair in BodyCatalog.Capture(vessel))
            {
                if (!_bodies.ContainsKey(pair.Key))
                {
                    _bodies[pair.Key] = pair.Value;
                }
            }

            bool includeResources = mode == TrackSampleMode.Full
                && loaded
                && VesselSampler.HasResourceModules(vessel);
            var state = new VesselTrackState
            {
                Vessel = vessel,
                Info = info,
                Buffer = new SampleRingBuffer(_settings.RingCapacity),
                IncludeResources = includeResources,
                LastSampleUt = mode == TrackSampleMode.Position
                    ? ut - TrackPolicy.PositionIntervalSeconds
                    : ut,
                LastActiveUt = source == "active" ? ut : double.NegativeInfinity,
                PositionIntervalSeconds = TrackPolicy.PositionIntervalSeconds,
                Mode = mode,
                Source = source,
                WasTracked = true
            };
            state.Tail = new TrackSegment
            {
                Index = 0,
                Kind = mode == TrackSampleMode.Static ? SegmentKinds.Static : SegmentKinds.Flight,
                Body = info.Body,
                Source = source,
                IncludeResources = includeResources,
                PositionOnly = mode != TrackSampleMode.Full
            };

            _tracks[vessel.id] = state;
            _trackList.Add(state);
            return state;
        }

        /// <summary>
        /// Scans the save once per second and applies the M3 tracking policy to
        /// every vessel: active, loaded, and distance-filtered unloaded craft.
        /// Dormant entries stay in the archive so a re-entry never duplicates a
        /// vessel id, but they stop producing samples.
        /// </summary>
        private void UpdateTrackedVessels(double ut)
        {
            Vessel active = ReferenceVessel;
            if (active == null || ut - _lastScanUt < 1.0)
            {
                return;
            }
            _lastScanUt = ut;

            HashSet<Guid> loadedIds = new HashSet<Guid>();
            if (FlightGlobals.VesselsLoaded != null)
            {
                for (int i = 0; i < FlightGlobals.VesselsLoaded.Count; i++)
                {
                    Vessel loadedVessel = FlightGlobals.VesselsLoaded[i];
                    if (loadedVessel != null)
                    {
                        loadedIds.Add(loadedVessel.id);
                    }
                }
            }

            int vesselCount = 0;
            int nullBodyCount = 0;
            int actorCount = 0;
            int ignoredCount = 0;
            int otherBodyCount = 0;
            int trackedCount = 0;
            int loadedCount = 0;
            foreach (Vessel vessel in KnownVessels())
            {
                vesselCount++;
                if (_destroyedVesselIds.Contains(vessel.id))
                {
                    continue;
                }
                if (vessel.mainBody == null)
                {
                    nullBodyCount++;
                    continue;
                }
                if (IsActorVessel(vessel))
                {
                    actorCount++;
                    continue;
                }
                bool ignoredType = IsIgnoredType(vessel);
                if (ignoredType && !(_recordingMode == RecordingModeResolver.Space &&
                                     vessel.vesselType == VesselType.Debris &&
                                     IsNearActiveVessel(vessel, ut)))
                {
                    ignoredCount++;
                    continue;
                }
                if (_actorIds.Contains(vessel.id))
                {
                    ignoredCount++;
                    continue;
                }
                // M3 is Kerbin-only: ignore vessels whose main body differs.
                if (active != null && active.mainBody != null &&
                    vessel.mainBody != active.mainBody)
                {
                    otherBodyCount++;
                    continue;
                }

                bool isActive = _activeTrack != null && vessel == _activeTrack.Vessel;
                bool loaded = isActive || vessel.loaded || loadedIds.Contains(vessel.id);
                if (loaded)
                {
                    loadedCount++;
                }

                VesselTrackState state;
                _tracks.TryGetValue(vessel.id, out state);

                double distance;
                try
                {
                    distance = UnloadedPositionSampler.DistanceMeters(active, vessel, ut);
                }
                catch (Exception)
                {
                    // The active vessel may lack an orbit during a scene change.
                    distance = loaded ? 0.0 : double.PositiveInfinity;
                }

                TrackDecision decision = TrackPolicy.Decide(
                    isActive,
                    loaded,
                    vessel.packed,
                    TimeWarp.CurrentRate,
                    distance,
                    _settings.UnloadedRangeKm,
                    state != null && state.WasTracked,
                    UnloadedPositionSampler.IsStaticSituation(vessel),
                    state != null ? state.Mode : TrackSampleMode.None,
                    TimeWarp.WarpMode == TimeWarp.Modes.LOW);

                if (decision.Mode == TrackSampleMode.None)
                {
                    if (state != null)
                    {
                        state.Mode = TrackSampleMode.None;
                        state.WasTracked = false;
                    }
                    continue;
                }

                string kind = decision.Mode == TrackSampleMode.Static
                    ? SegmentKinds.Static
                    : SegmentKinds.Flight;

                if (state == null)
                {
                    if (_recordingMode == RecordingModeResolver.Space &&
                        vessel.vesselType == VesselType.Debris &&
                        !IsRecordableSeparation(vessel))
                    {
                        // Small separation debris (clamps, decouplers, RCS
                        // blocks) never gets its own track in Space mode.
                        ignoredCount++;
                        continue;
                    }
                    // Keep the nearest unloaded tracks: when the cap is full,
                    // replace the farthest evictable track with this candidate.
                    // Loaded and active vessels are never evicted.
                    if (!loaded && RecordingTrackCount() >= MaxTrackedVessels &&
                        !TryEvictFartherTrack(ut, distance, loadedIds))
                    {
                        WarnTrackLimit();
                        continue;
                    }
                    state = CreateTrack(vessel, decision.Source, decision.Mode, ut);
                    if (_recordingMode == RecordingModeResolver.Space)
                    {
                        ApplyStageLineage(state, vessel, ut);
                    }
                }
                else if (state.Retired || decision.StartNewSegment ||
                         state.Source != decision.Source)
                {
                    StartNewSegment(state, kind, decision.Source, ut, decision.Mode);
                }

                if (_recordingMode == RecordingModeResolver.Space &&
                    vessel.vesselType == VesselType.Debris &&
                    vessel.loaded && state.Info != null && state.Info.Role == null)
                {
                    // Mass may be zero on the frame the debris spawns; retry
                    // until the part is fully initialised.
                    ApplyStageLineage(state, vessel, ut);
                }

                state.WasTracked = true;
                state.Retired = false;
                state.PositionIntervalSeconds = TrackPolicy.PositionInterval(
                    isActive,
                    ut - state.LastActiveUt <= TrackPolicy.RecentActiveWindowSeconds);
                trackedCount++;
            }

            if (_settings.DebugLogging)
            {
                string activeBody = active != null && active.mainBody != null
                    ? active.mainBody.bodyName
                    : "null";
                bool activeOrbitNull = active == null || active.orbit == null;
                string diag = "scan total=" + vesselCount +
                              " nullBody=" + nullBodyCount +
                              " actor=" + actorCount +
                              " ignored=" + ignoredCount +
                              " otherBody=" + otherBodyCount +
                              " loaded=" + loadedCount +
                              " tracked=" + trackedCount +
                              " tracks=" + RecordingTrackCount() +
                              " activeBody=" + activeBody +
                              " activeOrbitNull=" + activeOrbitNull +
                              " rangeKm=" + _settings.UnloadedRangeKm;
                if (ut - _lastScanDiagUt >= 30.0 || diag != _lastScanDiag)
                {
                    Log.Info(diag);
                    _lastScanDiagUt = ut;
                    _lastScanDiag = diag;
                }
            }

            if (RecordingTrackCount() > MaxTrackedVessels)
            {
                EnforceTrackCap(ut, loadedIds);
            }
        }

        private static IEnumerable<Vessel> KnownVessels()
        {
            // KSP's two lists need not agree around a scene/physics transition.
            HashSet<Guid> seen = new HashSet<Guid>();
            List<Vessel> vessels = FlightGlobals.Vessels;
            if (vessels != null)
            {
                foreach (Vessel vessel in vessels)
                {
                    if (vessel != null && seen.Add(vessel.id)) yield return vessel;
                }
            }
            vessels = FlightGlobals.VesselsLoaded;
            if (vessels != null)
            {
                foreach (Vessel vessel in vessels)
                {
                    if (vessel != null && seen.Add(vessel.id)) yield return vessel;
                }
            }
        }

        private int RecordingTrackCount()
        {
            int count = 0;
            for (int i = 0; i < _trackList.Count; i++)
            {
                VesselTrackState state = _trackList[i];
                if (!state.Retired && state.Mode != TrackSampleMode.None)
                {
                    count++;
                }
            }
            return count;
        }

        private bool TryEvictFartherTrack(double ut, double candidateDistance, HashSet<Guid> loadedIds)
        {
            List<VesselTrackState> states = new List<VesselTrackState>();
            List<double> distances = new List<double>();
            List<bool> evictable = new List<bool>();
            for (int i = 0; i < _trackList.Count; i++)
            {
                VesselTrackState state = _trackList[i];
                if (state == _activeTrack || state.Retired ||
                    state.Mode == TrackSampleMode.None || state.Vessel == null)
                {
                    continue;
                }
                states.Add(state);
                distances.Add(TrackDistance(ut, state));
                evictable.Add(!state.Vessel.loaded && !loadedIds.Contains(state.Vessel.id));
            }

            int index = TrackCapPolicy.FindFarthestEvictable(
                distances, evictable, candidateDistance);
            if (index < 0 || index >= states.Count)
            {
                return false;
            }

            VesselTrackState victim = states[index];
            victim.Mode = TrackSampleMode.None;
            victim.WasTracked = false;
            victim.Retired = true;
            Log.Info("Track cap reached; replaced " + victim.Info.Name +
                     " at " + distances[index].ToString("F0") + " m with a nearer vessel.");
            return true;
        }

        private void EnforceTrackCap(double ut, HashSet<Guid> loadedIds)
        {
            List<VesselTrackState> candidates = new List<VesselTrackState>();
            for (int i = 0; i < _trackList.Count; i++)
            {
                VesselTrackState state = _trackList[i];
                if (state == _activeTrack || state.Retired ||
                    state.Mode == TrackSampleMode.None ||
                    state.Vessel == null || state.Vessel.loaded || loadedIds.Contains(state.Vessel.id))
                {
                    continue;
                }
                candidates.Add(state);
            }

            candidates.Sort(delegate(VesselTrackState a, VesselTrackState b)
            {
                return TrackDistance(ut, b).CompareTo(TrackDistance(ut, a));
            });

            int count = RecordingTrackCount();
            for (int i = 0; i < candidates.Count && count > MaxTrackedVessels; i++)
            {
                VesselTrackState state = candidates[i];
                state.Mode = TrackSampleMode.None;
                state.WasTracked = false;
                state.Retired = true;
                count--;
            }
        }

        /// <summary>
        /// Use the last tracked vessel for distance after an excluded switch,
        /// or the excluded vessel itself if that reference has been destroyed.
        /// </summary>
        private Vessel ReferenceVessel
        {
            get
            {
                return _activeTrack != null ? _activeTrack.Vessel :
                    Vessel != null ? Vessel : _focusedVessel;
            }
        }

        private bool IsRecordableFocus(Vessel vessel)
        {
            return vessel != null && vessel.mainBody != null &&
                !_destroyedVesselIds.Contains(vessel.id) &&
                VesselTrackFilter.IsActiveAllowed(vessel.vesselType.ToString()) &&
                !_actorIds.Contains(vessel.id) && !IsActorVessel(vessel);
        }

        private void BeginFocusLoss(double ut)
        {
            if (_activeLostUt >= 0.0)
            {
                return;
            }
            FlushOrbitSpan();
            _activeTrack = null;
            _lostFocusVesselId = _focusedVessel != null ? (Guid?)_focusedVessel.id : null;
            _focusedVessel = null;
            Vessel = null;
            _accumulator = 0f;
            _activeLostUt = ut;
        }

        private double TrackDistance(double ut, VesselTrackState state)
        {
            try
            {
                return UnloadedPositionSampler.DistanceMeters(ReferenceVessel, state.Vessel, ut);
            }
            catch (Exception)
            {
                return DistanceMeters(ReferenceVessel, state.Vessel);
            }
        }

        private void WarnTrackLimit()
        {
            if (_warnedTrackLimit)
            {
                return;
            }
            _warnedTrackLimit = true;
            Log.Warn("More than " + MaxTrackedVessels +
                     " vessels in range; tracking active and nearest only.");
        }

        private static bool IsIgnoredType(Vessel vessel)
        {
            return VesselTrackFilter.IsIgnoredType(vessel.vesselType.ToString());
        }

        private static double DistanceMeters(Vessel from, Vessel to)
        {
            if (from == null || to == null)
            {
                return 0.0;
            }
            Vector3 a = from.transform.position;
            Vector3 b = to.transform.position;
            double dx = (double)a.x - b.x;
            double dy = (double)a.y - b.y;
            double dz = (double)a.z - b.z;
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }

        private static bool AtUnclaimedBoundary(VesselTrackState state, double ut)
        {
            return state.BoundaryUnclaimed && ut == state.LastSampleUt;
        }

        private void CaptureInto(VesselTrackState state, double ut, bool active,
            ObservedBodyRotation positionBatch = null, OrbitBatchCorrection correction = default(OrbitBatchCorrection))
        {
            if (State != RecorderState.Recording)
            {
                return;
            }
            if (active)
            {
                state.LastActiveUt = ut;
            }
            if (state.Mode == TrackSampleMode.Static && state.StaticWritten)
            {
                return;
            }
            if (!SegmentBoundary.CanCaptureAt(ut, state.LastSampleUt,
                state.BoundaryUnclaimed || state.SampleCount == 0))
            {
                return;
            }
            if (state.Mode == TrackSampleMode.Position && positionBatch == null)
            {
                positionBatch = UnloadedPositionSampler.BeginBatch(state.Vessel.mainBody,
                    state.LastSampleUt, state.LastPositionRotation);
                if (active && ut - state.LastSampleUt >= 1.0 &&
                    positionBatch != null && state.LastPositionSample.HasValue &&
                    state.Vessel.orbit != null && !UnloadedPositionSampler.IsStaticSituation(state.Vessel))
                {
                    var saved = state.LastPositionSample.Value;
                    var reevaluated = UnloadedPositionSampler.Capture(state.Vessel, saved.T,
                        positionBatch.At(saved.T));
                    double period = state.Vessel.mainBody.rotationPeriod;
                    correction = OrbitBatchCorrection.Between(saved, reevaluated, ut,
                        period > 1.0 ? 360.0 / period : 0.0);
                }
                double[] catchUp = PositionKeyframeSchedule.Times(
                    state.LastSampleUt,
                    ut,
                    state.PositionIntervalSeconds,
                    10000);
                for (int i = 0; i < catchUp.Length; i++)
                {
                    if (State != RecorderState.Recording)
                    {
                        return;
                    }
                    CaptureInto(state, catchUp[i], active, positionBatch, correction);
                }
            }

            if (state.Mode == TrackSampleMode.Position && !AtUnclaimedBoundary(state, ut) &&
                ut - state.LastSampleUt < state.PositionIntervalSeconds - 0.01)
            {
                return;
            }

            long startedTicks = Stopwatch.GetTimestamp();
            Quatd? positionRotation = positionBatch != null ? (Quatd?)positionBatch.At(ut) : null;
            VesselSample sample = state.Mode == TrackSampleMode.Full
                ? VesselSampler.Capture(state.Vessel, ut)
                : UnloadedPositionSampler.Capture(state.Vessel, ut, positionRotation, correction.At(ut));

            if (state.Mode == TrackSampleMode.Full && _bda.IsAvailable)
            {
                state.Bda = _bda.Snapshot(state.Vessel);
                // Keep the name/type captured when the track was created.
                // KSP renames a crashed payload to "... Debris" and flips its
                // VesselType; using the final value made the launch replay show
                // a debris block for the whole flight.
                string previousSide = state.Info.Side;
                ApplyBda(state.Bda, state.Info);
                if (!string.IsNullOrEmpty(state.Info.Side) &&
                    !string.Equals(previousSide, state.Info.Side, StringComparison.Ordinal))
                {
                    KerbTacEvent change = _events.Add(EventTypes.TeamChange, ut, state.Vessel);
                    change.WithData("side", JsonValue.Str(state.Info.Side));
                    change.WithData("team", JsonValue.Str(state.Info.Team));
                }
                RecordHealthDrop(state, ut);
            }
            if (state.Mode == TrackSampleMode.Full)
            {
                BdaSampleHealth.Apply(ref sample, _bda.IsAvailable, state.Bda.Health);
            }
            if (state.Mode == TrackSampleMode.Static)
            {
                state.StaticWritten = true;
            }
            state.Buffer.Add(sample);
            state.LastPositionRotation = positionRotation;
            state.LastPositionSample = state.Mode == TrackSampleMode.Position ? (VesselSample?)sample : null;
            state.BoundaryUnclaimed = false;
            if (state.Mode == TrackSampleMode.Full)
            {
                state.Summary.Observe(sample, state.Info.Body, BodyRadius(state.Info.Body));
            }
            else
            {
                state.Summary.ObservePosition(sample, state.Info.Body, BodyRadius(state.Info.Body));
            }
            state.SampleCount++;
            SampleCount++;

            if (active && state.Mode == TrackSampleMode.Full && state.SampleCount > 1)
            {
                double gap = sample.T - state.LastSampleUt;
                if (gap > _maxSampleGap) _maxSampleGap = gap;
                if (_gapDetector.ShouldAddGap(state.LastSampleUt, sample.T))
                {
                    _info.Gaps.Add(new SessionGap
                    {
                        StartUt = state.LastSampleUt,
                        EndUt = sample.T,
                        Reason = "sample_gap"
                    });
                }
            }
            state.LastSampleUt = sample.T;
            if (sample.T > LastSampleUt)
            {
                LastSampleUt = sample.T;
            }
            if (sample.T > _info.EndUt)
            {
                _info.EndUt = sample.T;
            }

            if (active && state.Mode == TrackSampleMode.Full)
            {
                PollPartState(sample);
                ApplyPhaseEvents(sample, ut);
            }

            _sampleMillisecondsTotal += (Stopwatch.GetTimestamp() - startedTicks) * 1000.0 / Stopwatch.Frequency;
            _sampleCountForPerf++;

            if (_settings.DebugLogging && _sampleCountForPerf % 600 == 0)
            {
                Log.Info("Perf: " + _sampleCountForPerf + " samples, avg capture " +
                         AverageSampleMilliseconds.ToString("F3") + " ms, max gap " +
                         _maxSampleGap.ToString("F2") + " s");
            }

            if (state.Buffer.Count >= _settings.RingCapacity)
            {
                SpillHalf(state);
            }
        }

        private void DrainBda()
        {
            IReadOnlyList<BdaLockSnapshot> locks = _bda.DrainClosedLocks();
            for (int i = 0; i < locks.Count; i++)
            {
                _bdaLocks.Add(locks[i]);
            }

            IReadOnlyList<BdaEffectSnapshot> effects = _bda.DrainEffects();
            for (int i = 0; i < effects.Count; i++)
            {
                _bdaEffects.Add(effects[i]);
            }
        }

        private static void ApplyBda(BdaVesselSnapshot bda, VesselInfo info)
        {
            if (!string.IsNullOrEmpty(bda.Team))
            {
                info.Team = bda.Team;
            }
            if (!string.IsNullOrEmpty(bda.Side))
            {
                info.Side = bda.Side;
            }
            if (bda.Health >= 0.0 && bda.Health <= 1.0)
            {
                info.Health = bda.Health;
            }
            if (!string.IsNullOrEmpty(bda.PrimaryWeapon) && !info.Loadout.Contains(bda.PrimaryWeapon))
            {
                info.Loadout.Add(bda.PrimaryWeapon);
            }
        }

        private void PollCombat(double ut)
        {
            _gunfireSignals.Clear();
            _countermeasureSignals.Clear();
            _combat.PollCombat(TrackedVessels(), ut, _gunfireSignals, _countermeasureSignals);

            for (int i = 0; i < _gunfireSignals.Count; i++)
            {
                if (_settings.RecordGunfire)
                {
                    RecordGunfire(_gunfireSignals[i]);
                }
            }
            for (int i = 0; i < _countermeasureSignals.Count; i++)
            {
                if (_settings.RecordCombatDetail)
                {
                    AddCountermeasureEffect(_countermeasureSignals[i]);
                }
            }

            IReadOnlyList<CountermeasureReleaseSignal> bursts =
                _countermeasureBursts.Poll(_countermeasureSignals, ut);
            for (int i = 0; i < bursts.Count; i++)
            {
                if (_settings.RecordCombatDetail)
                {
                    RecordCountermeasure(bursts[i]);
                }
            }
        }

        private IEnumerable<Vessel> TrackedVessels()
        {
            for (int i = 0; i < _trackList.Count; i++)
            {
                Vessel vessel = _trackList[i].Vessel;
                if (vessel != null && !_destroyedVesselIds.Contains(vessel.id))
                {
                    yield return vessel;
                }
            }
        }

        private void RecordGunfire(GunfireBurstSignal signal)
        {
            if (signal == null || signal.Rounds <= 0)
            {
                return;
            }

            VesselTrackState state = FindTrack(signal.VesselId);
            if (state == null || state.Vessel == null)
            {
                return;
            }

            string body;
            double lat;
            double lon;
            double alt;
            BodyPoint(state, signal.PositionBf, out body, out lat, out lon, out alt);

            KerbTacEvent evt = _events.Add(
                IsRocketAmmo(signal) ? EventTypes.WeaponRelease : EventTypes.Gunfire,
                signal.StartUt,
                state.Vessel);
            evt.WithPosition(body, lat, lon, alt);
            evt.WithOutcome(IsRocketAmmo(signal) ? "launched" : "fired");
            evt.WithPart(signal.PartId, signal.ModuleIndex);
            if (IsRocketAmmo(signal))
            {
                evt.WithData("weaponClass", JsonValue.Str("weapon/rocket"));
                evt.WithData("count", JsonValue.Num(signal.Rounds));
            }
            if (!string.IsNullOrEmpty(signal.Ammo))
            {
                evt.WithWeapon(signal.Ammo);
            }
            else if (!string.IsNullOrEmpty(signal.WeaponType))
            {
                evt.WithWeapon(signal.WeaponType);
            }
            if (!string.IsNullOrEmpty(state.Bda.LockedTargetId))
            {
                evt.WithTarget(state.Bda.LockedTargetId);
            }

            evt.WithData("rounds", JsonValue.Num(signal.Rounds));
            evt.WithData("rpm", JsonValue.Num(signal.RoundsPerMinute));
            evt.WithData("caliber", JsonValue.Num(signal.Caliber));
            evt.WithData("speed", JsonValue.Num(signal.MuzzleSpeed));
            evt.WithData("weaponType", JsonValue.Str(signal.WeaponType));
            evt.WithData("ammo", JsonValue.Str(signal.Ammo));
            evt.WithData("dirX", JsonValue.Num(signal.DirectionBf.X));
            evt.WithData("dirY", JsonValue.Num(signal.DirectionBf.Y));
            evt.WithData("dirZ", JsonValue.Num(signal.DirectionBf.Z));
            evt.WithData("endDirX", JsonValue.Num(signal.EndDirectionBf.X));
            evt.WithData("endDirY", JsonValue.Num(signal.EndDirectionBf.Y));
            evt.WithData("endDirZ", JsonValue.Num(signal.EndDirectionBf.Z));
            evt.WithData("endUt", JsonValue.Num(signal.EndUt));
            if (!string.IsNullOrEmpty(signal.TracerColor))
            {
                evt.WithData("tracerColor", JsonValue.Str(signal.TracerColor));
            }
        }

        private void RecordCountermeasure(CountermeasureReleaseSignal signal)
        {
            if (signal == null || signal.Count <= 0)
            {
                return;
            }

            VesselTrackState state = FindTrack(signal.VesselId);
            if (state == null || state.Vessel == null)
            {
                return;
            }

            string body;
            double lat;
            double lon;
            double alt;
            BodyPoint(state, signal.PositionBf, out body, out lat, out lon, out alt);

            string cmName = BdaCombatKinds.CountermeasureName(signal.Kind);
            string type = signal.Kind == BdaCountermeasureKind.Chaff
                ? EventTypes.Chaff
                : signal.Kind == BdaCountermeasureKind.Flare
                    ? EventTypes.Flare
                    : EventTypes.Countermeasure;

            KerbTacEvent evt = _events.Add(type, signal.Ut, state.Vessel);
            evt.WithPosition(body, lat, lon, alt);
            evt.WithData("cmType", JsonValue.Str(cmName));
            evt.WithData("count", JsonValue.Num(signal.Count));
            evt.WithData("endUt", JsonValue.Num(signal.EndUt));
            evt.WithData("ejectVelocity", JsonValue.Num(signal.EjectVelocity));
            evt.WithData("dirX", JsonValue.Num(signal.DirectionBf.X));
            evt.WithData("dirY", JsonValue.Num(signal.DirectionBf.Y));
            evt.WithData("dirZ", JsonValue.Num(signal.DirectionBf.Z));
            evt.WithPart(signal.PartId, signal.ModuleIndex);
        }

        private void AddCountermeasureEffect(CountermeasureReleaseSignal signal)
        {
            if (signal == null || signal.Count <= 0)
            {
                return;
            }

            VesselTrackState state = FindTrack(signal.VesselId);
            if (state == null || state.Vessel == null)
            {
                return;
            }

            string body;
            double lat;
            double lon;
            double alt;
            BodyPoint(state, signal.PositionBf, out body, out lat, out lon, out alt);

            string cmName = BdaCombatKinds.CountermeasureName(signal.Kind);
            int particles = signal.Count * 4;
            if (particles < 4) particles = 4;
            if (particles > 128) particles = 128;
            string kind = string.IsNullOrEmpty(cmName) || cmName == "unknown" ? "smoke" : cmName;
            double life = signal.Kind == BdaCountermeasureKind.Flare
                ? 6.0
                : signal.Kind == BdaCountermeasureKind.Smoke
                    ? 10.0
                    : 5.0;

            AddEffect(kind, signal.Ut, body, lat, lon, alt, particles,
                unchecked((int)(signal.Ut * 1000.0) ^ signal.ModuleIndex),
                life, signal.VesselId, null, signal.VelocityBf, 2.5);
        }

        private bool TryFindDamageAttacker(
            string targetId,
            double ut,
            out CombatAttacker attacker)
        {
            if (_attribution.TryFind(targetId, ut, out attacker))
            {
                return true;
            }

            CombatAttacker best = default(CombatAttacker);
            double bestUt = double.NegativeInfinity;
            bool found = false;

            for (int i = 0; i < Actors.Count; i++)
            {
                ActorInfo info = Actors[i];
                if (info == null || string.IsNullOrEmpty(info.ParentId) ||
                    !string.Equals(info.TargetId, targetId, StringComparison.Ordinal))
                {
                    continue;
                }

                double actorUt = info.EndUt;
                if (info.Samples.Count > 0)
                {
                    actorUt = info.Samples[info.Samples.Count - 1].T;
                }
                if (actorUt < ut - DamageAttributionWindowSeconds || actorUt > ut + 1.0 || actorUt <= bestUt)
                {
                    continue;
                }

                bestUt = actorUt;
                best = new CombatAttacker
                {
                    AttackerId = info.ParentId,
                    Weapon = info.Weapon,
                    ActorId = info.Id,
                    Ut = actorUt
                };
                found = true;
            }

            for (int i = 0; i < _trackList.Count; i++)
            {
                VesselTrackState state = _trackList[i];
                if (state.Info == null || state.Vessel == null ||
                    string.IsNullOrEmpty(state.Bda.LockedTargetId) ||
                    !string.Equals(state.Bda.LockedTargetId, targetId, StringComparison.Ordinal))
                {
                    continue;
                }
                double lockUt = state.LastSampleUt;
                if (lockUt < ut - DamageAttributionWindowSeconds || lockUt > ut + 1.0 || lockUt <= bestUt)
                {
                    continue;
                }

                bestUt = lockUt;
                best = new CombatAttacker
                {
                    AttackerId = state.Info.Id,
                    Weapon = state.Bda.PrimaryWeapon,
                    ActorId = null,
                    Ut = lockUt
                };
                found = true;
            }

            attacker = best;
            return found;
        }

        private void RecordHealthDrop(VesselTrackState state, double ut)
        {
            if (state == null || state.Info == null)
            {
                return;
            }

            IReadOnlyList<HealthDropSignal> drops = _healthDrops.Poll(
                new[]
                {
                    new HealthInput
                    {
                        VesselId = state.Info.Id,
                        Ut = ut,
                        Health = state.Bda.Health
                    }
                },
                ut);

            for (int i = 0; i < drops.Count; i++)
            {
                HealthDropSignal drop = drops[i];
                _lastDamageUt[drop.VesselId] = drop.Ut;
                CombatAttacker attacker;
                bool attributed = TryFindDamageAttacker(drop.VesselId, drop.Ut, out attacker);

                KerbTacEvent evt = _events.Add(EventTypes.Hit, drop.Ut, state.Vessel);
                evt.WithDamage(drop.Damage);
                evt.WithData("healthBefore", JsonValue.Num(drop.Before));
                evt.WithData("healthAfter", JsonValue.Num(drop.After));
                if (attributed)
                {
                    _attribution.Record(
                        attacker.AttackerId,
                        drop.VesselId,
                        attacker.Weapon,
                        attacker.ActorId,
                        drop.Ut);
                    evt.WithSource(attacker.AttackerId);
                    evt.WithWeapon(attacker.Weapon);
                    if (!string.IsNullOrEmpty(attacker.ActorId))
                    {
                        evt.WithData("actorId", JsonValue.Str(attacker.ActorId));
                    }
                }
            }
        }

        private void AddEffect(
            string kind,
            double ut,
            string body,
            double lat,
            double lon,
            double alt,
            int count,
            int seed,
            double life,
            string sourceId,
            string targetId,
            Vec3d velocityBf,
            double spread)
        {
            if (count < 1) count = 1;
            if (count > 512) count = 512;
            if (life <= 0.0) life = 1.0;

            Effects.Add(new EffectInfo
            {
                Ut = ut,
                Kind = kind,
                Body = body,
                SourceId = sourceId,
                TargetId = targetId,
                Lat = lat,
                Lon = lon,
                Alt = alt,
                Count = count,
                Seed = seed,
                Vx = velocityBf.X,
                Vy = velocityBf.Y,
                Vz = velocityBf.Z,
                Spread = spread,
                Life = life
            });
        }

        private static bool IsRocketAmmo(GunfireBurstSignal signal)
        {
            string text = (signal.Ammo ?? string.Empty) + " " + (signal.WeaponType ?? string.Empty);
            return text.IndexOf("rocket", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   text.IndexOf("hydra", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static void BodyPoint(
            VesselTrackState state,
            Vec3d pointBf,
            out string body,
            out double lat,
            out double lon,
            out double alt)
        {
            body = state.Info != null ? state.Info.Body : null;
            double radius = state.Vessel != null && state.Vessel.mainBody != null
                ? state.Vessel.mainBody.Radius
                : 600000.0;
            BodyFixed.ToLatLonAlt(pointBf, radius, out lat, out lon, out alt);
        }

        private VesselTrackState FindTrack(string vesselId)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                return null;
            }

            for (int i = 0; i < _trackList.Count; i++)
            {
                VesselTrackState state = _trackList[i];
                if (state.Info != null && string.Equals(state.Info.Id, vesselId, StringComparison.Ordinal))
                {
                    return state;
                }
            }

            return null;
        }

        private void AppendBdaLocks()
        {
            for (int i = 0; i < _bdaLocks.Count; i++)
            {
                BdaLockSnapshot lockInfo = _bdaLocks[i];
                Locks.Add(new RadarLockInfo
                {
                    SourceId = lockInfo.SourceId,
                    TargetId = lockInfo.TargetId,
                    Sensor = lockInfo.Sensor,
                    Mode = lockInfo.Mode,
                    StartUt = lockInfo.StartUt,
                    EndUt = lockInfo.EndUt
                });
            }
            _bdaLocks.Clear();
        }

        private void AppendBdaEffects()
        {
            string body = _vesselInfo != null ? _vesselInfo.Body : null;
            for (int i = 0; i < _bdaEffects.Count; i++)
            {
                BdaEffectSnapshot effect = _bdaEffects[i];
                int count = effect.Count;
                if (count < 1) count = 1;
                if (count > 512) count = 512;
                Effects.Add(new EffectInfo
                {
                    Ut = effect.Ut,
                    Kind = effect.Kind,
                    Body = !string.IsNullOrEmpty(effect.Body) ? effect.Body : body,
                    SourceId = effect.SourceId,
                    TargetId = effect.TargetId,
                    Lat = effect.Lat,
                    Lon = effect.Lon,
                    Alt = effect.Alt,
                    Count = count,
                    Seed = effect.Seed,
                    Vx = effect.Vx,
                    Vy = effect.Vy,
                    Vz = effect.Vz,
                    Spread = effect.Spread,
                    Life = effect.Life > 0.0 ? effect.Life : 1.0
                });
            }
            _bdaEffects.Clear();
        }

        private void UpdateActors(double ut)
        {
            try
            {
                if (ut - _lastActorScanUt >= 0.5)
                {
                    _lastActorScanUt = ut;
                    ScanActorVessels(ut);
                }

                foreach (ActorTrackState state in _actorTracks.Values)
                {
                    if (state.Vessel == null || !state.Vessel.loaded)
                    {
                        continue;
                    }
                    if (ut - state.LastSampleUt < 0.05)
                    {
                        continue;
                    }

                    VesselSample sample = VesselSampler.Capture(state.Vessel, ut);
                    state.Info.Samples.Add(sample);
                    state.Info.EndUt = Math.Max(state.Info.EndUt, ut);
                    state.LastSampleUt = ut;
                }
            }
            catch (Exception ex)
            {
                Log.Warn("Actor sampling failed: " + ex.Message);
            }
        }

        private void ScanActorVessels(double ut)
        {
            ActorPollResult poll = _combat.PollActors(ut);
            for (int i = 0; i < poll.Spawns.Count; i++)
            {
                AddActor(poll.Spawns[i]);
            }
            for (int i = 0; i < poll.Ends.Count; i++)
            {
                HandleActorEnd(poll.Ends[i]);
            }
        }

        private void FlushActorEnds(double ut)
        {
            ActorPollResult poll = _combat.PollActors(ut);
            for (int i = 0; i < poll.Spawns.Count; i++)
            {
                AddActor(poll.Spawns[i]);
            }
            for (int i = 0; i < poll.Ends.Count; i++)
            {
                HandleActorEnd(poll.Ends[i]);
            }
        }

        private void AddActor(ActorSpawnSignal spawn)
        {
            if (spawn == null || string.IsNullOrEmpty(spawn.ActorId))
            {
                return;
            }

            Vessel vessel = _combat.FindLoadedVessel(spawn.ActorId);
            if (vessel == null || vessel.mainBody == null)
            {
                return;
            }
            if (_actorIds.Contains(vessel.id))
            {
                return;
            }
            VesselTrackState existingTrack;
            if (_tracks.TryGetValue(vessel.id, out existingTrack) && existingTrack != _activeTrack)
            {
                // A bomb can briefly be tracked as a normal vessel before its
                // MissileBase module appears. The actor track is authoritative.
                existingTrack.Retired = true;
                _tracks.Remove(vessel.id);
                _trackList.Remove(existingTrack);
            }

            ActorInfo info = new ActorInfo
            {
                Id = spawn.ActorId,
                Name = string.IsNullOrEmpty(spawn.Name) ? spawn.Weapon : spawn.Name,
                Kind = spawn.Kind,
                ParentId = spawn.ParentId,
                TargetId = spawn.TargetId,
                Weapon = spawn.Weapon,
                Body = BodyCatalog.BodyName(vessel.mainBody),
                StartUt = spawn.Ut,
                EndUt = spawn.Ut
            };

            if (!string.IsNullOrEmpty(spawn.ParentId))
            {
                Guid parentId;
                VesselTrackState parentTrack;
                if (Guid.TryParse(spawn.ParentId, out parentId) && _tracks.TryGetValue(parentId, out parentTrack))
                {
                    info.Side = parentTrack.Info.Side;
                }
            }

            if ((string.IsNullOrEmpty(info.Side) || info.Side == "neutral") && _bda.IsAvailable)
            {
                BdaVesselSnapshot snapshot = _bda.Snapshot(vessel);
                if (!string.IsNullOrEmpty(snapshot.Side) && snapshot.Side != "neutral")
                {
                    info.Side = snapshot.Side;
                }
            }

            foreach (KeyValuePair<string, BodyDef> pair in BodyCatalog.Capture(vessel))
            {
                if (_bodies != null)
                {
                    _bodies[pair.Key] = pair.Value;
                }
            }

            ActorTrackState state = new ActorTrackState
            {
                Vessel = vessel,
                Info = info,
                LastSampleUt = spawn.Ut - 1.0
            };
            _actorTracks[vessel.id] = state;
            _actorIds.Add(vessel.id);
            Actors.Add(info);

            RecordWeaponRelease(spawn, vessel);
            Log.Info("Actor: " + info.Kind + " " + vessel.vesselName + " id=" + info.Id +
                     (info.ParentId != null ? " parent=" + info.ParentId : ""));
        }

        private void RecordWeaponRelease(ActorSpawnSignal spawn, Vessel actorVessel)
        {
            Vessel parent = FindTrackVessel(spawn.ParentId);
            if (parent == null && !string.IsNullOrEmpty(spawn.ParentId))
            {
                parent = _combat.FindLoadedVessel(spawn.ParentId);
            }
            Vessel shooter = parent != null ? parent : actorVessel;
            KerbTacEvent evt = _events.Add(EventTypes.WeaponRelease, spawn.Ut, shooter);
            evt.WithOutcome("launched");
            if (!string.IsNullOrEmpty(spawn.Weapon))
            {
                evt.WithWeapon(spawn.Weapon);
            }
            if (!string.IsNullOrEmpty(spawn.TargetId))
            {
                evt.WithTarget(spawn.TargetId);
            }
            evt.WithData("actorId", JsonValue.Str(spawn.ActorId));
            evt.WithData("weaponClass", JsonValue.Str(spawn.Kind));
            evt.WithData("count", JsonValue.Num(1));
        }

        private void HandleActorEnd(ActorEndSignal end)
        {
            if (end == null || string.IsNullOrEmpty(end.ActorId))
            {
                return;
            }

            Guid actorId;
            ActorTrackState state;
            if (!Guid.TryParse(end.ActorId, out actorId) || !_actorTracks.TryGetValue(actorId, out state))
            {
                return;
            }

            ActorInfo info = state.Info;
            double resolvedUt = info.EndUt > 0.0 ? info.EndUt : end.Ut;
            if (info.Samples.Count > 0)
            {
                VesselSample lastSample = info.Samples[info.Samples.Count - 1];
                resolvedUt = lastSample.T;
                end.Lat = lastSample.Latitude;
                end.Lon = lastSample.Longitude;
                end.Alt = lastSample.Altitude;
            }
            info.EndUt = Math.Max(info.EndUt, end.Ut);
            _actorTracks.Remove(actorId);

            bool bombLike = end.ActorClass == BdaActorClass.Bomb || end.ActorClass == BdaActorClass.Rocket;
            _attribution.Record(end.ParentId, end.TargetId, end.Weapon, end.ActorId, resolvedUt);
            if (end.Reason != "exploded" && !bombLike)
            {
                Vessel target = FindTrackVessel(end.TargetId);
                KerbTacEvent miss = _events.Add(EventTypes.Miss, resolvedUt, target);
                miss.WithPosition(end.Body, end.Lat, end.Lon, end.Alt);
                miss.WithOutcome(end.Reason == "missed" ? "missed" : "expired");
                if (!string.IsNullOrEmpty(end.ParentId))
                {
                    miss.WithSource(end.ParentId);
                }
                if (!string.IsNullOrEmpty(end.TargetId))
                {
                    miss.WithTarget(end.TargetId);
                }
                if (!string.IsNullOrEmpty(end.Weapon))
                {
                    miss.WithWeapon(end.Weapon);
                }
                miss.WithData("actorId", JsonValue.Str(end.ActorId));
                miss.WithData("weaponClass", JsonValue.Str(BdaCombatKinds.ActorKind(end.ActorClass)));
                miss.WithData("reason", JsonValue.Str(end.Reason));
                return;
            }

            string eventType = bombLike ? EventTypes.Impact : EventTypes.ProximityDetonation;
            Vessel victim = FindTrackVessel(end.TargetId);
            KerbTacEvent evt = _events.Add(eventType, resolvedUt, victim);
            evt.WithPosition(end.Body, end.Lat, end.Lon, end.Alt);
            evt.WithOutcome("detonated");
            if (!string.IsNullOrEmpty(end.ParentId))
            {
                evt.WithSource(end.ParentId);
            }
            if (!string.IsNullOrEmpty(end.TargetId))
            {
                evt.WithTarget(end.TargetId);
            }
            if (!string.IsNullOrEmpty(end.Weapon))
            {
                evt.WithWeapon(end.Weapon);
            }
            evt.WithData("actorId", JsonValue.Str(end.ActorId));
            evt.WithData("weaponClass", JsonValue.Str(BdaCombatKinds.ActorKind(end.ActorClass)));
            evt.WithData("tntMass", JsonValue.Num(end.TntMass));
            evt.WithData("warhead", JsonValue.Str(end.Warhead));
            evt.WithData("sourceType", JsonValue.Str(end.ExplosionSource));
            evt.WithData("reason", JsonValue.Str(bombLike && end.Reason == "lost" ? "impact" : end.Reason));
            _recentImpacts.Add(new ImpactAttributionRecord
            {
                Ut = resolvedUt,
                SourceId = end.ParentId,
                TargetId = end.TargetId,
                Weapon = end.Weapon,
                ActorId = end.ActorId,
                Body = end.Body,
                Lat = end.Lat,
                Lon = end.Lon,
                Alt = end.Alt
            });
        }

        private ImpactAttributionRecord FindImpactAttribution(Vessel vessel, double ut)
        {
            if (vessel == null || vessel.mainBody == null)
            {
                return null;
            }

            string body = BodyCatalog.BodyName(vessel.mainBody);
            double radius = vessel.mainBody.Radius;
            Vec3d target = BodyFixed.FromLatLonAlt(
                vessel.latitude,
                vessel.longitude,
                vessel.altitude,
                radius);

            for (int i = _recentImpacts.Count - 1; i >= 0; i--)
            {
                ImpactAttributionRecord record = _recentImpacts[i];
                double age = ut - record.Ut;
                if (age > ImpactAttributionWindowSeconds + 1.0)
                {
                    _recentImpacts.RemoveAt(i);
                    continue;
                }
                if (age < -1.0 ||
                    !string.Equals(record.Body, body, StringComparison.Ordinal))
                {
                    continue;
                }

                if (!string.IsNullOrEmpty(record.TargetId) &&
                    string.Equals(record.TargetId, vessel.id.ToString(), StringComparison.Ordinal))
                {
                    return record;
                }

                Vec3d impact = BodyFixed.FromLatLonAlt(record.Lat, record.Lon, record.Alt, radius);
                if (BodyFixed.Distance(impact, target) <= ImpactAttributionRadiusMeters)
                {
                    return record;
                }
            }

            return null;
        }

        private Vessel FindTrackVessel(string vesselId)
        {
            VesselTrackState state = FindTrack(vesselId);
            return state != null ? state.Vessel : null;
        }

        private bool HasRecentHealthDamage(string vesselId, double ut)
        {
            double damageUt;
            if (!_lastDamageUt.TryGetValue(vesselId, out damageUt))
            {
                return false;
            }
            double age = ut - damageUt;
            return age >= -1.0 && age <= DamageAttributionWindowSeconds;
        }

        private static bool IsActorVessel(Vessel vessel)
        {
            bool hasMissile = FindModuleByName(vessel, "MissileBase", "MissileLauncher") != null;
            bool hasFireControl = FindModuleByName(vessel, "MissileFire", "BDModulePilotAI") != null;
            return ActorClassifier.IsTransientActor(hasMissile, hasFireControl);
        }

        /// <summary>Collects the part evidence the model-role classifier needs.</summary>
        private RoleFeatures BuildRoleFeatures(Vessel vessel)
        {
            return new RoleFeatures
            {
                IsFairing = IsFairingVessel(vessel),
                // RadarWarningReceiver and radarDataReceiver are passive; only
                // a ModuleRadar that can scan/lock (or has a range) is a radar.
                HasRadar = HasActiveRadar(vessel),
                HasLauncher = HasModuleTypeMatching(vessel, ModuleSignatures.IsMissileLauncher),
                HasWeapon = HasModuleTypeMatching(vessel, ModuleSignatures.IsWeapon),
                HasWheel = FindModuleByName(
                    vessel,
                    "ModuleWheelBase",
                    "ModuleWheelBogey",
                    "ModuleWheelMotor",
                    "KSPWheelBase") != null,
                HasRotor = FindModuleByName(
                    vessel,
                    "ModuleRoboticServoRotor",
                    "ModuleRotor",
                    "ModuleDeployableRotor") != null,
                HasRocketEngine = HasModuleTypeContaining(vessel, "ModuleEngines"),
                HasDecoupler = HasModuleTypeMatching(vessel, ModuleSignatures.IsDecoupler),
                StartedSplashed = _splashedAtStart.Contains(vessel.id)
            };
        }

        private static bool HasModuleTypeContaining(Vessel vessel, string fragment)
        {
            if (vessel == null || vessel.parts == null)
            {
                return false;
            }

            for (int p = 0; p < vessel.parts.Count; p++)
            {
                Part part = vessel.parts[p];
                if (part == null || part.Modules == null)
                {
                    continue;
                }
                for (int m = 0; m < part.Modules.Count; m++)
                {
                    PartModule module = part.Modules[m];
                    if (module == null)
                    {
                        continue;
                    }
                    if (module.GetType().Name.IndexOf(fragment, StringComparison.Ordinal) >= 0)
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private static bool HasActiveRadar(Vessel vessel)
        {
            if (vessel == null || vessel.parts == null)
            {
                return false;
            }

            for (int p = 0; p < vessel.parts.Count; p++)
            {
                Part part = vessel.parts[p];
                if (part == null || part.Modules == null)
                {
                    continue;
                }
                for (int m = 0; m < part.Modules.Count; m++)
                {
                    PartModule module = part.Modules[m];
                    if (module == null || !ModuleSignatures.IsRadar(module.GetType().Name))
                    {
                        continue;
                    }

                    bool canScan = ToBool(BdaReflectionCache.Get(module, "canScan"));
                    bool canLock = ToBool(BdaReflectionCache.Get(module, "canLock"));
                    double rangeM = ModuleSignatures.PickRadarRange(
                        0,
                        ToDouble(BdaReflectionCache.Get(module, "radarMaxDistanceDetect")),
                        ToDouble(BdaReflectionCache.Get(module, "radarMaxDistance", "maxRange")));
                    if (ModuleSignatures.IsActiveRadar(canScan, canLock, rangeM))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private static bool ToBool(object value)
        {
            try
            {
                return value != null && Convert.ToBoolean(value);
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static double ToDouble(object value)
        {
            try
            {
                return value == null ? 0 : Convert.ToDouble(value);
            }
            catch (Exception)
            {
                return 0;
            }
        }

        private static bool HasModuleTypeMatching(Vessel vessel, Func<string, bool> predicate)
        {
            if (vessel == null || vessel.parts == null || predicate == null)
            {
                return false;
            }

            for (int p = 0; p < vessel.parts.Count; p++)
            {
                Part part = vessel.parts[p];
                if (part == null || part.Modules == null)
                {
                    continue;
                }
                for (int m = 0; m < part.Modules.Count; m++)
                {
                    PartModule module = part.Modules[m];
                    if (module != null && predicate(module.GetType().Name))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private bool IsNearActiveVessel(Vessel vessel, double ut)
        {
            Vessel active = _activeTrack != null ? _activeTrack.Vessel : Vessel;
            if (active == null || vessel == null)
            {
                return false;
            }
            try
            {
                return UnloadedPositionSampler.DistanceMeters(active, vessel, ut) <= 500.0;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Marks a newly seen separated vessel as a recorded stage. Only large
        /// parts near a tracked parent qualify; small clamps and RCS bits are
        /// ignored, matching the M4B object granularity decision.
        /// </summary>
        private void ApplyStageLineage(VesselTrackState state, Vessel vessel, double ut)
        {
            if (state == null || vessel == null || !vessel.loaded ||
                state.Info == null || state.Info.Role != null)
            {
                return;
            }
            VesselTrackState parent = FindSeparationParent(state, vessel, ut);
            if (parent == null)
            {
                return;
            }

            bool docked = IsDockedSeparation(vessel, parent);
            if (!StageLineagePolicy.IsEligibleForLineage(
                    _initialVesselIds.Contains(vessel.id), vessel.loaded, docked))
            {
                return;
            }

            // GetTotalMass() is tonnes; the policy and the log use kilograms.
            double massKg = 0.0;
            try
            {
                massKg = vessel.GetTotalMass() * 1000.0;
            }
            catch (Exception)
            {
                // A vessel spawning this frame may not report mass yet.
            }
            int partCount = vessel.parts != null ? vessel.parts.Count : 0;
            if (partCount == 0 || IsLaunchClampVessel(vessel))
            {
                return;
            }
            bool hasTank = HasFuelTank(vessel);
            bool hasEngine = HasModuleTypeContaining(vessel, "ModuleEngines");
            bool fairing = IsFairingVessel(vessel);
            bool hasCommand = HasCommandModule(vessel);
            if (!LargePartPolicy.IsSeparatedPartLarge(
                    massKg, partCount, hasTank, hasEngine, fairing, hasCommand))
            {
                return;
            }

            bool externalTank = IsExternalTank(vessel);
            // A command module without a main engine is a payload/satellite,
            // not an upper stage (e.g. the satellite released by a Falcon 9).
            bool payload = hasCommand && !hasEngine;
            string role = StageRoleAssigner.Assign(
                fairing, externalTank, docked, payload, CountSeparatedStages(parent.Info.Id, ut));

            state.Info.Role = role;
            state.Info.ParentId = parent.Info.Id;
            state.Info.StageIndex = parent.Vessel != null ? parent.Vessel.currentStage : -1;
            state.Info.SeparatedUt = ut;
            state.Info.ModelRole = docked
                ? "space.rocket"
                : payload
                    ? null
                    : fairing
                        ? "space.fairing"
                        : "space.stage";
            Log.Info("Stage separated: id=" + state.Info.Id + " role=" + role +
                     " parent=" + parent.Info.Id + " parts=" + partCount +
                     " mass=" + massKg.ToString("F1") + " kg");
        }

        /// <summary>
        /// Picks the vessel a newly separated object came from. Primary vessels
        /// (no stage role) win over already separated stages, so a booster's
        /// own debris is not chained to the booster.
        /// </summary>
        private VesselTrackState FindSeparationParent(
            VesselTrackState exclude,
            Vessel vessel,
            double ut)
        {
            VesselTrackState best = null;
            double bestDistance = 500.0;
            for (int i = 0; i < _trackList.Count; i++)
            {
                VesselTrackState candidate = _trackList[i];
                if (candidate == exclude || candidate.Vessel == null || candidate.Info == null ||
                    candidate.Info.Role != null ||
                    (exclude.Info != null && candidate.Info.ParentId == exclude.Info.Id))
                {
                    // Never make a vessel the parent of its own parent; that
                    // produces a circular parentId when focus switches at a
                    // payload separation.
                    continue;
                }
                double distance;
                try
                {
                    distance = UnloadedPositionSampler.DistanceMeters(candidate.Vessel, vessel, ut);
                }
                catch (Exception)
                {
                    continue;
                }
                if (distance <= bestDistance)
                {
                    bestDistance = distance;
                    best = candidate;
                }
            }
            return best ?? FindNearestTrackedState(exclude, vessel, ut, 500.0);
        }

        private int CountSeparatedStages(string parentId, double ut)
        {
            if (string.IsNullOrEmpty(parentId))
            {
                return 0;
            }
            int count = 0;
            for (int i = 0; i < _trackList.Count; i++)
            {
                VesselInfo info = _trackList[i].Info;
                if (info == null || info.ParentId != parentId || info.Role == null ||
                    !info.Role.StartsWith("stage.", StringComparison.Ordinal) ||
                    !info.SeparatedUt.HasValue)
                {
                    continue;
                }
                // Pieces from one staging action (S1 interstage + tank, fairing
                // halves) share the same role instead of advancing the ordinal.
                if (!SeparationHierarchy.IsSameSeparationEvent(ut, info.SeparatedUt.Value))
                {
                    count++;
                }
            }
            return count;
        }

        private static bool IsRecordableSeparation(Vessel vessel)
        {
            int partCount = vessel.parts != null ? vessel.parts.Count : 0;
            if (partCount == 0)
            {
                return false;
            }
            if (IsLaunchClampVessel(vessel))
            {
                return false;
            }
            double massKg = 0.0;
            try
            {
                massKg = vessel.GetTotalMass() * 1000.0;
            }
            catch (Exception)
            {
                // Fall through with zero mass; part count and flags still apply.
            }
            return LargePartPolicy.IsSeparatedPartLarge(
                massKg,
                partCount,
                HasFuelTank(vessel),
                HasModuleTypeContaining(vessel, "ModuleEngines"),
                IsFairingVessel(vessel),
                HasCommandModule(vessel));
        }

        private static bool HasCommandModule(Vessel vessel)
        {
            return FindModuleByName(vessel, "ModuleCommand") != null;
        }

        private static double MassKg(Vessel vessel)
        {
            if (vessel == null)
            {
                return 0.0;
            }
            try
            {
                return vessel.GetTotalMass() * 1000.0;
            }
            catch (Exception)
            {
                return 0.0;
            }
        }

        /// <summary>
        /// A launch clamp is released as a one-part vessel that can report a
        /// huge mass; it must never take the booster role.
        /// </summary>
        private static bool IsLaunchClampVessel(Vessel vessel)
        {
            if (HasModuleTypeContaining(vessel, "LaunchClamp"))
            {
                return true;
            }
            if (vessel == null || vessel.parts == null)
            {
                return false;
            }
            for (int i = 0; i < vessel.parts.Count; i++)
            {
                Part part = vessel.parts[i];
                if (part == null)
                {
                    continue;
                }
                string name = part.partName ?? (part.partInfo != null ? part.partInfo.name : null);
                if (name != null &&
                    name.IndexOf("launchclamp", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>True when both sides carry a docking node, i.e. an undock.</summary>
        private static bool IsDockedSeparation(Vessel vessel, VesselTrackState parent)
        {
            if (parent == null || parent.Vessel == null)
            {
                return false;
            }
            return HasModuleTypeContaining(vessel, "DockingNode") &&
                   HasModuleTypeContaining(parent.Vessel, "DockingNode");
        }

        private static bool IsFairingVessel(Vessel vessel)
        {
            if (HasModuleTypeContaining(vessel, "Fairing"))
            {
                return true;
            }
            if (vessel == null || vessel.parts == null)
            {
                return false;
            }
            for (int i = 0; i < vessel.parts.Count; i++)
            {
                Part part = vessel.parts[i];
                if (part == null)
                {
                    continue;
                }
                string name = part.partName ?? (part.partInfo != null ? part.partInfo.name : null);
                if (name != null &&
                    name.IndexOf("fairing", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }
            return false;
        }

        private VesselTrackState FindNearestTrackedState(
            VesselTrackState exclude,
            Vessel vessel,
            double ut,
            double maxDistance)
        {
            VesselTrackState best = null;
            double bestDistance = maxDistance;
            for (int i = 0; i < _trackList.Count; i++)
            {
                VesselTrackState candidate = _trackList[i];
                if (candidate == exclude || candidate.Vessel == null)
                {
                    continue;
                }
                double distance;
                try
                {
                    distance = UnloadedPositionSampler.DistanceMeters(candidate.Vessel, vessel, ut);
                }
                catch (Exception)
                {
                    continue;
                }
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    best = candidate;
                }
            }
            return best;
        }

        private static bool IsExternalTank(Vessel vessel)
        {
            if (vessel == null)
            {
                return false;
            }
            if (!string.IsNullOrEmpty(vessel.vesselName) &&
                vessel.vesselName.IndexOf("external tank", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return true;
            }
            if (vessel.parts == null)
            {
                return false;
            }
            for (int i = 0; i < vessel.parts.Count; i++)
            {
                Part part = vessel.parts[i];
                if (part == null)
                {
                    continue;
                }
                string name = part.partName ?? (part.partInfo != null ? part.partInfo.name : null);
                if (name != null && name.IndexOf("ExternalTank", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }
            return false;
        }

        private static bool HasFuelTank(Vessel vessel)
        {
            if (vessel == null || vessel.parts == null)
            {
                return false;
            }
            for (int p = 0; p < vessel.parts.Count; p++)
            {
                Part part = vessel.parts[p];
                if (part == null || part.Resources == null)
                {
                    continue;
                }
                for (int r = 0; r < part.Resources.Count; r++)
                {
                    string resource = part.Resources[r] != null ? part.Resources[r].resourceName : null;
                    if (resource == "LiquidFuel" || resource == "Oxidizer" || resource == "SolidFuel")
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private static object FindModuleByName(Vessel vessel, params string[] names)        {
            if (vessel == null)
            {
                return null;
            }

            object partsValue = BdaReflectionCache.Get(vessel, "parts", "Parts");
            IEnumerable parts = partsValue as IEnumerable;
            if (parts == null)
            {
                return null;
            }

            foreach (object part in parts)
            {
                if (part == null)
                {
                    continue;
                }

                object modulesValue = BdaReflectionCache.Get(part, "Modules", "modules");
                IEnumerable modules = modulesValue as IEnumerable;
                if (modules == null)
                {
                    continue;
                }

                foreach (object module in modules)
                {
                    if (module == null)
                    {
                        continue;
                    }

                    string typeName = module.GetType().Name;
                    for (int i = 0; i < names.Length; i++)
                    {
                        if (string.Equals(typeName, names[i], StringComparison.Ordinal))
                        {
                            return module;
                        }
                    }
                }
            }

            return null;
        }

        private static string TargetIdOf(object value)
        {
            if (value == null)
            {
                return null;
            }

            string direct = IdOf(value);
            if (direct != null)
            {
                return direct;
            }

            return IdOf(BdaReflectionCache.Get(value, "Vessel", "vessel"));
        }

        private static string IdOf(object value)
        {
            if (value == null)
            {
                return null;
            }

            string text = value as string;
            if (text != null)
            {
                return text;
            }

            object id = BdaReflectionCache.Get(value, "id", "Id");
            if (id == null)
            {
                return null;
            }

            Guid guid;
            if (id is Guid)
            {
                guid = (Guid)id;
                return guid.ToString();
            }

            return id.ToString();
        }

        private static string NameOf(object value)
        {
            if (value == null)
            {
                return null;
            }

            string text = value as string;
            if (text != null)
            {
                return text;
            }

            return BdaReflectionCache.Get(
                value, "name", "Name", "shortName", "DisplayName", "weaponName") as string;
        }

        private double BodyRadius(string body)
        {
            if (_bodies != null && body != null)
            {
                BodyDef def;
                if (_bodies.TryGetValue(body, out def) && def != null && def.Radius > 0)
                {
                    return def.Radius;
                }
            }
            return 600000.0;
        }

        private void ApplyPhaseEvents(VesselSample sample, double ut)
        {
            // An unavailable observation cannot establish a landing speed.
            if (!sample.SurfaceSpeed.HasValue || !sample.VerticalSpeed.HasValue) return;
            _phaseEvents.Clear();
            bool beganFlight = false;
            _phases.Observe(
                sample.Situation,
                ut,
                sample.SurfaceSpeed.Value,
                sample.VerticalSpeed.Value,
                _settings.AutoStopOnLanding,
                _phaseEvents);

            for (int i = 0; i < _phaseEvents.Count; i++)
            {
                FlightPhaseEvent phase = _phaseEvents[i];
                if (phase.Type == FlightPhaseDetector.AutoStopEvent)
                {
                    Stop("auto_landing", ut);
                    return;
                }

                KerbTacEvent evt = _events.Add(phase.Type, phase.Ut, Vessel);
                if (phase.Type == EventTypes.Takeoff)
                {
                    evt.WithData("speed", JsonValue.Num(phase.Speed));
                    beganFlight = true;
                }
                else if (phase.Type == EventTypes.Touchdown)
                {
                    evt.WithData("verticalSpeed", JsonValue.Num(phase.VerticalSpeed));
                    evt.WithData("speed", JsonValue.Num(phase.Speed));
                }
                else if (phase.Type == EventTypes.Landing)
                {
                    evt.WithData("speed", JsonValue.Num(phase.Speed));
                }
            }

            if (beganFlight && _activeTrack != null)
            {
                BeginLogicalFlight(_activeTrack);
            }
        }

        /// <summary>
        /// Closes the current storage chunk and starts a new logical flight, so
        /// a landing/takeoff cycle is not presented as one continuous sortie.
        /// </summary>
        private void BeginLogicalFlight(VesselTrackState state)
        {
            if (state.Buffer.Count > 0)
            {
                List<VesselSample> samples = state.Buffer.TakeOldest(state.Buffer.Count);
                TrackSegment segment = new TrackSegment
                {
                    Index = _nextSegmentIndex++,
                    LogicalIndex = state.Tail.LogicalIndex,
                    ChunkIndex = state.Tail.ChunkIndex,
                    Kind = SegmentKinds.Flight,
                    Body = state.Info.Body,
                    Source = state.Tail.Source,
                    IncludeResources = state.IncludeResources,
                    PositionOnly = state.Tail.PositionOnly,
                    Samples = samples
                };
                WriteSegmentToDisk(state, segment);
            }
            SegmentChunker.BeginNewFlight(state.Tail);
        }

        private void PollPartState(VesselSample sample)
        {
            List<PartStateChange> gearChanges = new List<PartStateChange>();
            List<PartStateChange> engineChanges = new List<PartStateChange>();
            _watchers.Poll(Vessel, gearChanges, engineChanges);

            for (int i = 0; i < gearChanges.Count; i++)
            {
                PartStateChange change = gearChanges[i];
                KerbTacEvent evt = _events.Add(
                    change.State ? EventTypes.GearDown : EventTypes.GearUp, sample.T, Vessel);
                evt.WithData("part", JsonValue.Str(change.PartName));
                if (!string.IsNullOrEmpty(change.PartId))
                {
                    evt.WithData("partId", JsonValue.Str(change.PartId));
                }
            }

            for (int i = 0; i < engineChanges.Count; i++)
            {
                PartStateChange change = engineChanges[i];
                KerbTacEvent evt = _events.Add(
                    change.State ? EventTypes.EngineIgnition : EventTypes.EngineShutdown, sample.T, Vessel);
                evt.WithData("part", JsonValue.Str(change.PartName));
                if (!string.IsNullOrEmpty(change.PartId))
                {
                    evt.WithData("partId", JsonValue.Str(change.PartId));
                }
                if (change.EngineIndex >= 0)
                {
                    evt.WithData("engineIndex", JsonValue.Num(change.EngineIndex));
                }
                if (sample.Throttle.HasValue)
                {
                    evt.WithData("throttle", JsonValue.Num(sample.Throttle.Value));
                }
            }
        }

        public void RecordStage(int stage)
        {
            if (State != RecorderState.Recording)
            {
                return;
            }
            // Stage callbacks may precede onVesselChange (or the next tick).
            Vessel actual = FlightGlobals.ActiveVessel;
            if (!IsRecordableFocus(actual))
            {
                return;
            }
            double ut = Math.Max(LastSampleUt, Planetarium.GetUniversalTime());
            SetActiveVessel(actual, ut);
            if (_activeTrack == null)
            {
                return;
            }
            KerbTacEvent evt = _events.Add(EventTypes.Stage, ut, actual);
            evt.WithData("stage", JsonValue.Num(stage));
        }

        public void RecordNote(string text, double wallDuration = -1)
        {
            if (State != RecorderState.Recording)
            {
                return;
            }
            KerbTacEvent evt = _events.AddNote(text, LastSampleUt);
            if (wallDuration >= 0)
            {
                evt.WithData("wallDuration", JsonValue.Num(wallDuration));
            }
        }

        public void RecordSoiChange(Vessel host, string from, string to)
        {
            if (State != RecorderState.Recording || host != FlightGlobals.ActiveVessel ||
                !IsRecordableFocus(host))
            {
                return;
            }
            double ut = Math.Max(LastSampleUt, Planetarium.GetUniversalTime());
            SetActiveVessel(host, ut);
            KerbTacEvent evt = _events.Add(EventTypes.SoiChange, ut, host);
            evt.WithData("from", JsonValue.Str(from));
            evt.WithData("to", JsonValue.Str(to));
        }

        public bool IsTracking(Vessel vessel)
        {
            return vessel != null && _tracks.ContainsKey(vessel.id);
        }

        public void RecordImpact(EventReport report)
        {
            if (State != RecorderState.Recording || report == null || report.origin == null)
            {
                return;
            }
            Vessel vessel = report.origin.vessel;
            if (vessel == null || !IsTracking(vessel))
            {
                return;
            }
            string partId = "";
            try
            {
                partId = report.origin.flightID.ToString();
            }
            catch
            {
                // A part being destroyed may not expose an id any more.
            }
            _events.RecordImpact(vessel, vessel.srfSpeed, partId);
        }

        private static bool IsDebrisVesselName(Vessel vessel)
        {
            if (vessel == null) return false;
            if (LooksLikeDetachedCore(vessel)) return true;
            string name = vessel.vesselName ?? string.Empty;
            string type = vessel.vesselType.ToString();
            return name.IndexOf("debris", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   type.IndexOf("debris", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static bool UsesShipModelWhenSplashed(VesselType type)
        {
            return type == VesselType.Base ||
                   type == VesselType.Ship ||
                   type == VesselType.Probe ||
                   type == VesselType.Relay ||
                   type == VesselType.Station;
        }

        /// <summary>
        /// A probe/relay core that survives a destroyed carrier gets a name like
        /// "Plane_1" or "Plane Probe" from KSP. It is detached wreckage, not a
        /// new satellite or ship.
        /// </summary>
        private static bool LooksLikeDetachedCore(Vessel vessel)
        {
            if (vessel == null)
            {
                return false;
            }

            string type = vessel.vesselType.ToString();
            bool coreType = type == "Probe" || type == "Relay" ||
                            type == "Station" || type == "Base";
            string name = vessel.vesselName ?? string.Empty;
            string baseName = StripCoreSuffix(name);
            bool namedCore = !string.Equals(baseName, name, StringComparison.Ordinal);
            bool suffixCore = (type == "Probe" || type == "Relay" || type == "Station") &&
                              HasNumericSuffix(name);
            if (!coreType && !namedCore && !suffixCore)
            {
                return false;
            }

            // A carrier is large; a detached core or a surviving wreck chunk is
            // tiny. This keeps a full aircraft/boat with a _1 suffix from being
            // mistaken for a core.
            if (vessel.loaded && vessel.parts != null && vessel.parts.Count > 12)
            {
                return false;
            }

            for (int i = 0; i < FlightGlobals.Vessels.Count; i++)
            {
                Vessel other = FlightGlobals.Vessels[i];
                if (other == null || other.id == vessel.id)
                {
                    continue;
                }
                string otherType = other.vesselType.ToString();
                if (otherType != "Plane" && otherType != "Rover" &&
                    otherType != "Base" && otherType != "Ship")
                {
                    continue;
                }
                string otherName = other.vesselName ?? string.Empty;
                if (string.Equals(otherName, name, StringComparison.Ordinal) ||
                    string.Equals(otherName, baseName, StringComparison.Ordinal) ||
                    baseName.StartsWith(otherName + "_", StringComparison.Ordinal) ||
                    otherName.StartsWith(baseName + "_", StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return suffixCore;
        }

        private static bool HasNumericSuffix(string name)
        {
            int underscore = name.LastIndexOf('_');
            if (underscore < 0 || underscore == name.Length - 1)
            {
                return false;
            }
            for (int i = underscore + 1; i < name.Length; i++)
            {
                if (!char.IsDigit(name[i]))
                {
                    return false;
                }
            }
            return true;
        }

        private static string StripCoreSuffix(string name)
        {
            string[] suffixes = { " probe", " core", " computer" };
            for (int i = 0; i < suffixes.Length; i++)
            {
                if (name.EndsWith(suffixes[i], StringComparison.OrdinalIgnoreCase))
                {
                    return name.Substring(0, name.Length - suffixes[i].Length);
                }
            }
            return name;
        }

        public void RecordDestroyed(Vessel vessel, string reason)
        {
            if (State != RecorderState.Recording || vessel == null)
            {
                return;
            }
            if (_actorIds.Contains(vessel.id))
            {
                // Missile/bomb ends are reported through ActorTracker with
                // impact/miss/explosion semantics.
                return;
            }
            // The destroy callback can precede the focus notification. If KSP
            // already cleared its active pointer, use the last observed focus
            // only for attribution, including during the grace window.
            Vessel actual = FlightGlobals.ActiveVessel;
            double now = Planetarium.GetUniversalTime();
            bool active = actual != null ? vessel == actual :
                vessel == _focusedVessel || (_lostFocusVesselId == vessel.id &&
                    now - _activeLostUt <= FocusLossGraceSeconds);
            VesselTrackState destroyedTrack;
            if (!_tracks.TryGetValue(vessel.id, out destroyedTrack) &&
                !(active && IsRecordableFocus(vessel)))
            {
                return;
            }
            if (!_destroyedVesselIds.Add(vessel.id))
            {
                return;
            }
            bool debris = IsDebrisVesselName(vessel);
            CombatAttacker attacker;
            ImpactAttributionRecord impact = null;
            if (!debris)
            {
                // Process explicit-target actor ends before looking for a kill.
                FlushActorEnds(now);
                impact = FindImpactAttribution(vessel, now);
            }
            if (!debris && _attribution.TryFind(vessel.id.ToString(), now, out attacker))
            {
                KerbTacEvent kill = _events.RecordKill(vessel, attacker.AttackerId, attacker.Weapon, attacker.ActorId);
                kill.WithData("reason", JsonValue.Str(reason));
                kill.WithData("evidence", JsonValue.Str("target"));
            }
            else if (impact != null)
            {
                KerbTacEvent kill = _events.RecordKill(vessel, impact.SourceId, impact.Weapon, impact.ActorId);
                kill.WithData("reason", JsonValue.Str(reason));
                kill.WithData("evidence", JsonValue.Str("impact_within_200m"));
            }
            else if (!debris && HasRecentHealthDamage(vessel.id.ToString(), now))
            {
                KerbTacEvent kill = _events.RecordKill(vessel, null, null, null);
                kill.WithData("reason", JsonValue.Str(reason));
                kill.WithData("evidence", JsonValue.Str("health_drop"));
            }
            else
            {
                _events.RecordDestroyed(vessel, active, reason);
            }

            if (destroyedTrack != null)
            {
                // Preserve existing samples and pending event metadata but
                // never sample the destroyed track again.
                destroyedTrack.Retired = true;
                if (_activeTrack == destroyedTrack)
                {
                    FlushOrbitSpan();
                    _activeTrack = null;
                }
            }
            if (_focusedVessel == vessel) _focusedVessel = null;
            if (Vessel == vessel) Vessel = null;
            if (active)
            {
                // B can die before its focus callback, while A is still the
                // cached active track. Neither may remain the active sampler.
                BeginFocusLoss(now);
                _lostFocusVesselId = null;
                Log.Info("Focused vessel destroyed; waiting for another vessel");
            }
        }

        private void Fail(string message, Exception ex)
        {
            if (_tempDir != null)
            {
                message += "\nRecoverable chunks (if written): " + _tempDir;
            }
            LastError = message;
            State = RecorderState.Error;
            if (ex != null)
            {
                Log.Exception(message, ex);
            }
            else
            {
                Log.Error(message);
            }
        }

        private void CleanupTemp()
        {
            if (_tempDir != null)
            {
                TryDeleteDirectory(_tempDir);
            }
        }

        private static void TryDeleteDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                }
            }
            catch (Exception ex)
            {
                Log.Warn("Could not delete temp directory " + path + ": " + ex.Message);
            }
        }
    }
}
