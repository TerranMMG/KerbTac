using System;

namespace KerbTac.Core
{
    /// <summary>CRC-32 (IEEE 802.3) used by the ZIP container.</summary>
    public static class Crc32
    {
        private static readonly uint[] Table = BuildTable();

        private static uint[] BuildTable()
        {
            const uint polynomial = 0xEDB88320u;
            uint[] table = new uint[256];
            for (uint i = 0; i < 256; i++)
            {
                uint c = i;
                for (int k = 0; k < 8; k++)
                {
                    c = (c & 1) != 0 ? polynomial ^ (c >> 1) : c >> 1;
                }
                table[i] = c;
            }
            return table;
        }

        public static uint Compute(byte[] data, int offset, int count)
        {
            return Update(0xFFFFFFFFu, data, offset, count) ^ 0xFFFFFFFFu;
        }

        internal static uint Update(uint crc, byte[] data, int offset, int count)
        {
            for (int i = offset; i < offset + count; i++)
            {
                crc = Table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
            }
            return crc;
        }

        public static uint Compute(byte[] data)
        {
            return Compute(data, 0, data.Length);
        }
    }
}
