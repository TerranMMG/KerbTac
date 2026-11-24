using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>BDA weapon class as reported by MissileBase.GetWeaponClass().</summary>
    public enum BdaActorClass
    {
        Unknown = 0,
        Missile,
        Bomb,
        Rocket,
        Gun,
        DefenseLaser,
        Slw
    }

    public enum BdaCountermeasureKind
    {
        Unknown = 0,
        Chaff,
        Flare,
        Smoke,
        Decoy,
        Bubble
    }

    public static class BdaCombatKinds
    {
        public static string ActorKind(BdaActorClass actorClass)
        {
            switch (actorClass)
            {
                case BdaActorClass.Missile:
                    return "weapon/missile";
                case BdaActorClass.Bomb:
                    return "weapon/bomb";
                case BdaActorClass.Rocket:
                    return "weapon/rocket";
                case BdaActorClass.Gun:
                    return "weapon/shell";
                case BdaActorClass.DefenseLaser:
                    return "weapon/beam";
                case BdaActorClass.Slw:
                    // Sea-launched weapons (torpedoes) still fly like missiles.
                    return "weapon/missile";
                default:
                    return "weapon/unknown";
            }
        }

        public static BdaCountermeasureKind CountermeasureKind(string type)
        {
            if (string.IsNullOrEmpty(type))
            {
                return BdaCountermeasureKind.Unknown;
            }

            string lower = type.Trim().ToLowerInvariant();
            if (lower.Contains("chaff"))
            {
                return BdaCountermeasureKind.Chaff;
            }
            if (lower.Contains("flare"))
            {
                return BdaCountermeasureKind.Flare;
            }
            if (lower.Contains("smoke"))
            {
                return BdaCountermeasureKind.Smoke;
            }
            if (lower.Contains("decoy"))
            {
                return BdaCountermeasureKind.Decoy;
            }
            if (lower.Contains("bubble"))
            {
                return BdaCountermeasureKind.Bubble;
            }

            return BdaCountermeasureKind.Unknown;
        }

        public static string CountermeasureName(BdaCountermeasureKind kind)
        {
            switch (kind)
            {
                case BdaCountermeasureKind.Chaff:
                    return "chaff";
                case BdaCountermeasureKind.Flare:
                    return "flare";
                case BdaCountermeasureKind.Smoke:
                    return "smoke";
                case BdaCountermeasureKind.Decoy:
                    return "decoy";
                case BdaCountermeasureKind.Bubble:
                    return "bubble";
                default:
                    return "countermeasure";
            }
        }
    }

    /// <summary>One sampled ModuleWeapon state. Positions and directions are body-fixed.</summary>
    public struct GunfireInput
    {
        public string VesselId;
        public string PartId;
        public int ModuleIndex;
        public double Ut;
        public double TimeFired;
        public int RoundsRemaining;
        public double RoundsPerMinute;
        public bool IsReloading;
        public Vec3d PositionBf;
        public Vec3d DirectionBf;
        public string WeaponType;
        public string Ammo;
        public double Caliber;
        public double MuzzleSpeed;
        public string TracerColor;
    }

    /// <summary>A completed gunfire burst, emitted when the weapon stops or turns.</summary>
    public sealed class GunfireBurstSignal
    {
        public string VesselId;
        public string PartId;
        public int ModuleIndex;
        public double StartUt;
        public double EndUt;
        public int Rounds;
        public Vec3d PositionBf;
        public Vec3d DirectionBf;
        public Vec3d EndDirectionBf;
        public double RoundsPerMinute;
        public string WeaponType;
        public string Ammo;
        public double Caliber;
        public double MuzzleSpeed;
        public string TracerColor;
    }

    /// <summary>One sampled CMDropper state. cmCount decreases on each release.</summary>
    public struct CountermeasureInput
    {
        public string VesselId;
        public string PartId;
        public int ModuleIndex;
        public double Ut;
        public int Count;
        public string CountermeasureType;
        public double EjectVelocity;
        public Vec3d PositionBf;
        public Vec3d DirectionBf;
        public Vec3d VesselVelocityBf;
    }

    public sealed class CountermeasureReleaseSignal
    {
        public string VesselId;
        public string PartId;
        public int ModuleIndex;
        public double Ut;
        public double EndUt;
        public int Count;
        public BdaCountermeasureKind Kind;
        public string CountermeasureType;
        public double EjectVelocity;
        public Vec3d PositionBf;
        public Vec3d DirectionBf;
        public Vec3d VelocityBf;
    }

    /// <summary>One sampled MissileBase actor (missile, bomb or rocket).</summary>
    public struct ActorInput
    {
        public string ActorId;
        public string Name;
        public BdaActorClass ActorClass;
        public string Side;
        public string ParentId;
        public string TargetId;
        public string Weapon;
        public string Body;
        public double Lat;
        public double Lon;
        public double Alt;
        public double Ut;
        public bool HasExploded;
        public bool HasMissed;
        public double TntMass;
        public string Warhead;
        public string ExplosionSource;
    }

    public sealed class ActorSpawnSignal
    {
        public string ActorId;
        public string Name;
        public string Kind;
        public string Side;
        public string ParentId;
        public string TargetId;
        public string Weapon;
        public double Ut;
        public BdaActorClass ActorClass;
    }

    public sealed class ActorEndSignal
    {
        public string ActorId;
        public string ParentId;
        public string TargetId;
        public string Weapon;
        public string Body;
        public double Lat;
        public double Lon;
        public double Alt;
        public double Ut;
        public string Reason;
        public BdaActorClass ActorClass;
        public double TntMass;
        public string Warhead;
        public string ExplosionSource;
    }

    public sealed class ActorPollResult
    {
        public readonly List<ActorSpawnSignal> Spawns = new List<ActorSpawnSignal>();
        public readonly List<ActorEndSignal> Ends = new List<ActorEndSignal>();
    }

    public struct HealthInput
    {
        public string VesselId;
        public double Ut;
        public float Health;
    }

    public sealed class HealthDropSignal
    {
        public string VesselId;
        public double Ut;
        public float Before;
        public float After;
        public float Damage;
    }

    public struct CombatAttacker
    {
        public string AttackerId;
        public string Weapon;
        public string ActorId;
        public double Ut;
    }
}
