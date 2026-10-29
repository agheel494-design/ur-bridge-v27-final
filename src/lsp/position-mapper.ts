// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: PositionMapper
//
// Bidirectional mapping between:
//   - LSP Position (0-based line + 0-based UTF-16 character)
//   - Absolute byte offset in source text
//
// Rules:
//   - Lines are split on \n (CRLF pairs count \r as part of the line content,
//     matching VS Code behaviour).
//   - Character offsets follow UTF-16 code units (BMP chars = 1 unit,
//     astral chars = 2 units).
// ─────────────────────────────────────────────────────────────────────────────

import type { Position, Range } from "./protocol.js";

export class PositionMapper {
  /** Byte offset of the first character on each line. */
  private readonly lineOffsets: number[];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    this.lineOffsets = PositionMapper.computeLineOffsets(text);
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  private static computeLineOffsets(text: string): number[] {
    const offsets: number[] = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  get lineCount(): number {
    return this.lineOffsets.length;
  }

  /** Convert a 0-based line number to the byte offset of its first char. */
  lineStartOffset(line: number): number {
    if (line < 0) return 0;
    if (line >= this.lineOffsets.length) return this.text.length;
    return this.lineOffsets[line]!;
  }

  /** Convert a 0-based line number to the byte offset just past its last char (exclusive). */
  lineEndOffset(line: number): number {
    if (line < 0) return 0;
    const start = this.lineStartOffset(line);
    const nextStart = this.lineStartOffset(line + 1);
    // Exclude the trailing \n from the "line content" end
    if (nextStart > start && this.text[nextStart - 1] === "\n") {
      return nextStart - 1;
    }
    return nextStart;
  }

  /** Convert an LSP Position to an absolute byte offset. */
  positionToOffset(pos: Position): number {
    const lineStart = this.lineStartOffset(pos.line);
    const lineText = this.text.slice(lineStart, this.lineStartOffset(pos.line + 1));
    let utf16 = 0;
    let byteIdx = 0;
    while (utf16 < pos.character && byteIdx < lineText.length) {
      const cp = lineText.codePointAt(byteIdx)!;
      const utf16Units = cp > 0xffff ? 2 : 1;
      utf16 += utf16Units;
      byteIdx += cp > 0xffff ? 2 : 1;
    }
    return lineStart + byteIdx;
  }

  /** Convert an absolute byte offset to an LSP Position. */
  offsetToPosition(offset: number): Position {
    offset = Math.max(0, Math.min(offset, this.text.length));
    // Binary search for line
    let lo = 0;
    let hi = this.lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineOffsets[mid]! <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const line = lo;
    const lineStart = this.lineOffsets[line]!;
    const lineText = this.text.slice(lineStart, offset);
    // Count UTF-16 code units
    let character = 0;
    for (let i = 0; i < lineText.length; ) {
      const cp = lineText.codePointAt(i)!;
      character += cp > 0xffff ? 2 : 1;
      i += cp > 0xffff ? 2 : 1;
    }
    return { line, character };
  }

  /** Extract the text of a single line (without trailing \n). */
  getLineText(line: number): string {
    return this.text.slice(this.lineStartOffset(line), this.lineEndOffset(line));
  }

  /** Extract source text within a Range. */
  getTextInRange(range: Range): string {
    const start = this.positionToOffset(range.start);
    const end = this.positionToOffset(range.end);
    return this.text.slice(start, end);
  }

  /** Word at a given position (identifier characters). */
  wordAtPosition(pos: Position): { word: string; range: Range } | null {
    const lineText = this.getLineText(pos.line);
    const lineStart = this.lineStartOffset(pos.line);
    const clickOffset = this.positionToOffset(pos) - lineStart;

    const isIdent = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);

    // Cursor must be ON an identifier char or at the trailing edge of one.
    const onIdent = clickOffset < lineText.length && isIdent(lineText[clickOffset]!);
    const afterIdent = clickOffset > 0 && isIdent(lineText[clickOffset - 1]!);
    if (!onIdent && !afterIdent) return null;

    let start = clickOffset;
    while (start > 0 && isIdent(lineText[start - 1]!)) start--;
    let end = clickOffset;
    while (end < lineText.length && isIdent(lineText[end]!)) end++;

    if (start === end) return null;

    const word = lineText.slice(start, end);
    return {
      word,
      range: {
        start: this.offsetToPosition(lineStart + start),
        end: this.offsetToPosition(lineStart + end),
      },
    };
  }

  /** Return the full source text. */
  getText(): string {
    return this.text;
  }
}
