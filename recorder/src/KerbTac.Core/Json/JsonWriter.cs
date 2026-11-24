using System;
using System.Globalization;
using System.Text;

namespace KerbTac.Core
{
    /// <summary>
    /// Minimal streaming JSON writer. No third-party dependency, invariant
    /// culture, no NaN/Infinity in the output (invalid numbers become null and
    /// set <see cref="HadInvalidNumber"/>).
    /// </summary>
    public sealed class JsonWriter
    {
        private readonly StringBuilder _sb;
        private bool _needComma;

        public JsonWriter(int capacity = 1024)
        {
            _sb = new StringBuilder(capacity);
        }

        /// <summary>True if a non-finite number was written as null.</summary>
        public bool HadInvalidNumber { get; private set; }

        public int Length
        {
            get { return _sb.Length; }
        }

        public JsonWriter BeginObject()
        {
            Separator();
            _sb.Append('{');
            _needComma = false;
            return this;
        }

        public JsonWriter EndObject()
        {
            _sb.Append('}');
            _needComma = true;
            return this;
        }

        public JsonWriter BeginArray()
        {
            Separator();
            _sb.Append('[');
            _needComma = false;
            return this;
        }

        public JsonWriter EndArray()
        {
            _sb.Append(']');
            _needComma = true;
            return this;
        }

        public JsonWriter Name(string name)
        {
            Separator();
            WriteEscaped(name);
            _sb.Append(':');
            _needComma = false;
            return this;
        }

        public JsonWriter Value(string value)
        {
            Separator();
            if (value == null)
            {
                _sb.Append("null");
            }
            else
            {
                WriteEscaped(value);
            }
            _needComma = true;
            return this;
        }

        public JsonWriter Value(double value)
        {
            Separator();
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                HadInvalidNumber = true;
                _sb.Append("null");
            }
            else
            {
                _sb.Append(FormatDouble(value));
            }
            _needComma = true;
            return this;
        }

        public JsonWriter Value(float value)
        {
            return Value((double)value);
        }

        public JsonWriter Value(long value)
        {
            Separator();
            _sb.Append(value.ToString(CultureInfo.InvariantCulture));
            _needComma = true;
            return this;
        }

        public JsonWriter Value(int value)
        {
            return Value((long)value);
        }

        public JsonWriter Value(bool value)
        {
            Separator();
            _sb.Append(value ? "true" : "false");
            _needComma = true;
            return this;
        }

        public JsonWriter Null()
        {
            Separator();
            _sb.Append("null");
            _needComma = true;
            return this;
        }

        public JsonWriter Prop(string name, string value)
        {
            return Name(name).Value(value);
        }

        public JsonWriter Prop(string name, double value)
        {
            return Name(name).Value(value);
        }

        public JsonWriter Prop(string name, int value)
        {
            return Name(name).Value(value);
        }

        public JsonWriter Prop(string name, bool value)
        {
            return Name(name).Value(value);
        }

        public JsonWriter PropNull(string name)
        {
            return Name(name).Null();
        }

        /// <summary>Writes raw pre-serialized JSON without validation.</summary>
        public JsonWriter Raw(string json)
        {
            Separator();
            _sb.Append(json ?? "null");
            _needComma = true;
            return this;
        }

        public override string ToString()
        {
            return _sb.ToString();
        }

        /// <summary>
        /// Formats a double compactly but losslessly: integers as integers,
        /// everything else with 17 significant digits.
        /// </summary>
        public static string FormatDouble(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                return "null";
            }

            if (value == Math.Floor(value) && Math.Abs(value) < 1e15)
            {
                return ((long)value).ToString(CultureInfo.InvariantCulture);
            }

            return value.ToString("G17", CultureInfo.InvariantCulture);
        }

        private void Separator()
        {
            if (_needComma)
            {
                _sb.Append(',');
            }
        }

        private void WriteEscaped(string s)
        {
            _sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': _sb.Append("\\\""); break;
                    case '\\': _sb.Append("\\\\"); break;
                    case '\b': _sb.Append("\\b"); break;
                    case '\f': _sb.Append("\\f"); break;
                    case '\n': _sb.Append("\\n"); break;
                    case '\r': _sb.Append("\\r"); break;
                    case '\t': _sb.Append("\\t"); break;
                    default:
                        if (c < 0x20 || c == '\u2028' || c == '\u2029')
                        {
                            _sb.Append("\\u");
                            _sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            _sb.Append(c);
                        }
                        break;
                }
            }
            _sb.Append('"');
        }
    }
}
