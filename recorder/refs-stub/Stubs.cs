// ---------------------------------------------------------------------------
// COMPILE-ONLY STUB ASSEMBLY.
//
// This project mirrors the small subset of Unity 2019.4 / KSP 1.12.5 API that
// the recorder uses, so the plugin can be compiled and type-checked on macOS
// where the real game assemblies are not available.
//
// It is NEVER shipped and NEVER loaded at runtime. Always rebuild the plugin
// against the real DLLs (dotnet build with KSP_ROOT set) before
// installing it into GameData.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;

namespace UnityEngine
{
    public class Object
    {
        public string name;
        public static void Destroy(Object obj) { }
        public static void DontDestroyOnLoad(Object obj) { }
    }

    public class GameObject : Object
    {
        public Transform transform;
        public GameObject(string name) { this.name = name; }
        public T AddComponent<T>() where T : Component, new() { return new T(); }
    }

    public class Component : Object
    {
        public Transform transform { get; set; }
        public GameObject gameObject { get; set; }
        public T GetComponent<T>() where T : Component { return null; }
    }

    public class Behaviour : Component
    {
        public bool enabled;
    }

    public class MonoBehaviour : Behaviour
    {
    }

    public class Transform : Component
    {
        public Vector3 position;
        public Quaternion rotation;
        public Vector3 localScale;
        public Transform parent;

        public Vector3 forward { get { return rotation * new Vector3(0, 0, 1); } }
        public Vector3 up { get { return rotation * new Vector3(0, 1, 0); } }
        public Vector3 right { get { return rotation * new Vector3(1, 0, 0); } }
    }

    public struct Vector3
    {
        public float x;
        public float y;
        public float z;

        public Vector3(float x, float y, float z)
        {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        public static Vector3 zero { get { return new Vector3(0, 0, 0); } }
        public static Vector3 one { get { return new Vector3(1, 1, 1); } }
        public static Vector3 up { get { return new Vector3(0, 1, 0); } }
        public static Vector3 down { get { return new Vector3(0, -1, 0); } }
        public static Vector3 forward { get { return new Vector3(0, 0, 1); } }
        public static Vector3 right { get { return new Vector3(1, 0, 0); } }

        public float magnitude { get { return (float)Math.Sqrt(x * x + y * y + z * z); } }
        public float sqrMagnitude { get { return x * x + y * y + z * z; } }
        public Vector3 normalized { get { return this / magnitude; } }

        public static Vector3 Cross(Vector3 a, Vector3 b)
        {
            return new Vector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
        }

        public static float Dot(Vector3 a, Vector3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

        public static Vector3 operator +(Vector3 a, Vector3 b) { return new Vector3(a.x + b.x, a.y + b.y, a.z + b.z); }
        public static Vector3 operator -(Vector3 a, Vector3 b) { return new Vector3(a.x - b.x, a.y - b.y, a.z - b.z); }
        public static Vector3 operator *(Vector3 a, float s) { return new Vector3(a.x * s, a.y * s, a.z * s); }
        public static Vector3 operator *(float s, Vector3 a) { return a * s; }
        public static Vector3 operator /(Vector3 a, float s) { return new Vector3(a.x / s, a.y / s, a.z / s); }
    }

    public struct Vector3d
    {
        public double x;
        public double y;
        public double z;

        public Vector3d(double x, double y, double z)
        {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        public double magnitude { get { return Math.Sqrt(x * x + y * y + z * z); } }
        public Vector3d normalized { get { double m = magnitude; return m < 1e-12 ? new Vector3d(0, 0, 0) : new Vector3d(x / m, y / m, z / m); } }

        public static Vector3d operator +(Vector3d a, Vector3d b) => new Vector3d(a.x + b.x, a.y + b.y, a.z + b.z);
        public static Vector3d operator -(Vector3d a, Vector3d b) => new Vector3d(a.x - b.x, a.y - b.y, a.z - b.z);
        public static Vector3d operator *(Vector3d a, double s) => new Vector3d(a.x * s, a.y * s, a.z * s);

        public static implicit operator Vector3(Vector3d v) { return new Vector3((float)v.x, (float)v.y, (float)v.z); }
        public static implicit operator Vector3d(Vector3 v) { return new Vector3d(v.x, v.y, v.z); }
    }

    public struct Quaternion
    {
        public float x;
        public float y;
        public float z;
        public float w;

        public Quaternion(float x, float y, float z, float w)
        {
            this.x = x;
            this.y = y;
            this.z = z;
            this.w = w;
        }

        public static Quaternion identity { get { return new Quaternion(0, 0, 0, 1); } }
        public static Quaternion Euler(float x, float y, float z) { return identity; }

        public static Quaternion operator *(Quaternion a, Quaternion b) { return identity; }

        public static Vector3 operator *(Quaternion q, Vector3 v)
        {
            double ux = q.x, uy = q.y, uz = q.z, uw = q.w;
            double vx = v.x, vy = v.y, vz = v.z;
            double tx = 2 * (uy * vz - uz * vy);
            double ty = 2 * (uz * vx - ux * vz);
            double tz = 2 * (ux * vy - uy * vx);
            return new Vector3(
                (float)(vx + uw * tx + uy * tz - uz * ty),
                (float)(vy + uw * ty + uz * tx - ux * tz),
                (float)(vz + uw * tz + ux * ty - uy * tx));
        }

        public static Quaternion Inverse(Quaternion q) { return new Quaternion(-q.x, -q.y, -q.z, q.w); }
        public static Quaternion LookRotation(Vector3 forward, Vector3 upwards) { return identity; }
        public static Quaternion AngleAxis(float angle, Vector3 axis) { return identity; }
    }

    public struct Color
    {
        public float r, g, b, a;
        public Color(float r, float g, float b, float a = 1f) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public static Color white { get { return new Color(1, 1, 1, 1); } }
        public static Color black { get { return new Color(0, 0, 0, 1); } }
        public static Color red { get { return new Color(1, 0, 0, 1); } }
        public static Color yellow { get { return new Color(1, 1, 0, 1); } }
    }

    public struct Color32
    {
        public byte r, g, b, a;
        public Color32(byte r, byte g, byte b, byte a) { this.r = r; this.g = g; this.b = b; this.a = a; }
    }

    public struct Rect
    {
        public float x, y, width, height;
        public Rect(float x, float y, float width, float height) { this.x = x; this.y = y; this.width = width; this.height = height; }
    }

    public class Texture : Object { }

    public class Texture2D : Texture
    {
        public int width;
        public int height;
        public Texture2D(int width, int height) { this.width = width; this.height = height; }
        public void SetPixels(Color32[] colors) { }
        public void SetPixels32(Color32[] colors) { }
        public void Apply() { }
    }

    public static class Mathf
    {
        public const float Deg2Rad = 0.0174532924f;
        public const float Rad2Deg = 57.29578f;
        public static float Clamp(float v, float min, float max) { return v < min ? min : (v > max ? max : v); }
        public static float Clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
        public static float Lerp(float a, float b, float t) { return a + (b - a) * Clamp01(t); }
        public static float Abs(float v) { return Math.Abs(v); }
        public static float Max(float a, float b) { return Math.Max(a, b); }
        public static float Min(float a, float b) { return Math.Min(a, b); }
        public static int RoundToInt(float v) { return (int)Math.Round(v); }
    }

    public static class Time
    {
        public static float deltaTime { get; set; }
        public static float fixedDeltaTime { get; set; }
        public static float unscaledDeltaTime { get; set; }
        public static float realtimeSinceStartup { get; set; }
        public static double time { get; set; }
    }

    public static class Debug
    {
        public static void Log(object message) { }
        public static void LogWarning(object message) { }
        public static void LogError(object message) { }
        public static void LogException(Exception exception) { }
    }

    public static class Screen
    {
        public static int width { get; set; }
        public static int height { get; set; }
    }

    public static class Application
    {
        public static string unityVersion { get; set; }
        public static string persistentDataPath { get; set; }
    }

    public static class Input
    {
        public static bool GetKeyDown(KeyCode key) { return false; }
    }

    public enum KeyCode
    {
        None = 0,
        Backspace = 8,
        Tab = 9,
        Return = 13,
        Escape = 27,
        Space = 32,
        F1 = 282, F2 = 283, F3 = 284, F4 = 285, F5 = 286, F6 = 287,
        F7 = 288, F8 = 289, F9 = 290, F10 = 291, F11 = 292, F12 = 293
    }

    public enum TextAnchor { UpperLeft, UpperCenter, UpperRight, MiddleLeft, MiddleCenter, MiddleRight, LowerLeft, LowerCenter, LowerRight }

    public enum FontStyle { Normal, Bold, Italic, BoldAndItalic }

    public enum ScaleMode { StretchToFill, ScaleAndCrop, ScaleToFit }

    public class GUIStyleState
    {
        public Color textColor;
    }

    public class GUIStyle
    {
        public GUIStyle() { }
        public GUIStyle(GUIStyle other) { }
        public int fontSize;
        public bool wordWrap;
        public FontStyle fontStyle;
        public TextAnchor alignment;
        public GUIStyleState normal = new GUIStyleState();
    }

    public class GUISkin
    {
        public GUIStyle label = new GUIStyle();
        public GUIStyle box = new GUIStyle();
        public GUIStyle button = new GUIStyle();
        public GUIStyle window = new GUIStyle();
    }

    public class GUILayoutOption { }

    public static class GUI
    {
        public delegate void WindowFunction(int id);

        public static Color color;
        public static bool enabled = true;
        public static GUISkin skin = new GUISkin();

        public static void Label(Rect position, string text) { }
        public static void Label(Rect position, string text, GUIStyle style) { }
        public static void DrawTexture(Rect position, Texture image) { }
        public static void DrawTexture(Rect position, Texture image, ScaleMode scaleMode) { }
        public static void Box(Rect position, string text) { }
        public static void DragWindow() { }
        public static void DragWindow(Rect position) { }
        public static void Window(int id, Rect clientRect, WindowFunction func, string title) { }
    }

    public static class GUILayout
    {
        public static void Label(string text, params GUILayoutOption[] options) { }
        public static bool Button(string text, params GUILayoutOption[] options) { return false; }
        public static bool Toggle(bool value, string text, params GUILayoutOption[] options) { return value; }
        public static float HorizontalSlider(float value, float left, float right, params GUILayoutOption[] options) { return value; }
        public static void BeginHorizontal(params GUILayoutOption[] options) { }
        public static void EndHorizontal() { }
        public static void BeginVertical(params GUILayoutOption[] options) { }
        public static void EndVertical() { }
        public static void Space(float pixels) { }
        public static void FlexibleSpace() { }
        public static GUILayoutOption Width(float width) { return null; }
        public static GUILayoutOption Height(float height) { return null; }
        public static GUILayoutOption ExpandWidth(bool expand) { return null; }
        public static Rect Window(int id, Rect screenRect, GUI.WindowFunction func, string text, params GUILayoutOption[] options) { return screenRect; }
    }
}

namespace KSP
{
    [AttributeUsage(AttributeTargets.Class)]
    public class KSPAddon : Attribute
    {
        public enum Startup
        {
            All,
            MainMenu,
            Settings,
            Credits,
            SpaceCentre,
            EditorVAB,
            EditorSPH,
            Flight,
            TrackingStation,
            Any
        }

        public KSPAddon(Startup startUp, bool once)
        {
            StartUp = startUp;
            Once = once;
        }

        public Startup StartUp { get; private set; }
        public bool Once { get; private set; }
    }

    public class EventVoid
    {
        public void Add(Action action) { }
        public void Remove(Action action) { }
    }

    public class EventData<T>
    {
        public void Add(Action<T> action) { }
        public void Remove(Action<T> action) { }
    }

    public static class GameEvents
    {
        public struct HostedFromToAction<THost, TFrom>
        {
            public THost host;
            public TFrom from;
            public TFrom to;
        }

        public static EventVoid onFlightReady = new EventVoid();
        public static EventVoid onGamePause = new EventVoid();
        public static EventVoid onGameUnpause = new EventVoid();
        public static EventData<GameScenes> onSceneChange = new EventData<GameScenes>();
        public static EventData<GameScenes> onSceneChangeRequest = new EventData<GameScenes>();
        public static EventData<Vessel> onVesselChange = new EventData<Vessel>();
        public static EventData<Vessel> onVesselWillDestroy = new EventData<Vessel>();
        public static EventData<Vessel> onVesselDestroy = new EventData<Vessel>();
        public static EventData<EventReport> onCrash = new EventData<EventReport>();
        public static EventData<int> onStageActivate = new EventData<int>();
        public static EventData<Part> onPartDie = new EventData<Part>();
        public static EventData<HostedFromToAction<Vessel, CelestialBody>> onVesselSOIChanged =
            new EventData<HostedFromToAction<Vessel, CelestialBody>>();
    }
}

namespace KSP.UI.Screens
{
    public class ApplicationLauncherButton : UnityEngine.Object
    {
        public bool enabled;
        public void SetTrue(bool makeCall) { }
        public void SetFalse(bool makeCall) { }
    }

    public class ApplicationLauncher : UnityEngine.MonoBehaviour
    {
        [Flags]
        public enum AppScenes
        {
            NEVER = 0,
            ALWAYS = -1,
            SPACECENTER = 1,
            TRACKINGSTATION = 2,
            EDITOR = 4,
            EDITORVAB = 8,
            EDITORSPH = 16,
            FLIGHT = 32,
            MAINMENU = 64,
            SETTINGS = 128
        }

        public static ApplicationLauncher Instance { get; set; }

        public ApplicationLauncherButton AddModApplication(
            Action onTrue,
            Action onFalse,
            Action onHover,
            Action onHoverOut,
            Action onEnable,
            Action onDisable,
            AppScenes visibleInScenes,
            UnityEngine.Texture texture)
        {
            return new ApplicationLauncherButton();
        }

        public void RemoveModApplication(ApplicationLauncherButton button) { }
    }
}
