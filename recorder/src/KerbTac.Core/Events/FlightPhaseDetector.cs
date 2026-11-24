using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>A phase transition detected from vessel situation and speed.</summary>
    public sealed class FlightPhaseEvent
    {
        public string Type;
        public double Ut;
        public double Speed;
        public double VerticalSpeed;
    }

    /// <summary>
    /// Turns the sampled situation stream into takeoff, touchdown, landing and
    /// auto-stop triggers. Pure logic so it can be unit tested without KSP.
    /// </summary>
    public sealed class FlightPhaseDetector
    {
        /// <summary>Internal trigger for auto-stop; never written to an archive.</summary>
        public const string AutoStopEvent = "auto_stop";

        private const double LandingSpeedThreshold = 0.5;
        private const double LandingMinimumDelay = 0.3;
        private const double AutoStopDelay = 30.0;

        private bool _seeded;
        private string _situation = string.Empty;
        private bool _autoStopEmitted;

        public FlightPhaseDetector()
        {
            TouchdownPendingSince = -1;
            LandedSince = -1;
        }

        public string Situation
        {
            get { return _situation; }
        }

        public double TouchdownPendingSince { get; private set; }

        public double LandedSince { get; private set; }

        /// <summary>Seeds the detector after a recording starts, without events.</summary>
        public void Reset(string situation, double ut)
        {
            _situation = situation ?? string.Empty;
            _seeded = true;
            TouchdownPendingSince = -1;
            LandedSince = -1;
            _autoStopEmitted = false;
        }

        public void Observe(
            string situation,
            double ut,
            double surfaceSpeed,
            double verticalSpeed,
            bool autoStopEnabled,
            List<FlightPhaseEvent> events)
        {
            if (events == null)
            {
                throw new ArgumentNullException("events");
            }

            string current = situation ?? string.Empty;
            if (!_seeded)
            {
                Reset(current, ut);
                return;
            }

            UpdateSituation(current, ut, surfaceSpeed, verticalSpeed, events);
            CheckLanding(current, ut, surfaceSpeed, events);
            CheckAutoStop(current, ut, surfaceSpeed, autoStopEnabled, events);
        }

        private void UpdateSituation(
            string situation,
            double ut,
            double surfaceSpeed,
            double verticalSpeed,
            List<FlightPhaseEvent> events)
        {
            if (situation == _situation)
            {
                return;
            }

            string previous = _situation;
            _situation = situation;

            bool wasAirborneOrGrounded = IsAirborneTransitionSource(previous);
            bool groundedNow = IsGrounded(situation);

            if (situation == "FLYING" && wasAirborneOrGrounded)
            {
                TouchdownPendingSince = -1;
                events.Add(new FlightPhaseEvent
                {
                    Type = EventTypes.Takeoff,
                    Ut = ut,
                    Speed = surfaceSpeed
                });
            }
            else if (groundedNow && previous == "FLYING")
            {
                TouchdownPendingSince = ut;
                LandedSince = ut;
                events.Add(new FlightPhaseEvent
                {
                    Type = EventTypes.Touchdown,
                    Ut = ut,
                    Speed = surfaceSpeed,
                    VerticalSpeed = verticalSpeed
                });
            }
        }

        private void CheckLanding(string situation, double ut, double surfaceSpeed, List<FlightPhaseEvent> events)
        {
            if (TouchdownPendingSince < 0)
            {
                return;
            }
            if (!IsGrounded(situation))
            {
                TouchdownPendingSince = -1;
                return;
            }
            if (surfaceSpeed > LandingSpeedThreshold || ut - TouchdownPendingSince < LandingMinimumDelay)
            {
                return;
            }

            TouchdownPendingSince = -1;
            events.Add(new FlightPhaseEvent
            {
                Type = EventTypes.Landing,
                Ut = ut,
                Speed = surfaceSpeed
            });
        }

        private void CheckAutoStop(
            string situation,
            double ut,
            double surfaceSpeed,
            bool enabled,
            List<FlightPhaseEvent> events)
        {
            bool grounded = IsGrounded(situation);
            if (!grounded || surfaceSpeed > LandingSpeedThreshold)
            {
                LandedSince = -1;
                return;
            }

            if (LandedSince < 0)
            {
                LandedSince = ut;
            }
            else if (enabled && !_autoStopEmitted && ut - LandedSince > AutoStopDelay)
            {
                _autoStopEmitted = true;
                events.Add(new FlightPhaseEvent
                {
                    Type = AutoStopEvent,
                    Ut = ut,
                    Speed = surfaceSpeed
                });
            }
        }

        private static bool IsGrounded(string situation)
        {
            return situation == "LANDED" || situation == "SPLASHED";
        }

        private static bool IsAirborneTransitionSource(string situation)
        {
            return situation == "LANDED" || situation == "SPLASHED" || situation == "PRELAUNCH";
        }
    }
}
