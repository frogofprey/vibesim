export const parseHeartRate = (value: DataView): number => {
  // Byte 0: Flags
  // Bit 0: Value Format (0 = UINT8, 1 = UINT16)
  const flags = value.getUint8(0);
  const formatUint16 = (flags & 0x01) === 1;

  let bpm: number;
  let offset = 1; // Start after flags

  if (formatUint16) {
    bpm = value.getUint16(offset, true); // Little Endian
    // offset += 2;
  } else {
    bpm = value.getUint8(offset);
    // offset += 1;
  }

  // We ignore Contact Status, Energy Expended, and RR-Intervals for this MVP
  // but they could be parsed here if needed by checking other bits in `flags`.

  return bpm;
};

export const dataViewToHex = (value: DataView): string => {
  let hex = '';
  for (let i = 0; i < value.byteLength; i++) {
    const byte = value.getUint8(i).toString(16).toUpperCase();
    hex += (byte.length === 1 ? '0' + byte : byte) + ' ';
  }
  return hex.trim();
};