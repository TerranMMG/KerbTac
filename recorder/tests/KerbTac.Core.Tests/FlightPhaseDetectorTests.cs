using System.Collections.Generic;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class FlightPhaseDetectorTests
    {
        private static List<FlightPhaseEvent> Observe(
            FlightPhaseDetector detector,
            string situation,
            double ut,
            double speed = 0,
            double verticalSpeed = 0,
            bool autoStop = false)
        {
            List<FlightPhaseEvent> events = new List<FlightPhaseEvent>();
            detector.Observe(situation, ut, speed, verticalSpeed, autoStop, events);
            return events;
        }

        [Fact]
        public void PrelaunchToFlyingEmitsTakeoff()
        {
            FlightPhaseDetector detector = new FlightPhaseDetector();
            detector.Reset("PRELAUNCH", 0);

            List<FlightPhaseEvent> events = Observe(detector, "FLYING", 10, 82.5, 4.0);

            Assert.Single(events);
            Assert.Equal(EventTypes.Takeoff, events[0].Type);
            Assert.Equal(10, events[0].Ut);
            Assert.Equal(82.5, events[0].Speed, 3);
        }

        [Fact]
        public void LandedToFlyingAlsoCountsAsTakeoff()
        {
            FlightPhaseDetector detector = new FlightPhaseDetector();
            detector.Reset("LANDED", 100);

            List<FlightPhaseEvent> events = Observe(detector, "FLYING", 120, 30, 0);

            Assert.Single(events);
            Assert.Equal(EventTypes.Takeoff, events[0].Type);
        }

        [Fact]
        public void FlyingToLandedEmitsTouchdownAndStoppedAircraftEmitsLanding()
        {
            FlightPhaseDetector detector = new FlightPhaseDetector();
            detector.Reset("FLYING", 0);

            List<FlightPhaseEvent> touchdown = Observe(detector, "LANDED", 50, 55, -2.4);
            Assert.Single(touchdown);
            Assert.Equal(EventTypes.Touchdown, touchdown[0].Type);
            Assert.Equal(-2.4, touchdown[0].VerticalSpeed, 3);
            Assert.Equal(55, touchdown[0].Speed, 3);
            Assert.Equal(50, detector.TouchdownPendingSince, 3);

            List<FlightPhaseEvent> rolling = new List<FlightPhaseEvent>();
            for (int i = 1; i <= 20; i++)
            {
                detector.Observe("LANDED", 50 + i, 5.0, 0, false, rolling);
            }
            Assert.Empty(rolling);

            List<FlightPhaseEvent> landing = Observe(detector, "LANDED", 72, 0.2, 0);
            Assert.Single(landing);
            Assert.Equal(EventTypes.Landing, landing[0].Type);
            Assert.Equal(72, landing[0].Ut);
            Assert.Equal(0.2, landing[0].Speed, 3);

            List<FlightPhaseEvent> again = Observe(detector, "LANDED", 73, 0.1, 0);
            Assert.Empty(again);
        }

        [Fact]
        public void GoAroundClearsPendingLanding()
        {
            FlightPhaseDetector detector = new FlightPhaseDetector();
            detector.Reset("FLYING", 0);
            Observe(detector, "LANDED", 10, 60, -1);

            List<FlightPhaseEvent> airborne = Observe(detector, "FLYING", 12, 60, 3);
            Assert.Single(airborne);
            Assert.Equal(EventTypes.Takeoff, airborne[0].Type);
            Assert.True(detector.TouchdownPendingSince < 0);

            List<FlightPhaseEvent> stopped = Observe(detector, "LANDED", 40, 0.1, 0);
            Assert.Equal(EventTypes.Touchdown, stopped[0].Type);
            Assert.All(stopped, item => Assert.NotEqual(EventTypes.Landing, item.Type));
        }

        [Fact]
        public void AutoStopFiresOnceAfterThirtySecondsStopped()
        {
            FlightPhaseDetector detector = new FlightPhaseDetector();
            detector.Reset("FLYING", 0);
            Observe(detector, "LANDED", 10, 40, -1);

            List<FlightPhaseEvent> events = new List<FlightPhaseEvent>();
            for (int i = 1; i <= 30; i++)
            {
                detector.Observe("LANDED", 10 + i, 0.1, 0, true, events);
            }
            Assert.DoesNotContain(events, item => item.Type == FlightPhaseDetector.AutoStopEvent);

            for (int i = 31; i <= 60; i++)
            {
                detector.Observe("LANDED", 10 + i, 0.1, 0, true, events);
            }

            Assert.Contains(events, item => item.Type == EventTypes.Landing);
            Assert.Single(events, item => item.Type == FlightPhaseDetector.AutoStopEvent);
        }

        [Fact]
        public void AutoStopDisabledProducesNoStop()
        {
            FlightPhaseDetector detector = new FlightPhaseDetector();
            detector.Reset("LANDED", 0);
            List<FlightPhaseEvent> events = new List<FlightPhaseEvent>();
            for (int i = 0; i < 100; i++)
            {
                detector.Observe("LANDED", i, 0, 0, false, events);
            }
            Assert.DoesNotContain(events, item => item.Type == FlightPhaseDetector.AutoStopEvent);
        }

        [Fact]
        public void LandingFiresOnlyAfterMinimumDelay()
        {
            FlightPhaseDetector detector = new FlightPhaseDetector();
            detector.Reset("FLYING", 0);
            Observe(detector, "LANDED", 5, 20, -1);

            List<FlightPhaseEvent> early = Observe(detector, "LANDED", 5.1, 0.1, 0);
            Assert.Empty(early);

            List<FlightPhaseEvent> late = Observe(detector, "LANDED", 5.5, 0.1, 0);
            Assert.Single(late);
            Assert.Equal(EventTypes.Landing, late[0].Type);
        }
    }
}
