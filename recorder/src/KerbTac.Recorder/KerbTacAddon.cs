using System;
using System.IO;
using KSP;
using KerbTac.Core;
using UnityEngine;

namespace KerbTac.Recorder
{
    /// <summary>
    /// Flight-scene entry point. Owns the session, wires game events, handles
    /// hotkeys and feeds the sampler. Never lets an exception escape into KSP.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, false)]
    public class KerbTacAddon : MonoBehaviour
    {
        internal static KerbTacAddon Instance;

        internal KerbTacSettings Settings;
        internal RecordingSession Session;

        private KerbTacUI _ui;
        private bool _paused;
        private DateTime? _pauseWallStart;
        private bool _bound;
        private float _nextArmCheck;
        private bool _autoStartUsed;

        internal void Awake()
        {
            try
            {
                Instance = this;
                Settings = KerbTacSettings.Load(KerbTacSettings.DetectModDirectory());
                Log.Info("settings: unloadedRangeKm=" + Settings.UnloadedRangeKm +
                         ", sampleRateHz=" + Settings.SampleRateHz +
                         ", debugLogging=" + Settings.DebugLogging);
                Session = new RecordingSession(Settings);
                _ui = new KerbTacUI();
                BindEvents();
                Log.Info("loaded v" + PluginInfo.Version +
                         " (KSP " + PluginInfo.KspVersion() + ", Unity " + PluginInfo.UnityVersion() + ")");
#if KERBTAC_STUB_REFS
                Log.Warn("This build used stub reference assemblies. Rebuild against KSP before flying.");
#endif
            }
            catch (Exception ex)
            {
                Log.Exception("Awake failed", ex);
            }
        }

        internal void Start()
        {
            try
            {
                if (_ui != null)
                {
                    _ui.TryCreateToolbar();
                }
                EvaluateArming();
            }
            catch (Exception ex)
            {
                Log.Exception("Start failed", ex);
            }
        }

        internal void Update()
        {
            try
            {
                if (_ui != null)
                {
                    _ui.TryCreateToolbar();
                }

                HandleHotkeys();

                if (Session != null)
                {
                    Session.TickFinalize();
                }

                if (_paused || Settings == null || Session == null)
                {
                    return;
                }

                Vessel vessel = FlightGlobals.ActiveVessel;

                if (Session.State == RecorderState.Armed && !_autoStartUsed && Session.ShouldAutoStart(vessel))
                {
                    Session.Start(vessel, "auto", Planetarium.GetUniversalTime(), DateTime.UtcNow);
                    if (Session.State == RecorderState.Recording)
                    {
                        _autoStartUsed = true;
                    }
                }

                if (Time.realtimeSinceStartup >= _nextArmCheck)
                {
                    _nextArmCheck = Time.realtimeSinceStartup + 1.0f;
                    if (Session.State == RecorderState.Idle)
                    {
                        EvaluateArming();
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Exception("Update failed", ex);
            }
        }

        internal void FixedUpdate()
        {
            if (_paused || Session == null)
            {
                return;
            }

            try
            {
                Session.FixedTick(FlightGlobals.ActiveVessel, Time.fixedDeltaTime, Planetarium.GetUniversalTime());
            }
            catch (Exception ex)
            {
                Log.Exception("FixedUpdate failed", ex);
            }
        }

        internal void OnGUI()
        {
            if (_ui != null)
            {
                _ui.Draw(this);
            }
        }

        internal void OnDestroy()
        {
            try
            {
                UnbindEvents();
                if (Session != null)
                {
                    Session.Shutdown();
                }
                if (_ui != null)
                {
                    _ui.RemoveToolbar();
                }
            }
            catch (Exception ex)
            {
                Log.Exception("OnDestroy failed", ex);
            }
            finally
            {
                Session = null;
                Instance = null;
            }
        }

        // -------------------------------------------------------------- commands

        internal void ManualStart()
        {
            Vessel vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || Session == null)
            {
                return;
            }
            if (Session.State == RecorderState.Error)
            {
                Session.ClearError();
            }
            Session.Start(vessel, "manual", Planetarium.GetUniversalTime(), DateTime.UtcNow);
            if (Session.State == RecorderState.Recording)
            {
                _autoStartUsed = true;
            }
        }

        internal void ManualStop()
        {
            if (Session != null)
            {
                Session.Stop("manual", Planetarium.GetUniversalTime());
            }
        }

        internal void RunSelfTest()
        {
            try
            {
                if (Settings == null || Session == null || _ui == null)
                {
                    return;
                }
                string path = SelfTestRecording.Write(
                    Session.RecordingsDirectory,
                    DateTime.UtcNow,
                    PluginInfo.KspVersion());
                _ui.SelfTestStatus = "Self-test OK: " + Path.GetFileName(path);
                Log.Info("Self-test archive written: " + path);
            }
            catch (Exception ex)
            {
                if (_ui != null)
                {
                    _ui.SelfTestStatus = "Self-test failed: " + ex.Message;
                }
                Log.Exception("Self-test failed", ex);
            }
        }

        internal void SaveNow()
        {
            if (Session != null)
            {
                Session.Stop("manual", Planetarium.GetUniversalTime());
            }
        }

        private void HandleHotkeys()
        {
            if (Settings == null || Session == null)
            {
                return;
            }

            if (Settings.HotkeyToggle != KeyCode.None && Input.GetKeyDown(Settings.HotkeyToggle))
            {
                if (Session.State == RecorderState.Recording)
                {
                    ManualStop();
                }
                else if (Session.State != RecorderState.Finalizing)
                {
                    ManualStart();
                }
            }

            if (Settings.HotkeySave != KeyCode.None &&
                Input.GetKeyDown(Settings.HotkeySave) &&
                Session.State == RecorderState.Recording)
            {
                SaveNow();
            }
        }

        private void EvaluateArming()
        {
            if (Session == null || Settings == null)
            {
                return;
            }

            if (_autoStartUsed)
            {
                if (Session.State == RecorderState.Armed)
                {
                    Session.Disarm();
                }
                return;
            }

            Vessel vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || !Settings.AutoStart)
            {
                Session.Disarm();
                return;
            }

            double ut = Planetarium.GetUniversalTime();
            bool hasLaunchTime = vessel.launchTime > 0.0;
            double age = hasLaunchTime ? ut - vessel.launchTime : double.MaxValue;
            bool fresh = hasLaunchTime && age >= -1.0 && age < 120.0;

            Vessel.Situations situation = vessel.situation;
            bool grounded = situation == Vessel.Situations.PRELAUNCH ||
                            situation == Vessel.Situations.LANDED ||
                            situation == Vessel.Situations.SPLASHED;

            if (fresh && grounded)
            {
                if (Session.State != RecorderState.Armed)
                {
                    Session.Arm(vessel);
                    Log.Info("Armed on " + vessel.vesselName + " (age " + age.ToString("F1") + "s)");
                }
            }
            else
            {
                Session.Disarm();
            }
        }

        // ---------------------------------------------------------- game events

        private void BindEvents()
        {
            if (_bound)
            {
                return;
            }
            _bound = true;

            GameEvents.onFlightReady.Add(OnFlightReady);
            GameEvents.onVesselChange.Add(OnVesselChange);
            GameEvents.onVesselWillDestroy.Add(OnVesselWillDestroy);
            GameEvents.onCrash.Add(OnCrash);
            GameEvents.onStageActivate.Add(OnStageActivate);
            GameEvents.onVesselSOIChanged.Add(OnSoiChanged);
            GameEvents.onGamePause.Add(OnGamePause);
            GameEvents.onGameUnpause.Add(OnGameUnpause);
        }

        private void UnbindEvents()
        {
            if (!_bound)
            {
                return;
            }
            _bound = false;

            GameEvents.onFlightReady.Remove(OnFlightReady);
            GameEvents.onVesselChange.Remove(OnVesselChange);
            GameEvents.onVesselWillDestroy.Remove(OnVesselWillDestroy);
            GameEvents.onCrash.Remove(OnCrash);
            GameEvents.onStageActivate.Remove(OnStageActivate);
            GameEvents.onVesselSOIChanged.Remove(OnSoiChanged);
            GameEvents.onGamePause.Remove(OnGamePause);
            GameEvents.onGameUnpause.Remove(OnGameUnpause);
        }

        private void OnFlightReady()
        {
            try
            {
                EvaluateArming();
            }
            catch (Exception ex)
            {
                Log.Exception("onFlightReady failed", ex);
            }
        }

        private void OnVesselChange(Vessel vessel)
        {
            try
            {
                if (Session != null && Session.State == RecorderState.Recording &&
                    vessel != null)
                {
                    // Always notify: Session.Vessel still names the last valid active
                    // vessel, so comparing identities would skip the switch back from
                    // an excluded EVA/Flag and leave the recorder on 10 s keyframes.
                    Session.SetActiveVessel(vessel, Planetarium.GetUniversalTime());
                }
                else if (Session == null || Session.State != RecorderState.Recording)
                {
                    EvaluateArming();
                }
            }
            catch (Exception ex)
            {
                Log.Exception("onVesselChange failed", ex);
            }
        }

        private void OnVesselWillDestroy(Vessel vessel)
        {
            try
            {
                if (Session != null)
                {
                    Session.RecordDestroyed(vessel, "vessel_destroyed");
                }
            }
            catch (Exception ex)
            {
                Log.Exception("onVesselWillDestroy failed", ex);
            }
        }

        private void OnCrash(EventReport report)
        {
            try
            {
                if (Session != null && report != null && report.origin != null &&
                    Session.IsTracking(report.origin.vessel))
                {
                    Session.RecordImpact(report);
                }
            }
            catch (Exception ex)
            {
                Log.Exception("onCrash failed", ex);
            }
        }

        private void OnStageActivate(int stage)
        {
            try
            {
                if (Session != null)
                {
                    Session.RecordStage(stage);
                }
            }
            catch (Exception ex)
            {
                Log.Exception("onStageActivate failed", ex);
            }
        }

        private void OnSoiChanged(GameEvents.HostedFromToAction<Vessel, CelestialBody> change)
        {
            try
            {
                if (Session != null)
                {
                    Session.RecordSoiChange(
                        change.host,
                        BodyCatalog.BodyName(change.from),
                        BodyCatalog.BodyName(change.to));
                }
            }
            catch (Exception ex)
            {
                Log.Exception("onVesselSOIChanged failed", ex);
            }
        }

        private void OnGamePause()
        {
            _paused = true;
            _pauseWallStart = DateTime.UtcNow;
            if (Session != null) Session.RecordNote("game_paused");
        }

        private void OnGameUnpause()
        {
            _paused = false;
            double wallDuration = _pauseWallStart.HasValue
                ? (DateTime.UtcNow - _pauseWallStart.Value).TotalSeconds
                : -1;
            _pauseWallStart = null;
            if (Session != null)
            {
                // Short pauses are still visible on the timeline; only the
                // wall-clock duration is omitted for them.
                Session.RecordNote("game_resumed", wallDuration >= 0.5 ? wallDuration : -1);
            }
        }
    }
}
