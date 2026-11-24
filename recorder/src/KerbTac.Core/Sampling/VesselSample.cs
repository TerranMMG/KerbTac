namespace KerbTac.Core
{
    /// <summary>One telemetry sample of a vessel, in body-fixed coordinates.</summary>
    public struct VesselSample
    {
        /// <summary>
        /// Position-only keyframe used for unloaded and high-warp vessels.
        /// Optional telemetry stays at its default so the archive carries null
        /// columns instead of invented zero telemetry.
        /// </summary>
        public static VesselSample PositionOnly(
            double t,
            double latDeg,
            double lonDeg,
            double altM,
            Quatd attitude,
            string situation)
        {
            return new VesselSample
            {
                T = t,
                Latitude = latDeg,
                Longitude = lonDeg,
                Altitude = altM,
                Attitude = attitude,
                Situation = situation,
            };
        }

        public double T;              // UT seconds
        public double Latitude;       // degrees, north positive
        public double Longitude;      // degrees, east positive
        public double Altitude;       // meters above sea level
        public Quatd Attitude;        // model (+Z forward, +Y up) -> body-fixed
        public double? VelocityX;     // body-fixed m/s
        public double? VelocityY;
        public double? VelocityZ;
        public float? Throttle;       // 0..1
        public double? Mass;          // kg
        public double? GeeForce;      // g
        public int? Stage;
        public string Situation;      // Vessel.Situations name
        public double? Heading;       // degrees, 0 = north, 90 = east
        public double? VerticalSpeed; // m/s
        public double? SurfaceSpeed;  // m/s
        public double? LiquidFuel;
        public double? Oxidizer;
        public double? ElectricCharge;
        public double? MonoPropellant;

        // Null means not collected; zero is a measurement.
        public double? Ias;           // m/s indicated air speed
        public double? Mach;
        public double? Aoa;           // degrees
        public double? Aos;           // degrees
        public double? Agl;           // meters above ground
        public double? DynPressure;   // kPa
        public double? PitchInput;    // -1..1
        public double? RollInput;     // -1..1
        public double? YawInput;      // -1..1
        public double? Gear;          // 0/1
        public double? Flaps;         // 0..1
        public double? Brakes;        // 0/1
        public double? Health;        // 0..1
    }
}
