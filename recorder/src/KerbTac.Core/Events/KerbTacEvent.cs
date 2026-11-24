using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>Stable event type strings (see docs/format-v1.md §8.3).</summary>
    public static class EventTypes
    {
        public const string FlightStart = "flight_start";
        public const string FlightEnd = "flight_end";
        public const string Takeoff = "takeoff";
        public const string Touchdown = "touchdown";
        public const string Landing = "landing";
        public const string GearUp = "gear_up";
        public const string GearDown = "gear_down";
        public const string Stage = "stage";
        public const string EngineIgnition = "engine_ignition";
        public const string EngineShutdown = "engine_shutdown";
        public const string EngineModeChange = "engine_mode_change";
        public const string Crash = "crash";
        public const string Destroyed = "destroyed";
        public const string SoiChange = "soi_change";
        public const string SceneExit = "scene_exit";
        public const string Note = "note";

        // Combat events (format revision 2).
        public const string Impact = "impact";
        public const string WeaponRelease = "weapon_release";
        public const string Hit = "hit";
        public const string ProximityDetonation = "proximity_detonation";
        public const string Gunfire = "gunfire";
        public const string Countermeasure = "countermeasure";
        public const string TargetLock = "target_lock";
        public const string Miss = "miss";
        public const string Kill = "kill";
        public const string Chaff = "chaff";
        public const string Flare = "flare";
        public const string Shrapnel = "shrapnel";
        public const string TeamChange = "team_change";
    }

    public enum EventValueKind
    {
        Null,
        String,
        Number,
        Bool
    }

    /// <summary>A small JSON value used inside event "data" objects.</summary>
    public struct JsonValue
    {
        public EventValueKind Kind;
        public string StringValue;
        public double NumberValue;
        public bool BoolValue;

        public static JsonValue Null
        {
            get { return new JsonValue { Kind = EventValueKind.Null }; }
        }

        public static JsonValue Str(string value)
        {
            return new JsonValue { Kind = EventValueKind.String, StringValue = value };
        }

        public static JsonValue Num(double value)
        {
            return new JsonValue { Kind = EventValueKind.Number, NumberValue = value };
        }

        public static JsonValue Bool(bool value)
        {
            return new JsonValue { Kind = EventValueKind.Bool, BoolValue = value };
        }

        public void Write(JsonWriter writer)
        {
            switch (Kind)
            {
                case EventValueKind.String:
                    writer.Value(StringValue);
                    break;
                case EventValueKind.Number:
                    writer.Value(NumberValue);
                    break;
                case EventValueKind.Bool:
                    writer.Value(BoolValue);
                    break;
                default:
                    writer.Null();
                    break;
            }
        }
    }

    public struct EventField
    {
        public string Name;
        public JsonValue Value;

        public EventField(string name, JsonValue value)
        {
            Name = name;
            Value = value;
        }
    }

    /// <summary>One entry of events.json.</summary>
    public sealed class KerbTacEvent
    {
        public double Ut;
        public string Type = EventTypes.Note;
        public string VesselId;
        public string TargetId;
        public string Body;
        public bool HasPosition;
        public double Latitude;
        public double Longitude;
        public double Altitude;
        public List<EventField> Data = new List<EventField>();

        // Optional combat identity fields (format revision 2).
        public string SourceId;
        public string Weapon;
        public string Outcome;
        public string PartId;
        public double Range = -1;
        public double Aspect = -1;
        public double Damage = -1;
        public int EngineIndex = -1;

        public KerbTacEvent WithData(string name, JsonValue value)
        {
            Data.Add(new EventField(name, value));
            return this;
        }

        public KerbTacEvent WithPosition(string body, double lat, double lon, double alt)
        {
            Body = body;
            Latitude = lat;
            Longitude = lon;
            Altitude = alt;
            HasPosition = true;
            return this;
        }

        public KerbTacEvent WithTarget(string targetId)
        {
            TargetId = targetId;
            return this;
        }

        public KerbTacEvent WithSource(string sourceId)
        {
            SourceId = sourceId;
            return this;
        }

        public KerbTacEvent WithWeapon(string weapon)
        {
            Weapon = weapon;
            return this;
        }

        public KerbTacEvent WithOutcome(string outcome)
        {
            Outcome = outcome;
            return this;
        }

        public KerbTacEvent WithRange(double range)
        {
            Range = range;
            return this;
        }

        public KerbTacEvent WithAspect(double aspect)
        {
            Aspect = aspect;
            return this;
        }

        public KerbTacEvent WithDamage(double damage)
        {
            Damage = damage;
            return this;
        }

        public KerbTacEvent WithPart(string partId, int engineIndex = -1)
        {
            PartId = partId;
            EngineIndex = engineIndex;
            return this;
        }
    }
}
