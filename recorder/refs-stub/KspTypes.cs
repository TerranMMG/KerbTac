// Compile-only KSP 1.12.5 API stubs. See Stubs.cs for the warning.

using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public enum VesselType
{
    Debris,
    Probe,
    Rover,
    Lander,
    Ship,
    Plane,
    Station,
    Relay,
    Base,
    EVA,
    Flag,
    SpaceObject,
    Unknown
}

public enum GameScenes
{
    MAINMENU,
    SETTINGS,
    CREDITS,
    SPACECENTER,
    EDITOR,
    FLIGHT,
    TRACKSTATION,
    PSSC,
    LOADING,
    DATABASE
}

public enum KSPActionGroup
{
    None,
    Brakes,
    Gear,
    Light,
    RCS,
    SAS,
    Custom01,
    Custom02,
    Custom03,
    Custom04,
    Custom05,
    Custom06,
    Custom07,
    Custom08,
    Custom09,
    Custom10
}

public class ActionGroupList
{
    private readonly Dictionary<KSPActionGroup, bool> _states = new Dictionary<KSPActionGroup, bool>();

    public bool this[KSPActionGroup group]
    {
        get { bool state; return _states.TryGetValue(group, out state) && state; }
        set { _states[group] = value; }
    }
}

public class VesselCtrlState
{
    public float mainThrottle;
    public float pitch;
    public float roll;
    public float yaw;
}

public class PartInfo
{
    public string name;
    public string title;
}

public class PartResource
{
    public string resourceName;
    public double amount;
    public double maxAmount;
}

public class PartResourceList : IEnumerable<PartResource>
{
    private readonly List<PartResource> _items = new List<PartResource>();

    public int Count { get { return _items.Count; } }
    public PartResource this[int index] { get { return _items[index]; } }
    public IEnumerator<PartResource> GetEnumerator() { return _items.GetEnumerator(); }
    IEnumerator IEnumerable.GetEnumerator() { return _items.GetEnumerator(); }
}

public class PartModule
{
    public Part part;
    public string moduleName;
}

public class PartModuleList : IEnumerable<PartModule>
{
    private readonly List<PartModule> _items = new List<PartModule>();

    public int Count { get { return _items.Count; } }
    public PartModule this[int index] { get { return _items[index]; } }
    public void Add(PartModule module) { _items.Add(module); }
    public IEnumerator<PartModule> GetEnumerator() { return _items.GetEnumerator(); }
    IEnumerator IEnumerable.GetEnumerator() { return _items.GetEnumerator(); }
}

public class Part : MonoBehaviour
{
    public PartInfo partInfo;
    public PartResourceList Resources = new PartResourceList();
    public PartModuleList Modules = new PartModuleList();
    public string partName;
    public Guid flightID;
    public Vessel vessel;
}

public class Orbit
{
    public double semiMajorAxis;
    public Vector3d getRelativePositionAtUT(double ut) => new Vector3d(semiMajorAxis, 0, 0);
    public double eccentricity;
    public double inclination;
    public double LAN;
    public double argumentOfPeriapsis;
    public double meanAnomalyAtEpoch;
    public double epoch;
    public CelestialBody referenceBody;
}

public class CelestialBody : MonoBehaviour
{
    public string bodyName;
    public double Radius;
    public double GeeASL;
    public double gravParameter;
    public double atmosphereDepth;
    public double sphereOfInfluence;
    public double rotationPeriod;
    public double initialRotation;
    public double rotationAngle;
    public bool rotates;
    public Vector3d position;
    public Transform bodyTransform;
    public Orbit orbit;
}

public class Vessel : MonoBehaviour
{
    public enum Situations
    {
        PRELAUNCH,
        LANDED,
        SPLASHED,
        FLYING,
        SUB_ORBITAL,
        ORBITING,
        ESCAPING,
        DOCKED
    }

    public Guid id;
    public string vesselName;
    public VesselType vesselType;
    public CelestialBody mainBody;
    public Part rootPart;
    public double latitude;
    public double longitude;
    public double altitude;
    public double srfSpeed;
    public double verticalSpeed;
    public double geeForce;
    public double indicatedAirSpeed;
    public double mach;
    public double angleOfAttack;
    public double sideslipAngle;
    public double radarAltitude;
    public double dynamicPressurekPa;
    public double launchTime;
    public float mass;
    public Vector3d srf_velocity;
    public Situations situation;
    public string landedAt = "";
    public bool loaded;
    public bool packed;
    public int currentStage;
    public Orbit orbit;
    public Quaternion srfRelRotation = Quaternion.identity;
    public VesselCtrlState ctrlState = new VesselCtrlState();
    public List<Part> parts = new List<Part>();
    public UnityEngine.Transform ReferenceTransform { get; set; }
    public ActionGroupList ActionGroups { get; set; } = new ActionGroupList();

    public int GetCrewCount() { return 0; }
    public float GetTotalMass() { return 0f; }
}

public class EventReport
{
    public Part origin;
    public string msg;
}

public static class FlightGlobals
{
    public static Vessel ActiveVessel { get; set; }
    public static List<Vessel> Vessels = new List<Vessel>();
    public static List<Vessel> VesselsLoaded { get; set; } = new List<Vessel>();
    public static List<CelestialBody> Bodies { get; set; }
}

public class TimeWarp
{
    public enum Modes { HIGH, LOW }
    public static double CurrentRate = 1.0;
    public static TimeWarp fetch = new TimeWarp();
    public static Modes WarpMode = Modes.HIGH;
}

public static class Planetarium
{
    public static double UniversalTime { get; set; }
    public static double GetUniversalTime() { return UniversalTime; }
}

public static class HighLogic
{
    public static string SaveFolder { get; set; }
    public static bool LoadedSceneIsFlight { get; set; }
}

public class ConfigNode
{
    public ConfigNode() { }
    public ConfigNode(string name) { }
    public static ConfigNode Load(string fileFullName) { return null; }
    public static ConfigNode New(string name) { return new ConfigNode(); }
    public ConfigNode GetNode(string name) { return null; }
    public void AddValue(string key, string value) { }
    public string GetValue(string key) { return null; }
    public bool SetValue(string key, string value) { return true; }
    public bool HasValue(string key) { return false; }
    public bool Save(string fileFullName) { return true; }
}
