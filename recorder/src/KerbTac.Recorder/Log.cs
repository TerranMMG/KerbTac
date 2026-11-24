using System;
using UnityEngine;

namespace KerbTac.Recorder
{
    /// <summary>All recorder logging goes through here, prefixed with [KerbTac].</summary>
    internal static class Log
    {
        private const string Prefix = "[KerbTac] ";

        public static void Info(string message)
        {
            Debug.Log(Prefix + message);
        }

        public static void Warn(string message)
        {
            Debug.LogWarning(Prefix + message);
        }

        public static void Error(string message)
        {
            Debug.LogError(Prefix + message);
        }

        public static void Exception(string context, Exception exception)
        {
            Debug.LogError(Prefix + context + ": " + exception);
        }
    }

    /// <summary>Build-time information shown in the UI and written to manifest.json.</summary>
    internal static class PluginInfo
    {
        public const string Name = "KerbTac Recorder";
        public const string Version = "0.1.0";

        public static string KspVersion()
        {
            try
            {
                // Resolved by name so the plugin does not hard-reference Versioning.
                Type type = Type.GetType("Versioning, Assembly-CSharp");
                if (type != null)
                {
                    System.Reflection.PropertyInfo property = type.GetProperty(
                        "VersionString",
                        System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                    if (property != null)
                    {
                        object value = property.GetValue(null, null);
                        if (value != null)
                        {
                            return value.ToString();
                        }
                    }

                    System.Reflection.MethodInfo full = type.GetMethod(
                        "GetVersionStringFull",
                        System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                    if (full != null)
                    {
                        object value = full.Invoke(null, null);
                        if (value != null)
                        {
                            return value.ToString();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Warn("Could not read KSP version: " + ex.Message);
            }
            return "unknown";
        }

        public static string UnityVersion()
        {
            try
            {
                return Application.unityVersion ?? "unknown";
            }
            catch
            {
                return "unknown";
            }
        }
    }
}
