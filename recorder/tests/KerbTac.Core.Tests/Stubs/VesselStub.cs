using System;
using System.Collections.Generic;

namespace KerbTac
{
    // Minimal compile-time stand-in so Core tests can exercise KSP-free BDA
    // adapter code that has a Vessel parameter. The real type comes from
    // Assembly-CSharp inside KSP.
    public class Vessel
    {
        public Guid id = Guid.NewGuid();
        public string vesselName = "test";
        public List<object> parts = new List<object>();
    }
}
