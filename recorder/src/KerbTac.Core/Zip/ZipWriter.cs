using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Text;

namespace KerbTac.Core
{
    /// <summary>
    /// Minimal streaming ZIP writer (PKZIP 2.0, no ZIP64). Supports stored and
    /// deflate entries; falls back to stored when deflate is unavailable.
    /// </summary>
    public sealed class ZipWriter : IDisposable
    {
        private struct EntryRecord
        {
            public string Name;
            public ushort Method;
            public uint Crc;
            public uint CompressedSize;
            public uint UncompressedSize;
            public uint LocalHeaderOffset;
            public ushort DosTime;
            public ushort DosDate;
        }

        private readonly Stream _output;
        private readonly BinaryWriter _writer;
        private readonly List<EntryRecord> _entries = new List<EntryRecord>();
        private readonly bool _allowDeflate;
        private bool _finished;
        private bool _failed;
        private bool _disposed;
        private bool? _streamingDeflate;

        public ZipWriter(Stream output, bool allowDeflate = true)
        {
            if (output == null)
            {
                throw new ArgumentNullException("output");
            }

            _output = output;
            _writer = new BinaryWriter(output, Encoding.UTF8, true);
            _allowDeflate = allowDeflate;
        }

        /// <summary>Number of entries added so far.</summary>
        public int EntryCount
        {
            get { return _entries.Count; }
        }

        public void AddText(string name, string text)
        {
            if (text == null)
            {
                text = string.Empty;
            }
            AddEntry(name, Encoding.UTF8.GetBytes(text));
        }

        public void AddEntry(string name, byte[] data)
        {
            EnsureWritable();
            if (data == null)
            {
                throw new ArgumentNullException("data");
            }
            byte[] payload = data;
            ushort method = 0;

            if (_allowDeflate && data.Length > 64)
            {
                byte[] compressed = TryDeflate(data);
                if (compressed != null && compressed.Length < data.Length)
                {
                    payload = compressed;
                    method = 8;
                }
            }

            EntryRecord record = NewEntry(name, method);
            record.Crc = Crc32.Compute(data);
            record.CompressedSize = (uint)payload.Length;
            record.UncompressedSize = (uint)data.Length;
            _failed = true;
            WriteLocalHeader(record);
            _writer.Write(payload);
            _entries.Add(record);
            _failed = false;
        }

        /// <summary>Writes an entry incrementally, backpatching its sizes and CRC on the seekable ZIP stream.</summary>
        public void AddStreamedEntry(string name, Action<Stream> write)
        {
            EnsureWritable();
            if (write == null) throw new ArgumentNullException("write");
            if (!_output.CanSeek) throw new NotSupportedException("Streamed ZIP entries require seekable output.");

            Stream compressor = null;
            if (_allowDeflate)
            {
                if (!_streamingDeflate.HasValue)
                {
                    // Probe in memory so a missing Mono compression implementation
                    // can't be mistaken for a real write failure on the archive.
                    _streamingDeflate = TryDeflate(new byte[65]) != null;
                }
            }

            EntryRecord record = NewEntry(name, _streamingDeflate == true ? (ushort)8 : (ushort)0);
            _failed = true;
            WriteLocalHeader(record);
            long payloadStart = _output.Position;
            CheckedEntryStream entry;
            try
            {
                if (record.Method == 8) compressor = OpenDeflate(_output);
                entry = new CheckedEntryStream(compressor ?? _output);
                write(entry);
            }
            catch
            {
                // Don't let a secondary compression failure mask the input/write failure.
                try { if (compressor != null) compressor.Dispose(); }
                catch { }
                throw;
            }
            if (compressor != null) compressor.Dispose();

            long end = _output.Position;
            long size = end - payloadStart;
            if (size > uint.MaxValue) throw new NotSupportedException("Entry too large for ZIP32.");
            record.Crc = entry.Crc;
            record.CompressedSize = (uint)size;
            record.UncompressedSize = entry.Count;
            _output.Position = (long)record.LocalHeaderOffset + 14;
            _writer.Write(record.Crc);
            _writer.Write(record.CompressedSize);
            _writer.Write(record.UncompressedSize);
            _output.Position = end;
            _entries.Add(record);
            _failed = false;
        }

        private void EnsureWritable()
        {
            if (_disposed) throw new ObjectDisposedException("ZipWriter");
            if (_finished || _failed)
                throw new InvalidOperationException("ZIP archive is finished or has failed.");
        }

        private EntryRecord NewEntry(string name, ushort method)
        {
            if (string.IsNullOrEmpty(name))
                throw new ArgumentException("Entry name must not be empty.", "name");
            name = name.Replace('\\', '/');
            if (_output.Position > uint.MaxValue || Encoding.UTF8.GetByteCount(name) > ushort.MaxValue)
                throw new NotSupportedException("Archive too large for ZIP32.");
            ushort dosTime;
            ushort dosDate;
            ToDosDateTime(DateTime.UtcNow, out dosTime, out dosDate);

            return new EntryRecord
            {
                Name = name,
                Method = method,
                LocalHeaderOffset = (uint)_output.Position,
                DosTime = dosTime,
                DosDate = dosDate
            };
        }

        private void WriteLocalHeader(EntryRecord record)
        {
            byte[] nameBytes = Encoding.UTF8.GetBytes(record.Name);

            _writer.Write(0x04034b50u);          // local file header signature
            _writer.Write((ushort)20);           // version needed to extract
            _writer.Write((ushort)0x0800);       // flags: UTF-8 names
            _writer.Write(record.Method);
            _writer.Write(record.DosTime);
            _writer.Write(record.DosDate);
            _writer.Write(record.Crc);
            _writer.Write(record.CompressedSize);
            _writer.Write(record.UncompressedSize);
            _writer.Write((ushort)nameBytes.Length);
            _writer.Write((ushort)0);            // extra field length
            _writer.Write(nameBytes);
        }

        /// <summary>Writes the central directory and the end-of-central-directory record.</summary>
        public void Finish()
        {
            if (_finished)
            {
                return;
            }
            EnsureWritable();
            _failed = true;

            long centralStart = _output.Position;

            foreach (EntryRecord entry in _entries)
            {
                byte[] nameBytes = Encoding.UTF8.GetBytes(entry.Name);
                _writer.Write(0x02014b50u);      // central directory signature
                _writer.Write((ushort)20);       // version made by
                _writer.Write((ushort)20);       // version needed
                _writer.Write((ushort)0x0800);   // flags
                _writer.Write(entry.Method);
                _writer.Write(entry.DosTime);
                _writer.Write(entry.DosDate);
                _writer.Write(entry.Crc);
                _writer.Write(entry.CompressedSize);
                _writer.Write(entry.UncompressedSize);
                _writer.Write((ushort)nameBytes.Length);
                _writer.Write((ushort)0);        // extra length
                _writer.Write((ushort)0);        // comment length
                _writer.Write((ushort)0);        // disk number
                _writer.Write((ushort)0);        // internal attributes
                _writer.Write(0u);               // external attributes
                _writer.Write(entry.LocalHeaderOffset);
                _writer.Write(nameBytes);
            }

            long centralSize = _output.Position - centralStart;

            if (_entries.Count > ushort.MaxValue || centralStart > uint.MaxValue || centralSize > uint.MaxValue)
            {
                throw new NotSupportedException("Archive too large for ZIP32.");
            }

            _writer.Write(0x06054b50u);           // EOCD signature
            _writer.Write((ushort)0);             // disk number
            _writer.Write((ushort)0);             // disk with central directory
            _writer.Write((ushort)_entries.Count);
            _writer.Write((ushort)_entries.Count);
            _writer.Write((uint)centralSize);
            _writer.Write((uint)centralStart);
            _writer.Write((ushort)0);             // comment length

            _writer.Flush();
            _finished = true;
        }

        /// <summary>Does not complete the ZIP or own its stream. Call Finish explicitly before publishing.</summary>
        public void Dispose() { _disposed = true; }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static Stream OpenDeflate(Stream output)
        {
            return new DeflateStream(output, CompressionLevel.Optimal, true);
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static byte[] TryDeflate(byte[] data)
        {
            try
            {
                using (MemoryStream buffer = new MemoryStream())
                {
                    using (Stream deflate = OpenDeflate(buffer))
                    {
                        deflate.Write(data, 0, data.Length);
                    }
                    return buffer.ToArray();
                }
            }
            catch
            {
                // Some runtimes ship without System.IO.Compression; stored is valid.
                return null;
            }
        }

        private sealed class CheckedEntryStream : Stream
        {
            private readonly Stream _sink;
            private uint _crc = 0xFFFFFFFFu;
            public uint Count { get; private set; }
            public uint Crc { get { return _crc ^ 0xFFFFFFFFu; } }

            public CheckedEntryStream(Stream sink) { _sink = sink; }

            public override void Write(byte[] buffer, int offset, int count)
            {
                if ((long)Count + count > uint.MaxValue)
                    throw new NotSupportedException("Entry too large for ZIP32.");
                _sink.Write(buffer, offset, count);
                _crc = Crc32.Update(_crc, buffer, offset, count);
                Count += (uint)count;
            }

            public override bool CanRead { get { return false; } }
            public override bool CanSeek { get { return false; } }
            public override bool CanWrite { get { return true; } }
            public override long Length { get { throw new NotSupportedException(); } }
            public override long Position
            {
                get { throw new NotSupportedException(); }
                set { throw new NotSupportedException(); }
            }
            public override void Flush() { _sink.Flush(); }
            public override int Read(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
            public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
            public override void SetLength(long value) { throw new NotSupportedException(); }
        }

        private static void ToDosDateTime(DateTime utc, out ushort time, out ushort date)
        {
            if (utc.Year < 1980)
            {
                utc = new DateTime(1980, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            }
            time = (ushort)((utc.Hour << 11) | (utc.Minute << 5) | (utc.Second / 2));
            date = (ushort)(((utc.Year - 1980) << 9) | (utc.Month << 5) | utc.Day);
        }
    }
}
