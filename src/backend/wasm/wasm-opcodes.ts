// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Shared WASM Opcode Constants
// Extracted per TECHNICAL_DEBT_OPCODE_DUPLICATION.md: these 16 constants
// were previously duplicated identically (same name, same value) in both
// emit-wasm.ts and array-memory.ts. Single source of truth from this point
// forward.
// ─────────────────────────────────────────────────────────────────────────────

export const OPCODE_END = 0x0b;
export const OPCODE_GLOBAL_GET = 0x23;
export const OPCODE_GLOBAL_SET = 0x24;
export const OPCODE_I32_ADD = 0x6a;
export const OPCODE_I32_CONST = 0x41;
export const OPCODE_I32_MUL = 0x6c;
export const OPCODE_I32_OR = 0x72;
export const OPCODE_I32_WRAP_I64 = 0xa7;
// v29-D4 (Nested Array Model, first vertical slice): real, standard WASM
// binary opcodes (per the WASM spec's own memory-instruction opcode
// table), needed for array_ref element read/write (a reference is an
// i32 base address, per the ratified Nested Array Reference
// Representation Contract — never the full i64 width the existing
// array-element opcodes below use).
export const OPCODE_I32_LOAD = 0x28;
export const OPCODE_I32_STORE = 0x36;
export const OPCODE_I32_STORE8 = 0x3a;
export const OPCODE_I64_CONST = 0x42;
export const OPCODE_I64_GE_S = 0x59;
export const OPCODE_I64_LOAD = 0x29;
export const OPCODE_I64_LT_S = 0x53;
export const OPCODE_I64_STORE = 0x37;
export const OPCODE_IF = 0x04;
export const OPCODE_LOCAL_SET = 0x21;
export const OPCODE_UNREACHABLE = 0x00;
// V2-M5 (Gate authorized, narrow scope: f64 const/add/sub/mul only).
// Needed by both emit-wasm.ts (encoding) and wasm-cfg-validation.ts
// (SUPPORTED_BINOPS_F64, for validating which f64 ops are accepted) -
// placed here, not locally in either file, for the exact reason this
// file exists at all (see this file's own header comment): avoiding
// duplication and the circular import that would result from
// wasm-cfg-validation.ts importing from emit-wasm.ts (which itself
// imports validation functions FROM wasm-cfg-validation.ts).
export const OPCODE_F64_ADD = 0xa0;
export const OPCODE_F64_SUB = 0xa1;
export const OPCODE_F64_MUL = 0xa2;
export const OPCODE_F64_CONVERT_I64_S = 0xb9;
