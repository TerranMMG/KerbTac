using System;
using System.Globalization;
using System.IO;
using KSP.UI.Screens;
using KerbTac.Core;
using KerbTac.Core.Sampling;
using UnityEngine;

namespace KerbTac.Recorder
{
    /// <summary>IMGUI window, toolbar button and on-screen REC indicator (English UI).</summary>
    internal sealed class KerbTacUI
    {
        private const int WindowId = 0x4B5443;

        private Rect _windowRect = new Rect(90, 90, 380, 560);
        private bool _visible;
        private ApplicationLauncherButton _button;
        private Texture2D _icon;
        private Texture2D _dot;
        private string[] _recent = new string[0];
        private float _lastRecentRefresh;
        private static bool _autoOpened;

        public string SelfTestStatus = "";
        private string _playerError;

        public bool Visible
        {
            get { return _visible; }
        }

        public void Toggle()
        {
            if (_visible)
            {
                Hide();
            }
            else
            {
                Show();
            }
        }

        public void Show()
        {
            _visible = true;
        }

        public void Hide()
        {
            _visible = false;
            if (_button != null)
            {
                // false = do not call onFalse again; we are already handling the click.
                _button.SetFalse(false);
            }
        }

        private void ToolbarOn()
        {
            _visible = true;
        }

        private void ToolbarOff()
        {
            _visible = false;
        }

        public bool TryCreateToolbar()
        {
            if (_button != null)
            {
                return true;
            }
            if (ApplicationLauncher.Instance == null)
            {
                return false;
            }

            try
            {
                EnsureTextures();
                _button = ApplicationLauncher.Instance.AddModApplication(
                    ToolbarOn,
                    ToolbarOff,
                    null,
                    null,
                    null,
                    null,
                    ApplicationLauncher.AppScenes.FLIGHT,
                    _icon);
                if (!_autoOpened)
                {
                    _autoOpened = true;
                    _visible = true;
                    _button.SetTrue(false);
                }
                return true;
            }
            catch (Exception ex)
            {
                Log.Exception("Could not create toolbar button", ex);
                return false;
            }
        }

        public void RemoveToolbar()
        {
            try
            {
                if (_button != null && ApplicationLauncher.Instance != null)
                {
                    ApplicationLauncher.Instance.RemoveModApplication(_button);
                }
            }
            catch (Exception ex)
            {
                Log.Exception("Could not remove toolbar button", ex);
            }
            _button = null;
        }

        public void Draw(KerbTacAddon addon)
        {
            try
            {
                if (!_visible)
                {
                    return;
                }

                _windowRect = GUILayout.Window(WindowId, _windowRect, id => DrawWindow(id, addon), "KerbTac Recorder");
            }
            catch (Exception ex)
            {
                Log.Exception("UI draw failed", ex);
            }
        }

        private void DrawWindow(int id, KerbTacAddon addon)
        {
            KerbTacSettings settings = addon.Settings;
            RecordingSession session = addon.Session;

            GUILayout.BeginVertical();

            GUILayout.BeginHorizontal();
            GUILayout.Label("Status: " + session.State, GUILayout.ExpandWidth(true));
            if (GUILayout.Button("Close", GUILayout.Width(60)))
            {
                Hide();
            }
            GUILayout.EndHorizontal();

            GUILayout.Label("Vessel: " + session.VesselName);
            GUILayout.Label("Time: " + FormatDuration(session.ElapsedSeconds) +
                            "   Samples: " + session.SampleCount +
                            "   Events: " + session.EventCount);
            GUILayout.Label("Max gap: " + session.MaxSampleGap.ToString("F2") + " s" +
                            "   Capture: " + session.AverageSampleMilliseconds.ToString("F3") + " ms");
            GUILayout.Label("BDA: " + session.BdaStatus);

            bool recording = session.State == RecorderState.Recording;
            bool busy = recording || session.State == RecorderState.Finalizing;

            GUILayout.BeginHorizontal();
            GUI.enabled = !busy;
            if (GUILayout.Button("Start", GUILayout.Width(80)))
            {
                addon.ManualStart();
            }
            GUI.enabled = recording;
            if (GUILayout.Button("Stop", GUILayout.Width(80)))
            {
                addon.ManualStop();
            }
            if (GUILayout.Button("Save Now", GUILayout.Width(90)))
            {
                addon.SaveNow();
            }
            GUI.enabled = true;
            GUILayout.EndHorizontal();

            if (GUILayout.Button("Open replay player", GUILayout.Width(140)))
            {
                _playerError = null;
                try
                {
                    ReplayPlayer.Open(settings.ModDirectory, info =>
                    {
                        using (System.Diagnostics.Process.Start(info)) { }
                    });
                }
                catch (Exception ex)
                {
                    _playerError = ex is FileNotFoundException
                        ? ex.Message : "Could not open the replay player. Check the system browser association.";
                    Log.Exception("Could not open bundled replay player", ex);
                }
            }
            if (_playerError != null)
            {
                GUILayout.Label(_playerError);
            }

            GUILayout.BeginHorizontal();
            GUI.enabled = !busy;
            if (GUILayout.Button("Self-test archive", GUILayout.Width(140)))
            {
                addon.RunSelfTest();
            }
            GUI.enabled = true;
            if (!string.IsNullOrEmpty(SelfTestStatus))
            {
                GUILayout.Label(SelfTestStatus);
            }
            GUILayout.EndHorizontal();

            GUILayout.Space(6);
            GUILayout.Label("Settings");

            GUILayout.BeginHorizontal();
            GUILayout.Label("Rate:", GUILayout.Width(70));
            GUI.enabled = !busy;
            RateButton(settings, 5);
            RateButton(settings, 10);
            RateButton(settings, 20);
            GUI.enabled = true;
            GUILayout.EndHorizontal();

            GUILayout.BeginHorizontal();
            GUILayout.Label("Buffer:", GUILayout.Width(70));
            GUI.enabled = !busy;
            BufferButton(settings, 30);
            BufferButton(settings, 60);
            BufferButton(settings, 120);
            GUI.enabled = true;
            GUILayout.EndHorizontal();

            GUILayout.BeginHorizontal();
            GUILayout.Label("Mode:", GUILayout.Width(70));
            GUI.enabled = !busy;
            ModeButton(settings, RecordingModeResolver.Auto, "Auto");
            ModeButton(settings, RecordingModeResolver.Combat, "Combat");
            ModeButton(settings, RecordingModeResolver.Space, "Space");
            GUI.enabled = true;
            GUILayout.EndHorizontal();

            GUILayout.Label("Recording Range: " + UnloadedRange.Label(settings.UnloadedRangeKm));
            int step = Mathf.RoundToInt(GUILayout.HorizontalSlider(
                UnloadedRange.IndexOf(settings.UnloadedRangeKm),
                0f,
                UnloadedRange.OptionsKm.Count - 1));
            int index = Math.Max(0, Math.Min(UnloadedRange.OptionsKm.Count - 1, step));
            int nextKm = UnloadedRange.OptionsKm[index];
            if (nextKm != settings.UnloadedRangeKm)
            {
                settings.UnloadedRangeKm = nextKm;
                settings.Save();
                Log.Info("Unloaded range set to " + nextKm + " km");
            }

            bool autoStart = GUILayout.Toggle(settings.AutoStart, " Auto start on takeoff roll");
            if (autoStart != settings.AutoStart)
            {
                settings.AutoStart = autoStart;
                settings.Save();
            }

            bool autoStop = GUILayout.Toggle(settings.AutoStopOnLanding, " Auto stop after landing");
            if (autoStop != settings.AutoStopOnLanding)
            {
                settings.AutoStopOnLanding = autoStop;
                settings.Save();
            }

            bool combatDetail = GUILayout.Toggle(settings.RecordCombatDetail, " Record countermeasures (chaff/flare)");
            if (combatDetail != settings.RecordCombatDetail)
            {
                settings.RecordCombatDetail = combatDetail;
                settings.Save();
            }

            bool gunfire = GUILayout.Toggle(settings.RecordGunfire, " Record gunfire bursts");
            if (gunfire != settings.RecordGunfire)
            {
                settings.RecordGunfire = gunfire;
                settings.Save();
            }
            bool debugLogging = GUILayout.Toggle(settings.DebugLogging, " Debug logging");
            if (debugLogging != settings.DebugLogging)
            {
                settings.DebugLogging = debugLogging;
                settings.Save();
            }

            GUILayout.Space(6);
            GUILayout.Label("Recent recordings");
            RefreshRecent(session.RecordingsDirectory);
            if (_recent.Length == 0)
            {
                GUILayout.Label("  (none yet)");
            }
            else
            {
                for (int i = 0; i < _recent.Length; i++)
                {
                    GUILayout.Label("  " + _recent[i]);
                }
            }

            if (!string.IsNullOrEmpty(session.LastFilePath))
            {
                GUILayout.Space(4);
                GUILayout.Label("Saved: " + session.LastFilePath);
            }

            if (!string.IsNullOrEmpty(session.LastError))
            {
                GUILayout.Space(4);
                GUILayout.Label("Error: " + session.LastError);
                if (GUILayout.Button("Clear error", GUILayout.Width(110)))
                {
                    session.ClearError();
                }
            }

            GUILayout.EndVertical();
            GUI.DragWindow(new Rect(0, 0, 10000, 20));
        }

        private static void RateButton(KerbTacSettings settings, int rate)
        {
            string label = settings.SampleRateHz == rate ? "[" + rate + "]" : rate.ToString();
            if (GUILayout.Button(label + " Hz", GUILayout.Width(64)))
            {
                settings.SampleRateHz = rate;
                settings.Save();
            }
        }

        private static void BufferButton(KerbTacSettings settings, int seconds)
        {
            string label = settings.RingBufferSeconds == seconds ? "[" + seconds + "]" : seconds.ToString();
            if (GUILayout.Button(label + " s", GUILayout.Width(64)))
            {
                settings.RingBufferSeconds = seconds;
                settings.Save();
            }
        }

        private static void ModeButton(KerbTacSettings settings, string mode, string label)
        {
            string text = settings.RecordingMode == mode ? "[" + label + "]" : label;
            if (GUILayout.Button(text, GUILayout.Width(64)))
            {
                settings.RecordingMode = mode;
                settings.Save();
                Log.Info("Recording mode set to " + mode);
            }
        }

        private void RefreshRecent(string directory)
        {
            if (Time.realtimeSinceStartup - _lastRecentRefresh < 2.0f)
            {
                return;
            }
            _lastRecentRefresh = Time.realtimeSinceStartup;

            try
            {
                if (!Directory.Exists(directory))
                {
                    _recent = new string[0];
                    return;
                }

                string[] files = Directory.GetFiles(directory, "*.kerbtac");
                Array.Sort(files, (a, b) => File.GetLastWriteTimeUtc(b).CompareTo(File.GetLastWriteTimeUtc(a)));

                int count = Math.Min(3, files.Length);
                _recent = new string[count];
                for (int i = 0; i < count; i++)
                {
                    FileInfo info = new FileInfo(files[i]);
                    _recent[i] = info.Name + "  (" + (info.Length / 1024) + " KB)";
                }
            }
            catch (Exception ex)
            {
                Log.Exception("Could not list recent recordings", ex);
                _recent = new string[0];
            }
        }

        private void EnsureTextures()
        {
            if (_icon == null)
            {
                _icon = CreateMenuIcon(32);
            }
            if (_dot == null)
            {
                _dot = CreateCircleTexture(16, 255, 68, 68, 255, 8);
            }
        }

        private static Texture2D CreateMenuIcon(int size)
        {
            Texture2D texture = new Texture2D(size, size);
            Color32[] pixels = new Color32[size * size];
            Color32 clear = new Color32(0, 0, 0, 0);
            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i] = clear;
            }

            // Match the player's top-left mark: an orange-to-red diamond.
            float center = (size - 1) * 0.5f;
            float radius = size * 0.36f;
            Color32 orange = new Color32(255, 159, 67, 255);
            Color32 red = new Color32(255, 95, 109, 255);
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float dx = x - center;
                    float dy = y - center;
                    float diamond = Mathf.Abs(dx) + Mathf.Abs(dy);
                    if (diamond <= radius)
                    {
                        float t = Mathf.Clamp01((dx + dy + radius * 2f) / (radius * 4f));
                        pixels[y * size + x] = new Color32(
                            (byte)Mathf.RoundToInt(Mathf.Lerp(orange.r, red.r, t)),
                            (byte)Mathf.RoundToInt(Mathf.Lerp(orange.g, red.g, t)),
                            (byte)Mathf.RoundToInt(Mathf.Lerp(orange.b, red.b, t)),
                            255);
                    }
                    else if (diamond <= radius + 2.5f)
                    {
                        float glow = 1f - (diamond - radius) / 2.5f;
                        pixels[y * size + x] = new Color32(255, 159, 67, (byte)Mathf.RoundToInt(70f * glow));
                    }
                }
            }

            texture.SetPixels32(pixels);
            texture.Apply();
            return texture;
        }

        private static Texture2D CreateCircleTexture(int size, byte r, byte g, byte b, byte a, int radius)
        {
            Texture2D texture = new Texture2D(size, size);
            Color32[] pixels = new Color32[size * size];
            double center = (size - 1) / 2.0;
            double r2 = radius * radius;

            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    double dx = x - center;
                    double dy = y - center;
                    bool inside = dx * dx + dy * dy <= r2;
                    pixels[y * size + x] = inside
                        ? new Color32(r, g, b, a)
                        : new Color32(0, 0, 0, 0);
                }
            }

            texture.SetPixels32(pixels);
            texture.Apply();
            return texture;
        }

        private static string FormatDuration(double seconds)
        {
            if (seconds < 0)
            {
                seconds = 0;
            }
            TimeSpan span = TimeSpan.FromSeconds(seconds);
            return string.Format(
                CultureInfo.InvariantCulture,
                "{0:00}:{1:00}:{2:00}",
                (int)span.TotalHours,
                span.Minutes,
                span.Seconds);
        }
    }
}
