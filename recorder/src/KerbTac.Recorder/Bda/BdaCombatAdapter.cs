using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using KerbTac.Core;
using KerbTac.Core.Bda;
using UnityEngine;

namespace KerbTac.Recorder.Bda
{
    /// <summary>
    /// Reads BDA combat modules by reflection and turns their low-level state
    /// into the platform-independent signals consumed by RecordingSession.
    /// No BDA assembly is referenced at compile time.
    /// </summary>
    public sealed class BdaCombatAdapter
    {
        private sealed class ModuleRef
        {
            public object Module;
            public Part Part;
            public int Index;
        }

        private sealed class VesselModules
        {
            public double RefreshedUt;
            public int PartCount;
            public readonly List<ModuleRef> Weapons = new List<ModuleRef>();
            public readonly List<ModuleRef> Countermeasures = new List<ModuleRef>();
        }

        private readonly Type _weaponType;
        private readonly Type _cmType;
        private readonly Type _missileBaseType;
        private readonly Type _missileLauncherType;
        private readonly Type _fireControlType;
        private readonly Type _pilotAiType;
        private readonly GunfireBurstTracker _gunfire = new GunfireBurstTracker();
        private readonly CountermeasureTracker _countermeasures = new CountermeasureTracker();
        private readonly ActorTracker _actors = new ActorTracker();
        private readonly Dictionary<string, VesselModules> _modules = new Dictionary<string, VesselModules>();
        private Quatd _bodyRotation = Quatd.Identity;
        private bool _stopped;

        public BdaCombatAdapter(IEnumerable<Assembly> assemblies)
        {
            _weaponType = FindType(assemblies, "ModuleWeapon");
            _cmType = FindType(assemblies, "CMDropper");
            _missileBaseType = FindType(assemblies, "MissileBase");
            _missileLauncherType = FindType(assemblies, "MissileLauncher");
            _fireControlType = FindType(assemblies, "MissileFire");
            _pilotAiType = FindType(assemblies, "BDModulePilotAI");
        }

        public bool IsAvailable
        {
            get { return _weaponType != null || _cmType != null || _missileBaseType != null; }
        }

        public bool HasGuns { get { return _weaponType != null; } }
        public bool HasCountermeasures { get { return _cmType != null; } }
        public bool HasActors { get { return _missileBaseType != null || _missileLauncherType != null; } }

        /// <summary>
        /// Fixes the body frame used by muzzle/eject transforms. The player
        /// renders everything in the session-start body frame, so using the
        /// live body rotation here would drift by kilometres over a few minutes.
        /// </summary>
        public void SetBodyRotation(Quatd rotation)
        {
            if (rotation.IsFinite)
            {
                _bodyRotation = rotation;
            }
        }

        /// <summary>
        /// Polls every weapon and countermeasure module on the supplied vessels.
        /// Completed gunfire bursts and countermeasure releases are appended to
        /// the caller's lists.
        /// </summary>
        public void PollCombat(
            IEnumerable<Vessel> vessels,
            double ut,
            List<GunfireBurstSignal> gunfire,
            List<CountermeasureReleaseSignal> countermeasures)
        {
            if (_stopped || vessels == null)
            {
                return;
            }

            foreach (Vessel vessel in vessels)
            {
                if (vessel == null)
                {
                    continue;
                }

                VesselModules modules = GetModules(vessel, ut);
                for (int i = 0; i < modules.Weapons.Count; i++)
                {
                    PollWeapon(vessel, modules.Weapons[i], ut, gunfire);
                }
                for (int i = 0; i < modules.Countermeasures.Count; i++)
                {
                    PollCountermeasure(vessel, modules.Countermeasures[i], ut, countermeasures);
                }
            }

            IReadOnlyList<GunfireBurstSignal> stale = _gunfire.FlushStale(ut);
            for (int i = 0; i < stale.Count; i++)
            {
                gunfire.Add(stale[i]);
            }
        }

        public ActorPollResult PollActors(double ut)
        {
            if (_stopped || !HasActors)
            {
                return new ActorPollResult();
            }

            List<ActorInput> inputs = new List<ActorInput>();
            List<Vessel> loaded = FlightGlobals.VesselsLoaded;
            for (int i = 0; i < loaded.Count; i++)
            {
                Vessel vessel = loaded[i];
                if (vessel == null || vessel.mainBody == null || IsDebrisLike(vessel))
                {
                    continue;
                }

                object missile = FindModule(vessel, _missileBaseType);
                if (missile == null)
                {
                    missile = FindModule(vessel, _missileLauncherType);
                }
                if (missile == null || HasFireControl(vessel))
                {
                    continue;
                }

                inputs.Add(BuildActorInput(vessel, missile, ut));
            }

            return _actors.Poll(inputs, ut);
        }

        public Vessel FindLoadedVessel(string id)
        {
            if (string.IsNullOrEmpty(id))
            {
                return null;
            }

            List<Vessel> loaded = FlightGlobals.VesselsLoaded;
            for (int i = 0; i < loaded.Count; i++)
            {
                Vessel vessel = loaded[i];
                if (vessel != null && string.Equals(vessel.id.ToString(), id, StringComparison.Ordinal))
                {
                    return vessel;
                }
            }

            return null;
        }

        private static Vessel FindLoadedVesselByName(string name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return null;
            }

            List<Vessel> loaded = FlightGlobals.VesselsLoaded;
            for (int i = 0; i < loaded.Count; i++)
            {
                Vessel vessel = loaded[i];
                if (vessel != null && string.Equals(vessel.vesselName, name, StringComparison.Ordinal))
                {
                    return vessel;
                }
            }

            return null;
        }

        private static bool IsDebrisLike(Vessel vessel)
        {
            string type = vessel.vesselType.ToString();
            if (type.IndexOf("debris", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return true;
            }

            string name = vessel.vesselName ?? string.Empty;
            if (name.IndexOf("debris", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return true;
            }

            if (type != "Probe" && type != "Relay" && type != "Station")
            {
                return false;
            }
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

        public IReadOnlyList<GunfireBurstSignal> Stop()
        {
            _stopped = true;
            _modules.Clear();
            return _gunfire.FlushAll();
        }

        /// <summary>Clears baselines so a new recording starts from a clean slate.</summary>
        public void Reset()
        {
            _stopped = false;
            _modules.Clear();
            _gunfire.Reset();
            _countermeasures.Reset();
            _actors.Reset();
        }

        private ActorInput BuildActorInput(Vessel vessel, object missile, double ut)
        {
            Vessel parent = BdaReflectionCache.Get(missile, "SourceVessel", "sourceVessel") as Vessel;
            if (parent == null)
            {
                string parentName = AsString(BdaReflectionCache.Get(missile, "SourceVesselName", "sourceVesselName"));
                parent = FindLoadedVesselByName(parentName);
            }
            Vessel target = BdaReflectionCache.Get(missile, "targetVessel", "TargetVessel") as Vessel;
            if (target == null)
            {
                object targetInfo = BdaReflectionCache.Get(missile, "targetVessel", "TargetVessel");
                if (targetInfo != null)
                {
                    target = BdaReflectionCache.Get(targetInfo, "Vessel", "vessel") as Vessel;
                }
            }
            if (target == null)
            {
                string targetName = AsString(BdaReflectionCache.Get(missile, "TargetVesselName", "targetVesselName"));
                target = FindLoadedVesselByName(targetName);
            }
            string weapon = AsString(BdaReflectionCache.Get(
                missile, "shortName", "WeaponName", "weaponName", "missileName", "displayName", "name"));
            object weaponClass = BdaReflectionCache.Invoke(missile, "GetWeaponClass");
            BdaActorClass actorClass = ParseActorClass(weaponClass);
            object tnt = BdaReflectionCache.Invoke(missile, "GetTntMass");
            if (tnt == null)
            {
                tnt = BdaReflectionCache.Get(missile, "tntMass", "TntMass");
            }
            object warhead = BdaReflectionCache.Get(missile, "warheadType", "WarheadType");

            return new ActorInput
            {
                ActorId = vessel.id.ToString(),
                Name = string.IsNullOrEmpty(vessel.vesselName) ? weapon : vessel.vesselName,
                ActorClass = actorClass,
                ParentId = parent != null ? parent.id.ToString() : null,
                TargetId = target != null ? target.id.ToString() : null,
                Weapon = weapon,
                Body = BodyCatalog.BodyName(vessel.mainBody),
                Lat = vessel.latitude,
                Lon = vessel.longitude,
                Alt = vessel.altitude,
                Ut = ut,
                HasExploded = ToBool(BdaReflectionCache.Get(missile, "HasExploded", "hasExploded"), false),
                HasMissed = ToBool(BdaReflectionCache.Get(missile, "HasMissed", "hasMissed"), false),
                TntMass = ToFloat(tnt, 0f),
                Warhead = AsString(warhead),
                ExplosionSource = ActorExplosionSource(actorClass)
            };
        }

        private void PollWeapon(
            Vessel vessel,
            ModuleRef module,
            double ut,
            List<GunfireBurstSignal> output)
        {
            object value = BdaReflectionCache.Get(module.Module, "timeFired", "TimeFired");
            if (value == null)
            {
                return;
            }

            float timeFired = ToFloat(value, -1f);
            if (timeFired < 0f)
            {
                return;
            }

            Transform muzzle = FirstTransform(BdaReflectionCache.Get(module.Module, "fireTransforms"));
            if (muzzle == null)
            {
                string name = AsString(BdaReflectionCache.Get(module.Module, "muzzleTransformName"));
                muzzle = FindModelTransform(module.Part, name);
            }
            if (muzzle == null && module.Part != null)
            {
                muzzle = module.Part.transform;
            }
            if (muzzle == null)
            {
                return;
            }

            Quatd bodyRotation = _bodyRotation;
            Vec3d positionBf = BodyFixed.FromLatLonAlt(
                vessel.latitude,
                vessel.longitude,
                vessel.altitude,
                vessel.mainBody.Radius);
            Vec3d directionBf = BodyFixed.DirectionFromWorld(ToVec3d(muzzle.forward), bodyRotation);

            GunfireInput input = new GunfireInput
            {
                VesselId = vessel.id.ToString(),
                PartId = module.Part != null ? module.Part.flightID.ToString() : null,
                ModuleIndex = module.Index,
                Ut = ut,
                TimeFired = timeFired,
                RoundsRemaining = ToInt(BdaReflectionCache.Get(module.Module, "RoundsRemaining", "roundsRemaining"), -1),
                RoundsPerMinute = ToFloat(BdaReflectionCache.Get(module.Module, "roundsPerMinute", "RoundsPerMinute"), 0f),
                IsReloading = ToBool(BdaReflectionCache.Get(module.Module, "isReloading", "IsReloading"), false),
                PositionBf = positionBf,
                DirectionBf = directionBf,
                WeaponType = AsString(BdaReflectionCache.Get(module.Module, "weaponType", "WeaponType")),
                Ammo = AsString(BdaReflectionCache.Get(module.Module, "ammoName", "AmmoName")),
                Caliber = ToFloat(BdaReflectionCache.Get(module.Module, "caliber", "Caliber"), 0f),
                MuzzleSpeed = ToFloat(BdaReflectionCache.Get(module.Module, "bulletVelocity", "BulletVelocity"), 0f),
                TracerColor = ColorHex(BdaReflectionCache.Get(module.Module, "tracerColor", "TracerColor"))
            };

            IReadOnlyList<GunfireBurstSignal> completed = _gunfire.Poll(new[] { input });
            for (int i = 0; i < completed.Count; i++)
            {
                output.Add(completed[i]);
            }
        }

        private void PollCountermeasure(
            Vessel vessel,
            ModuleRef module,
            double ut,
            List<CountermeasureReleaseSignal> output)
        {
            int count = ToInt(BdaReflectionCache.Get(module.Module, "cmCount", "CmCount"), -1);
            if (count < 0)
            {
                return;
            }

            Transform eject = FindModelTransform(
                module.Part, AsString(BdaReflectionCache.Get(module.Module, "ejectTransformName")));
            if (eject == null && module.Part != null)
            {
                eject = module.Part.transform;
            }
            if (eject == null)
            {
                return;
            }

            Quatd bodyRotation = _bodyRotation;
            Vec3d positionBf = BodyFixed.FromLatLonAlt(
                vessel.latitude,
                vessel.longitude,
                vessel.altitude,
                vessel.mainBody.Radius);
            Vec3d directionBf = BodyFixed.DirectionFromWorld(ToVec3d(eject.forward), bodyRotation);
            Vec3d vesselVelocityBf = BodyFixed.DirectionFromWorld(ToVec3d(vessel.srf_velocity), bodyRotation);

            CountermeasureInput input = new CountermeasureInput
            {
                VesselId = vessel.id.ToString(),
                PartId = module.Part != null ? module.Part.flightID.ToString() : null,
                ModuleIndex = module.Index,
                Ut = ut,
                Count = count,
                CountermeasureType = AsString(BdaReflectionCache.Get(
                    module.Module, "countermeasureType", "CountermeasureType")),
                EjectVelocity = ToFloat(BdaReflectionCache.Get(module.Module, "ejectVelocity", "EjectVelocity"), 0f),
                PositionBf = positionBf,
                DirectionBf = directionBf,
                VesselVelocityBf = vesselVelocityBf
            };

            IReadOnlyList<CountermeasureReleaseSignal> released = _countermeasures.Poll(new[] { input });
            for (int i = 0; i < released.Count; i++)
            {
                output.Add(released[i]);
            }
        }

        private VesselModules GetModules(Vessel vessel, double ut)
        {
            string id = vessel.id.ToString();
            VesselModules modules;
            int partCount = vessel.parts != null ? vessel.parts.Count : 0;
            if (_modules.TryGetValue(id, out modules) &&
                ut - modules.RefreshedUt < 2.0 &&
                modules.PartCount == partCount)
            {
                return modules;
            }

            modules = new VesselModules { RefreshedUt = ut, PartCount = partCount };
            if (vessel.parts != null)
            {
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

                        Type type = module.GetType();
                        if (_weaponType != null && _weaponType.IsAssignableFrom(type))
                        {
                            modules.Weapons.Add(new ModuleRef { Module = module, Part = part, Index = m });
                        }
                        if (_cmType != null && _cmType.IsAssignableFrom(type))
                        {
                            modules.Countermeasures.Add(new ModuleRef { Module = module, Part = part, Index = m });
                        }
                    }
                }
            }

            _modules[id] = modules;
            return modules;
        }

        private bool HasFireControl(Vessel vessel)
        {
            return FindModule(vessel, _fireControlType) != null || FindModule(vessel, _pilotAiType) != null;
        }

        private static object FindModule(Vessel vessel, Type type)
        {
            if (vessel == null || type == null || vessel.parts == null)
            {
                return null;
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
                    if (module != null && type.IsAssignableFrom(module.GetType()))
                    {
                        return module;
                    }
                }
            }

            return null;
        }

        private static Transform FirstTransform(object value)
        {
            Transform[] transforms = value as Transform[];
            if (transforms != null && transforms.Length > 0)
            {
                return transforms[0];
            }

            Array array = value as Array;
            if (array != null && array.Length > 0)
            {
                return array.GetValue(0) as Transform;
            }

            return null;
        }

        private static Transform FindModelTransform(Part part, string name)
        {
            if (part == null || string.IsNullOrEmpty(name))
            {
                return null;
            }

            return BdaReflectionCache.Invoke(part, "FindModelTransform", name) as Transform;
        }

        private static Vec3d ToVec3d(Vector3 value)
        {
            return new Vec3d(value.x, value.y, value.z);
        }

        private static Vec3d ToVec3d(Vector3d value)
        {
            return new Vec3d(value.x, value.y, value.z);
        }

        private static BdaActorClass ParseActorClass(object value)
        {
            if (value == null)
            {
                return BdaActorClass.Unknown;
            }

            string text = value.ToString();
            if (string.Equals(text, "Missile", StringComparison.OrdinalIgnoreCase))
            {
                return BdaActorClass.Missile;
            }
            if (string.Equals(text, "Bomb", StringComparison.OrdinalIgnoreCase))
            {
                return BdaActorClass.Bomb;
            }
            if (string.Equals(text, "Rocket", StringComparison.OrdinalIgnoreCase))
            {
                return BdaActorClass.Rocket;
            }
            if (string.Equals(text, "Gun", StringComparison.OrdinalIgnoreCase))
            {
                return BdaActorClass.Gun;
            }
            if (string.Equals(text, "DefenseLaser", StringComparison.OrdinalIgnoreCase))
            {
                return BdaActorClass.DefenseLaser;
            }
            if (string.Equals(text, "SLW", StringComparison.OrdinalIgnoreCase))
            {
                return BdaActorClass.Slw;
            }

            return BdaActorClass.Unknown;
        }

        private static string ActorExplosionSource(BdaActorClass actorClass)
        {
            switch (actorClass)
            {
                case BdaActorClass.Bomb:
                    return "bomb";
                case BdaActorClass.Rocket:
                    return "rocket";
                case BdaActorClass.Missile:
                case BdaActorClass.Slw:
                    return "missile";
                default:
                    return "other";
            }
        }

        private static string ColorHex(object value)
        {
            if (value is Color)
            {
                Color color = (Color)value;
                return "#" + ((int)(Mathf.Clamp01(color.r) * 255f)).ToString("X2") +
                       ((int)(Mathf.Clamp01(color.g) * 255f)).ToString("X2") +
                       ((int)(Mathf.Clamp01(color.b) * 255f)).ToString("X2");
            }

            return AsString(value);
        }

        private static string AsString(object value)
        {
            return value as string;
        }

        private static float ToFloat(object value, float fallback)
        {
            if (value == null)
            {
                return fallback;
            }

            try
            {
                return Convert.ToSingle(value);
            }
            catch
            {
                return fallback;
            }
        }

        private static int ToInt(object value, int fallback)
        {
            if (value == null)
            {
                return fallback;
            }

            try
            {
                return Convert.ToInt32(value);
            }
            catch
            {
                return fallback;
            }
        }

        private static bool ToBool(object value, bool fallback)
        {
            if (value == null)
            {
                return fallback;
            }
            if (value is bool)
            {
                return (bool)value;
            }

            bool parsed;
            return bool.TryParse(value.ToString(), out parsed) ? parsed : fallback;
        }

        private static Type FindType(IEnumerable<Assembly> assemblies, string name)
        {
            if (assemblies == null)
            {
                return null;
            }

            foreach (Assembly assembly in assemblies)
            {
                if (assembly == null)
                {
                    continue;
                }

                Type[] types;
                try
                {
                    types = assembly.GetTypes();
                }
                catch (ReflectionTypeLoadException ex)
                {
                    types = ex.Types;
                }
                catch
                {
                    continue;
                }

                if (types == null)
                {
                    continue;
                }

                for (int i = 0; i < types.Length; i++)
                {
                    Type type = types[i];
                    if (type != null && string.Equals(type.Name, name, StringComparison.Ordinal))
                    {
                        return type;
                    }
                }
            }

            return null;
        }
    }
}
