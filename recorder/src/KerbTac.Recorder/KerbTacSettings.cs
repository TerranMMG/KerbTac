using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using KerbTac.Core;
using KerbTac.Core.Sampling;
using UnityEngine;

namespace KerbTac.Recorder
{
    /// <summary>
    /// Persistent settings stored in GameData/KerbTac/PluginData/settings.cfg.
    /// Loading never throws: bad values fall back to defaults.
    /// </summary>
    internal sealed class KerbTacSettings
    {
        public int SampleRateHz = 10;
        public int RingBufferSeconds = 120;
        public int UnloadedRangeKm = 0;
        public bool AutoStart = true;
        public bool AutoStopOnLanding = false;
        public bool ShowRecIndicator = true;
        public bool RecordCombatDetail = true;
        public bool RecordGunfire = true;
        public bool DebugLogging;

        /// <summary>"auto", "combat", or "space" (format v1.3 recording mode).</summary>
        public string RecordingMode = RecordingModeResolver.Auto;
        public KeyCode HotkeyToggle = KeyCode.None;
        public KeyCode HotkeySave = KeyCode.None;

        public string ModDirectory { get; private set; }

        public string SettingsPath
        {
            get { return Path.Combine(ModDirectory, "PluginData", "settings.cfg"); }
        }

        public string RecordingsDirectory
        {
            get
            {
                string save = HighLogic.SaveFolder;
                if (string.IsNullOrEmpty(save))
                {
                    save = "shared";
                }
                return Path.Combine(ModDirectory, "Recordings", FileNameUtil.Sanitize(save, 24));
            }
        }

        public int RingCapacity
        {
            get { return Math.Max(50, SampleRateHz * RingBufferSeconds); }
        }

        public float SampleInterval
        {
            get { return 1.0f / Math.Max(1, SampleRateHz); }
        }

        public static KerbTacSettings Load(string modDirectory)
        {
            KerbTacSettings settings = new KerbTacSettings();
            settings.ModDirectory = modDirectory;

            try
            {
                if (!File.Exists(settings.SettingsPath))
                {
                    return settings;
                }

                ConfigNode root = ConfigNode.Load(settings.SettingsPath);
                // KSP's ConfigNode.Save can leave a flat root (no named
                // KERBTAC_SETTINGS child); accept that layout as well so a
                // slider value survives a scene reload.
                ConfigNode node = root != null
                    ? (root.GetNode("KERBTAC_SETTINGS") ?? root)
                    : null;
                if (node == null)
                {
                    return settings;
                }

                settings.SampleRateHz = ReadInt(node, "sampleRateHz", settings.SampleRateHz, 1, 60);
                settings.RingBufferSeconds = ReadInt(node, "ringBufferSeconds", settings.RingBufferSeconds, 10, 3600);
                settings.UnloadedRangeKm = UnloadedRange.Snap(
                    ReadInt(node, "unloadedRangeKm", settings.UnloadedRangeKm, 0, UnloadedRange.MaxKm));
                settings.AutoStart = ReadBool(node, "autoStart", settings.AutoStart);
                settings.AutoStopOnLanding = ReadBool(node, "autoStopOnLanding", settings.AutoStopOnLanding);
                settings.ShowRecIndicator = ReadBool(node, "showRecIndicator", settings.ShowRecIndicator);
                settings.RecordCombatDetail = ReadBool(node, "recordCombatDetail", settings.RecordCombatDetail);
                settings.RecordGunfire = ReadBool(node, "recordGunfire", settings.RecordGunfire);
                settings.DebugLogging = ReadBool(node, "debugLogging", false);
                settings.RecordingMode = RecordingModeResolver.Normalize(
                    node.GetValue("recordingMode") ?? settings.RecordingMode);
                settings.HotkeyToggle = ReadKey(node, "hotkeyToggle", settings.HotkeyToggle);
                settings.HotkeySave = ReadKey(node, "hotkeySave", settings.HotkeySave);
            }
            catch (Exception ex)
            {
                Log.Exception("Failed to load settings, using defaults", ex);
            }

            return settings;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath));

                ConfigNode root = new ConfigNode("KERBTAC_SETTINGS");
                root.AddValue("sampleRateHz", SampleRateHz.ToString(CultureInfo.InvariantCulture));
                root.AddValue("ringBufferSeconds", RingBufferSeconds.ToString(CultureInfo.InvariantCulture));
                root.AddValue("unloadedRangeKm", UnloadedRangeKm.ToString(CultureInfo.InvariantCulture));
                root.AddValue("autoStart", AutoStart ? "True" : "False");
                root.AddValue("autoStopOnLanding", AutoStopOnLanding ? "True" : "False");
                root.AddValue("showRecIndicator", ShowRecIndicator ? "True" : "False");
                root.AddValue("recordCombatDetail", RecordCombatDetail ? "True" : "False");
                root.AddValue("recordGunfire", RecordGunfire ? "True" : "False");
                root.AddValue("debugLogging", DebugLogging ? "True" : "False");
                root.AddValue("recordingMode", RecordingMode);
                root.AddValue("hotkeyToggle", HotkeyToggle.ToString());
                root.AddValue("hotkeySave", HotkeySave.ToString());
                root.Save(SettingsPath);
            }
            catch (Exception ex)
            {
                Log.Exception("Failed to save settings", ex);
            }
        }

        /// <summary>Directory containing the plugin DLL (GameData/KerbTac/Plugins).</summary>
        public static string DetectModDirectory()
        {
            try
            {
                string dll = Assembly.GetExecutingAssembly().Location;
                string plugins = Path.GetDirectoryName(dll);
                return Path.GetFullPath(Path.Combine(plugins, ".."));
            }
            catch (Exception ex)
            {
                Log.Exception("Could not locate plugin directory", ex);
                return "GameData/KerbTac";
            }
        }

        private static int ReadInt(ConfigNode node, string key, int fallback, int min, int max)
        {
            string raw = node.GetValue(key);
            int value;
            if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                return fallback;
            }
            return Math.Min(max, Math.Max(min, value));
        }

        private static bool ReadBool(ConfigNode node, string key, bool fallback)
        {
            string raw = node.GetValue(key);
            if (string.IsNullOrEmpty(raw))
            {
                return fallback;
            }
            return raw == "True" || raw == "true" || raw == "1";
        }

        private static KeyCode ReadKey(ConfigNode node, string key, KeyCode fallback)
        {
            string raw = node.GetValue(key);
            if (string.IsNullOrEmpty(raw))
            {
                return fallback;
            }
            try
            {
                return (KeyCode)Enum.Parse(typeof(KeyCode), raw, true);
            }
            catch
            {
                return fallback;
            }
        }
    }
}
