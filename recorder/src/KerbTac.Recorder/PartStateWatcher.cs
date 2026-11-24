using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;

namespace KerbTac.Recorder
{
    internal struct PartStateChange
    {
        public string PartName;
        public string PartId;
        public int EngineIndex;
        public bool State;
    }

    /// <summary>
    /// Detects landing gear and engine state changes by reflection, so the
    /// recorder does not need to reference specific KSP modules (and keeps
    /// working if a mod replaces them).
    /// </summary>
    internal sealed class PartStateWatcher
    {
        private sealed class Accessor
        {
            public Func<object, bool> Read;
        }

        private readonly Dictionary<Part, bool> _gearState = new Dictionary<Part, bool>();
        private readonly Dictionary<PartModule, bool> _engineState = new Dictionary<PartModule, bool>();
        private readonly Dictionary<Type, Accessor> _gearAccessors = new Dictionary<Type, Accessor>();
        private readonly Dictionary<Type, Accessor> _engineAccessors = new Dictionary<Type, Accessor>();
        private bool _seeded;
        private bool _gearGroupSeeded;
        private bool _gearGroupState;

        public void Reset()
        {
            _gearState.Clear();
            _engineState.Clear();
            _seeded = false;
            _gearGroupSeeded = false;
        }

        /// <summary>
        /// Fills the change lists. The first poll after Reset only seeds state
        /// and reports nothing, so loading a save does not emit fake events.
        /// </summary>
        public void Poll(Vessel vessel, List<PartStateChange> gearChanges, List<PartStateChange> engineChanges)
        {
            if (vessel == null || vessel.parts == null)
            {
                return;
            }

            bool gearGroupChanged = PollGearActionGroup(vessel, gearChanges);

            for (int i = 0; i < vessel.parts.Count; i++)
            {
                Part part = vessel.parts[i];
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                bool gearValue;
                if (TryReadGearState(part, out gearValue))
                {
                    bool previous;
                    if (_gearState.TryGetValue(part, out previous))
                    {
                        if (previous != gearValue && _seeded && !gearGroupChanged)
                        {
                            gearChanges.Add(new PartStateChange
                            {
                                PartName = VesselSampler.PartName(part),
                                PartId = PartId(part),
                                EngineIndex = -1,
                                State = gearValue
                            });
                        }
                    }
                    _gearState[part] = gearValue;
                }

                // Every engine module is tracked separately: a part may host
                // several engines, and the player needs to know which one lit.
                for (int j = 0; j < part.Modules.Count; j++)
                {
                    PartModule module = part.Modules[j];
                    if (module == null)
                    {
                        continue;
                    }
                    Type type = module.GetType();
                    string typeName = type.Name;
                    if (typeName.IndexOf("ModuleEngines", StringComparison.OrdinalIgnoreCase) < 0)
                    {
                        continue;
                    }

                    Accessor accessor;
                    if (!_engineAccessors.TryGetValue(type, out accessor))
                    {
                        accessor = BuildEngineAccessor(type);
                        _engineAccessors[type] = accessor;
                    }
                    if (accessor == null)
                    {
                        continue;
                    }

                    bool engineValue;
                    try
                    {
                        engineValue = accessor.Read(module);
                    }
                    catch (Exception ex)
                    {
                        Log.Warn("Reading " + typeName + " state failed: " + ex.Message);
                        continue;
                    }

                    bool previous;
                    if (_engineState.TryGetValue(module, out previous))
                    {
                        if (previous != engineValue && _seeded)
                        {
                            engineChanges.Add(new PartStateChange
                            {
                                PartName = VesselSampler.PartName(part),
                                PartId = PartId(part),
                                EngineIndex = j,
                                State = engineValue
                            });
                        }
                    }
                    _engineState[module] = engineValue;
                }
            }

            _seeded = true;
        }

        /// <summary>
        /// The Gear action group is the authoritative state for stock and modded
        /// craft alike: many gear parts do not expose a readable deployed flag.
        /// Returns true when the group changed during this poll.
        /// </summary>
        private bool PollGearActionGroup(Vessel vessel, List<PartStateChange> gearChanges)
        {
            try
            {
                ActionGroupList groups = vessel.ActionGroups;
                if (groups == null)
                {
                    return false;
                }
                bool deployed = groups[KSPActionGroup.Gear];
                bool changed = _gearGroupSeeded && deployed != _gearGroupState;
                _gearGroupState = deployed;
                _gearGroupSeeded = true;
                if (changed)
                {
                    gearChanges.Add(new PartStateChange
                    {
                        PartName = "Gear",
                        PartId = "Gear",
                        EngineIndex = -1,
                        State = deployed
                    });
                }
                return changed;
            }
            catch (Exception ex)
            {
                Log.Warn("Reading the Gear action group failed: " + ex.Message);
                return false;
            }
        }

        private bool TryReadGearState(Part part, out bool value)
        {
            value = false;
            foreach (PartModule module in part.Modules)
            {
                if (module == null)
                {
                    continue;
                }

                Type type = module.GetType();
                string typeName = type.Name;
                if (!IsGearModule(typeName))
                {
                    continue;
                }

                Accessor accessor;
                if (!_gearAccessors.TryGetValue(type, out accessor))
                {
                    accessor = BuildGearAccessor(type);
                    _gearAccessors[type] = accessor;
                }

                if (accessor != null)
                {
                    try
                    {
                        value = accessor.Read(module);
                        return true;
                    }
                    catch (Exception ex)
                    {
                        Log.Warn("Reading " + typeName + " state failed: " + ex.Message);
                    }
                }
            }
            return false;
        }

        private static string PartId(Part part)
        {
            try
            {
                return part != null ? part.flightID.ToString() : "";
            }
            catch
            {
                return "";
            }
        }

        private static bool IsGearModule(string typeName)
        {
            return typeName.IndexOf("LandingGear", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   typeName.IndexOf("LandingLeg", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   typeName.IndexOf("WheelDeployment", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static Accessor BuildGearAccessor(Type type)
        {
            Accessor accessor = BuildBoolAccessor(type, "deployed") ??
                                BuildBoolAccessor(type, "gearDeployed");
            if (accessor != null)
            {
                return accessor;
            }

            // ModuleWheelDeployment exposes stateString ("Deployed" /
            // "Retracted"), older gear modules expose a State enum.
            MemberInfo member = FindMember(type, "stateString") ?? FindMember(type, "State");
            if (member == null)
            {
                return null;
            }

            Type memberType = member is PropertyInfo
                ? ((PropertyInfo)member).PropertyType
                : ((FieldInfo)member).FieldType;
            if (memberType == typeof(string))
            {
                return new Accessor
                {
                    Read = target => IsDeployedText(ReadMember(target, member) as string)
                };
            }
            if (memberType.IsEnum)
            {
                return new Accessor
                {
                    Read = target => IsDeployedText(ReadMember(target, member).ToString())
                };
            }
            return null;
        }

        private static bool IsDeployedText(string text)
        {
            return !string.IsNullOrEmpty(text) &&
                   text.IndexOf("Deployed", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        /// <summary>
        /// Logs the distinct gear/wheel/deploy module types on the vessel so a
        /// missing gear event can be diagnosed from KSP.log in one run.
        /// </summary>
        public static void LogRelevantModules(Vessel vessel)
        {
            if (vessel == null || vessel.parts == null)
            {
                return;
            }

            HashSet<string> names = new HashSet<string>();

            for (int i = 0; i < vessel.parts.Count; i++)
            {
                Part part = vessel.parts[i];
                if (part == null || part.Modules == null)
                {
                    continue;
                }
                for (int j = 0; j < part.Modules.Count; j++)
                {
                    PartModule module = part.Modules[j];
                    if (module == null)
                    {
                        continue;
                    }
                    string name = module.GetType().Name;
                    if (IsGearModule(name) ||
                        name.IndexOf("Deploy", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        names.Add(name);
                    }
                }
            }

            if (names.Count == 0)
            {
                Log.Info("No gear/deploy modules found on vessel");
                return;
            }

            List<string> sorted = new List<string>(names);
            sorted.Sort(StringComparer.Ordinal);
            Log.Info("Gear/deploy modules: " + string.Join(", ", sorted.ToArray()));
        }

        private static Accessor BuildEngineAccessor(Type type)
        {
            return BuildBoolAccessor(type, "EngineIgnited") ?? BuildBoolAccessor(type, "isFlamedOut");
        }

        private static Accessor BuildBoolAccessor(Type type, string name)
        {
            MemberInfo member = FindMember(type, name);
            if (member == null)
            {
                return null;
            }

            Type memberType = member is PropertyInfo
                ? ((PropertyInfo)member).PropertyType
                : ((FieldInfo)member).FieldType;
            if (memberType != typeof(bool))
            {
                return null;
            }

            return new Accessor { Read = target => (bool)ReadMember(target, member) };
        }

        private static MemberInfo FindMember(Type type, string name)
        {
            for (Type current = type; current != null; current = current.BaseType)
            {
                PropertyInfo property = current.GetProperty(
                    name, BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
                if (property != null && property.CanRead)
                {
                    return property;
                }

                FieldInfo field = current.GetField(
                    name, BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
                if (field != null)
                {
                    return field;
                }
            }
            return null;
        }

        private static object ReadMember(object target, MemberInfo member)
        {
            PropertyInfo property = member as PropertyInfo;
            if (property != null)
            {
                return property.GetValue(target, null);
            }
            return ((FieldInfo)member).GetValue(target);
        }
    }
}
