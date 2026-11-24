using System;
using System.Text.Json;
using KerbTac.Core;
using Xunit;

namespace KerbTac.Core.Tests
{
    public class JsonWriterTests
    {
        [Fact]
        public void ProducesParseableObject()
        {
            JsonWriter w = new JsonWriter();
            w.BeginObject()
                .Prop("name", "F-16 \"Viper\"")
                .Prop("count", 3)
                .Prop("ratio", 0.5)
                .Prop("ok", true)
                .Prop("none", (string)null)
                .Name("items").BeginArray().Value(1).Value(2).EndArray()
                .EndObject();

            using JsonDocument doc = JsonDocument.Parse(w.ToString());
            JsonElement root = doc.RootElement;

            Assert.Equal("F-16 \"Viper\"", root.GetProperty("name").GetString());
            Assert.Equal(3, root.GetProperty("count").GetInt32());
            Assert.Equal(0.5, root.GetProperty("ratio").GetDouble());
            Assert.True(root.GetProperty("ok").GetBoolean());
            Assert.Equal(JsonValueKind.Null, root.GetProperty("none").ValueKind);
            Assert.Equal(2, root.GetProperty("items").GetArrayLength());
        }

        [Fact]
        public void EscapesControlCharacters()
        {
            JsonWriter w = new JsonWriter();
            w.BeginArray().Value("a\nb\tc\\d\"e\u0001f").EndArray();

            using JsonDocument doc = JsonDocument.Parse(w.ToString());
            Assert.Equal("a\nb\tc\\d\"e\u0001f", doc.RootElement[0].GetString());
        }

        [Fact]
        public void NonFiniteNumbersBecomeNullAndSetFlag()
        {
            JsonWriter w = new JsonWriter();
            w.BeginArray().Value(double.NaN).Value(double.PositiveInfinity).Value(1.0).EndArray();

            Assert.True(w.HadInvalidNumber);
            using JsonDocument doc = JsonDocument.Parse(w.ToString());
            Assert.Equal(JsonValueKind.Null, doc.RootElement[0].ValueKind);
            Assert.Equal(JsonValueKind.Null, doc.RootElement[1].ValueKind);
            Assert.Equal(1.0, doc.RootElement[2].GetDouble());
        }

        [Fact]
        public void DoubleFormattingIsCompactAndLossless()
        {
            Assert.Equal("0", JsonWriter.FormatDouble(0.0));
            Assert.Equal("-12", JsonWriter.FormatDouble(-12.0));
            Assert.Equal("123456789", JsonWriter.FormatDouble(123456789.0));

            double value = 123456.789012345;
            string text = JsonWriter.FormatDouble(value);
            Assert.Equal(value, double.Parse(text, System.Globalization.CultureInfo.InvariantCulture));
        }
    }
}
