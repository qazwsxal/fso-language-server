/**
 * Small bounds-checked little-endian cursor reader for POF binary data.
 * Never throws on out-of-range reads for variable-length data (strings) — callers get
 * `null` back so a single wrong guess about a chunk's field layout degrades to
 * "unknown name" for that entry instead of corrupting the whole parse.
 */
export class BinaryReader {
  private offset: number;

  constructor(
    private readonly buffer: Buffer,
    offset = 0,
  ) {
    this.offset = offset;
  }

  get position(): number {
    return this.offset;
  }

  set position(value: number) {
    this.offset = value;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  canRead(bytes: number): boolean {
    return this.offset + bytes <= this.buffer.length;
  }

  skip(bytes: number): void {
    this.offset += bytes;
  }

  readInt32(): number {
    const v = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readUInt32(): number {
    const v = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readFloat(): number {
    const v = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return v;
  }

  /** Skips a 3-float (12 byte) vector without decoding it - geometry isn't needed for name/reference extraction. */
  skipVector(): void {
    this.offset += 12;
  }

  /** Reads a 3-float (12 byte) vector, for the handful of chunks where the actual coordinates are useful. */
  readVector(): { x: number; y: number; z: number } {
    return { x: this.readFloat(), y: this.readFloat(), z: this.readFloat() };
  }

  /**
   * Returns a zero-copy view (Buffer#subarray, not a copy) of `length` raw bytes at the
   * current position, advancing past them. Returns null (without advancing) if out of
   * bounds - same "degrade rather than throw" contract as readString().
   */
  readRawBytes(length: number): Buffer | null {
    if (length < 0 || !this.canRead(length)) {
      return null;
    }
    const v = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return v;
  }

  readFixedChars(length: number): string {
    const v = this.buffer.toString("ascii", this.offset, this.offset + length);
    this.offset += length;
    return v;
  }

  /**
   * int32 length-prefixed string. Returns null (without throwing) if the length looks
   * invalid, rewinding to the position before the call so callers can treat "no valid
   * string here" as "nothing consumed" rather than an unrecoverable partial read.
   */
  readString(): string | null {
    const start = this.offset;
    if (!this.canRead(4)) {
      return null;
    }
    const len = this.readInt32();
    if (len < 0 || len > this.remaining) {
      this.offset = start;
      return null;
    }
    const raw = this.buffer.toString("utf8", this.offset, this.offset + len);
    this.offset += len;
    // POF strings are typically NUL-terminated within their length-prefixed span.
    const nulIdx = raw.indexOf("\0");
    return nulIdx === -1 ? raw : raw.slice(0, nulIdx);
  }
}
