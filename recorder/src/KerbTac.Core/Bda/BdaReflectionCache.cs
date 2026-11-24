using System;
using System.Collections.Generic;
using System.Reflection;

namespace KerbTac.Core.Bda
{
    /// <summary>
    /// Small reflection helper for optional integrations. Lookups are cached per
    /// (type, member name); every failure is swallowed so a renamed BDA field
    /// can never break recording.
    /// </summary>
    public static class BdaReflectionCache
    {
        private struct Key : IEquatable<Key>
        {
            public readonly Type Type;
            public readonly string Name;

            public Key(Type type, string name)
            {
                Type = type;
                Name = name;
            }

            public bool Equals(Key other)
            {
                return ReferenceEquals(Type, other.Type) && string.Equals(Name, other.Name, StringComparison.Ordinal);
            }

            public override bool Equals(object obj)
            {
                return obj is Key && Equals((Key)obj);
            }

            public override int GetHashCode()
            {
                int hash = Type != null ? Type.GetHashCode() : 0;
                return (hash * 397) ^ (Name != null ? Name.GetHashCode() : 0);
            }
        }

        private sealed class Entry
        {
            public MemberInfo Member;
            public bool Resolved;
        }

        private static readonly object Gate = new object();
        private static readonly Dictionary<Key, Entry> Cache = new Dictionary<Key, Entry>();
        private static readonly Dictionary<Key, MethodInfo> MethodCache = new Dictionary<Key, MethodInfo>();

        /// <summary>Returns the first readable field/property value, or null.</summary>
        public static object Get(object instance, params string[] names)
        {
            if (instance == null || names == null || names.Length == 0)
            {
                return null;
            }

            Type type = instance.GetType();
            for (int i = 0; i < names.Length; i++)
            {
                string name = names[i];
                if (string.IsNullOrEmpty(name))
                {
                    continue;
                }

                MemberInfo member = Resolve(type, name);
                if (member == null)
                {
                    continue;
                }

                try
                {
                    FieldInfo field = member as FieldInfo;
                    if (field != null)
                    {
                        return field.GetValue(instance);
                    }

                    PropertyInfo property = member as PropertyInfo;
                    if (property != null && property.GetIndexParameters().Length == 0)
                    {
                        return property.GetValue(instance, null);
                    }
                }
                catch
                {
                    // A throwing property must not prevent trying the next name.
                }
            }

            return null;
        }

        /// <summary>
        /// Invokes a parameterless or argument method by name. BDA exposes a few
        /// useful helpers (GetWeaponClass, GetTntMass) that are methods rather
        /// than fields; a renamed or throwing method simply returns null.
        /// </summary>
        public static object Invoke(object instance, string name, params object[] args)
        {
            if (instance == null || string.IsNullOrEmpty(name))
            {
                return null;
            }

            MethodInfo method = ResolveMethod(instance.GetType(), name, args == null ? 0 : args.Length);
            if (method == null)
            {
                return null;
            }

            try
            {
                return method.Invoke(instance, args);
            }
            catch
            {
                return null;
            }
        }

        private static MethodInfo ResolveMethod(Type type, string name, int argCount)
        {
            Key key = new Key(type, "method:" + name + "/" + argCount);
            lock (Gate)
            {
                MethodInfo cached;
                if (MethodCache.TryGetValue(key, out cached))
                {
                    return cached;
                }

                MethodInfo method = FindMethod(type, name, argCount);
                MethodCache[key] = method;
                return method;
            }
        }

        private static MethodInfo FindMethod(Type type, string name, int argCount)
        {
            const BindingFlags Flags = BindingFlags.Public | BindingFlags.Instance;
            const BindingFlags NonPublicFlags = BindingFlags.NonPublic | BindingFlags.Instance;

            try
            {
                MethodInfo[] methods = type.GetMethods(Flags);
                for (int i = 0; i < methods.Length; i++)
                {
                    if (methods[i].GetParameters().Length == argCount &&
                        string.Equals(methods[i].Name, name, StringComparison.Ordinal))
                    {
                        return methods[i];
                    }
                }

                for (int i = 0; i < methods.Length; i++)
                {
                    if (methods[i].GetParameters().Length == argCount &&
                        string.Equals(methods[i].Name, name, StringComparison.OrdinalIgnoreCase))
                    {
                        return methods[i];
                    }
                }

                MethodInfo[] nonPublic = type.GetMethods(NonPublicFlags);
                for (int i = 0; i < nonPublic.Length; i++)
                {
                    if (nonPublic[i].GetParameters().Length == argCount &&
                        string.Equals(nonPublic[i].Name, name, StringComparison.OrdinalIgnoreCase))
                    {
                        return nonPublic[i];
                    }
                }
            }
            catch
            {
                // Ignore malformed/ambiguous methods.
            }

            return null;
        }

        private static MemberInfo Resolve(Type type, string name)
        {
            Key key = new Key(type, name);
            lock (Gate)
            {
                Entry entry;
                if (Cache.TryGetValue(key, out entry))
                {
                    return entry.Member;
                }

                entry = new Entry { Resolved = true };
                entry.Member = Find(type, name);
                Cache[key] = entry;
                return entry.Member;
            }
        }

        private static MemberInfo Find(Type type, string name)
        {
            const BindingFlags Flags = BindingFlags.Public | BindingFlags.Instance;
            const BindingFlags NonPublicFlags = BindingFlags.NonPublic | BindingFlags.Instance;

            try
            {
                FieldInfo field = type.GetField(name, Flags);
                if (field != null)
                {
                    return field;
                }

                PropertyInfo property = type.GetProperty(name, Flags);
                if (property != null)
                {
                    return property;
                }

                // Some BDA versions keep the AI's current target in a private
                // field (for example guardTarget). Reading it is still safe:
                // a missing or renamed member simply falls through.
                FieldInfo privateField = type.GetField(name, NonPublicFlags);
                if (privateField != null)
                {
                    return privateField;
                }

                // BDA has renamed members between releases; a case-insensitive
                // match keeps those recordings useful without hard references.
                FieldInfo[] fields = type.GetFields(Flags);
                for (int i = 0; i < fields.Length; i++)
                {
                    if (string.Equals(fields[i].Name, name, StringComparison.OrdinalIgnoreCase))
                    {
                        return fields[i];
                    }
                }

                PropertyInfo[] properties = type.GetProperties(Flags);
                for (int i = 0; i < properties.Length; i++)
                {
                    if (string.Equals(properties[i].Name, name, StringComparison.OrdinalIgnoreCase) &&
                        properties[i].GetIndexParameters().Length == 0)
                    {
                        return properties[i];
                    }
                }

                FieldInfo[] privateFields = type.GetFields(NonPublicFlags);
                for (int i = 0; i < privateFields.Length; i++)
                {
                    if (string.Equals(privateFields[i].Name, name, StringComparison.OrdinalIgnoreCase))
                    {
                        return privateFields[i];
                    }
                }
            }
            catch
            {
                // Ignore malformed/ambiguous members.
            }

            return null;
        }
    }
}
