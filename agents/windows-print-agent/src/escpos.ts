export interface EscPosInspection {
  widthPixels: number;
  heightPixels: number;
  rasterBytes: number;
  hasCut: boolean;
}

function matches(bytes: Uint8Array, offset: number, expected: readonly number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function inspectEscPos(bytes: Uint8Array): EscPosInspection {
  if (bytes.length < 19) throw new Error("escpos_too_short");
  if (!matches(bytes, 0, [0x1b, 0x40])) throw new Error("escpos_missing_initialize");
  if (!matches(bytes, 2, [0x1b, 0x61, 0x01])) throw new Error("escpos_missing_center_alignment");
  if (!matches(bytes, 5, [0x1d, 0x76, 0x30, 0x00])) throw new Error("escpos_missing_raster_command");

  const widthBytes = bytes[9]! + (bytes[10]! << 8);
  const heightPixels = bytes[11]! + (bytes[12]! << 8);
  const rasterBytes = widthBytes * heightPixels;
  if (widthBytes === 0 || heightPixels === 0) throw new Error("escpos_empty_raster");

  const suffixOffset = 13 + rasterBytes;
  if (bytes.length !== suffixOffset + 6) throw new Error("escpos_invalid_raster_length");
  if (!matches(bytes, suffixOffset, [0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00])) {
    throw new Error("escpos_missing_feed_or_cut");
  }

  return { widthPixels: widthBytes * 8, heightPixels, rasterBytes, hasCut: true };
}
