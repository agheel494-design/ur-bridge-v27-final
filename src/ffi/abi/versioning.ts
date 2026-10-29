// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Stable ABI: Versioning + Compatibility Checker
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
// Detects breaking ABI changes between two published AbiModule snapshots.
// A change is breaking if existing compiled code would link incorrectly.

import type {
  AbiModule,
  AbiVersion,
  AbiType,
  AbiFunctionSignature,
  AbiStructType,
  AbiEnumType,
  AbiCompatibility,
  AbiBreakage,
  AbiBreakageKind,
} from "./types.js";

// ── Version comparison ─────────────────────────────────────────────────────

export function abiVersionToString(v: AbiVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export function compareAbiVersion(a: AbiVersion, b: AbiVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

export function isAbiBackwardCompatible(old: AbiVersion, newv: AbiVersion): boolean {
  // Same major = backward compatible (minor/patch only add, never remove)
  return old.major === newv.major && compareAbiVersion(old, newv) <= 0;
}

// ── Type identity (structural equality for ABI purposes) ───────────────────

function typeSignature(t: AbiType): string {
  switch (t.kind) {
    case "primitive":  return t.prim;
    case "pointer":    return `*${t.mutable ? "mut" : "const"} ${typeSignature(t.pointee)}`;
    case "reference":  return `&${t.mutable ? "mut" : ""} ${typeSignature(t.pointee)}`;
    case "fnptr":      return `fn(${t.params.map(typeSignature).join(",")}) -> ${typeSignature(t.ret)}`;
    case "struct":     return `struct:${t.name}@${t.sizeBytes}`;
    case "union":      return `union:${t.name}@${t.sizeBytes}`;
    case "enum":       return `enum:${t.name}:${t.discriminantType}`;
    case "array":      return `[${typeSignature(t.element)};${t.length}]`;
    case "slice":      return `[${typeSignature(t.element)}]`;
    case "string":     return `str:${t.encoding}`;
  }
}

// ── Function compatibility ─────────────────────────────────────────────────

function checkFunction(
  oldFn: AbiFunctionSignature,
  newFn: AbiFunctionSignature,
  breakages: AbiBreakage[]
): void {
  // Return type change
  if (typeSignature(oldFn.ret) !== typeSignature(newFn.ret)) {
    breakages.push({
      kind: "return_type_changed",
      symbol: oldFn.name,
      description: `return type changed: ${typeSignature(oldFn.ret)} → ${typeSignature(newFn.ret)}`,
    });
  }

  // Calling convention change
  if (oldFn.convention !== newFn.convention) {
    breakages.push({
      kind: "calling_convention_changed",
      symbol: oldFn.name,
      description: `calling convention changed: ${oldFn.convention} → ${newFn.convention}`,
    });
  }

  // Parameter changes
  const oldParams = oldFn.params;
  const newParams = newFn.params;

  for (let i = 0; i < oldParams.length; i++) {
    const op = oldParams[i]!;
    const np = newParams[i];
    if (!np) {
      breakages.push({
        kind: "parameter_type_changed",
        symbol: oldFn.name,
        description: `parameter ${i} (${op.name}) removed`,
      });
      continue;
    }
    if (typeSignature(op.type) !== typeSignature(np.type)) {
      breakages.push({
        kind: "parameter_type_changed",
        symbol: oldFn.name,
        description: `parameter ${i} type changed: ${typeSignature(op.type)} → ${typeSignature(np.type)}`,
      });
    }
  }

  if (newParams.length > oldParams.length) {
    breakages.push({
      kind: "parameter_type_changed",
      symbol: oldFn.name,
      description: `${newParams.length - oldParams.length} parameter(s) added — breaks existing callers`,
    });
  }
}

// ── Struct compatibility ───────────────────────────────────────────────────

function checkStruct(
  oldS: AbiStructType,
  newS: AbiStructType,
  breakages: AbiBreakage[]
): void {
  if (oldS.sizeBytes !== newS.sizeBytes) {
    breakages.push({
      kind: "type_layout_changed",
      symbol: oldS.name,
      description: `size changed: ${oldS.sizeBytes} → ${newS.sizeBytes} bytes`,
    });
  }
  if (oldS.alignBytes !== newS.alignBytes) {
    breakages.push({
      kind: "type_layout_changed",
      symbol: oldS.name,
      description: `alignment changed: ${oldS.alignBytes} → ${newS.alignBytes} bytes`,
    });
  }

  // Check existing fields
  for (const oldField of oldS.fields) {
    const newField = newS.fields.find(f => f.name === oldField.name);
    if (!newField) {
      breakages.push({
        kind: "struct_field_removed",
        symbol: `${oldS.name}.${oldField.name}`,
        description: `field removed`,
      });
      continue;
    }
    if (newField.offsetBytes !== oldField.offsetBytes) {
      breakages.push({
        kind: "struct_field_reordered",
        symbol: `${oldS.name}.${oldField.name}`,
        description: `offset changed: ${oldField.offsetBytes} → ${newField.offsetBytes}`,
      });
    }
    if (typeSignature(oldField.type) !== typeSignature(newField.type)) {
      breakages.push({
        kind: "type_layout_changed",
        symbol: `${oldS.name}.${oldField.name}`,
        description: `field type changed`,
      });
    }
  }
}

// ── Enum compatibility ─────────────────────────────────────────────────────

function checkEnum(
  oldE: AbiEnumType,
  newE: AbiEnumType,
  breakages: AbiBreakage[]
): void {
  if (oldE.discriminantType !== newE.discriminantType) {
    breakages.push({
      kind: "enum_discriminant_changed",
      symbol: oldE.name,
      description: `discriminant type changed: ${oldE.discriminantType} → ${newE.discriminantType}`,
    });
  }

  for (const oldVar of oldE.variants) {
    const newVar = newE.variants.find(v => v.name === oldVar.name);
    if (!newVar) {
      breakages.push({
        kind: "enum_variant_removed",
        symbol: `${oldE.name}::${oldVar.name}`,
        description: `variant removed`,
      });
      continue;
    }
    if (oldVar.value !== newVar.value) {
      breakages.push({
        kind: "enum_discriminant_changed",
        symbol: `${oldE.name}::${oldVar.name}`,
        description: `discriminant value changed: ${oldVar.value} → ${newVar.value}`,
      });
    }
  }
}

// ── Main checker ───────────────────────────────────────────────────────────

export function checkAbiCompatibility(
  oldModule: AbiModule,
  newModule: AbiModule
): AbiCompatibility {
  const breakages: AbiBreakage[] = [];

  // Check removed functions
  for (const oldFn of oldModule.functions) {
    const newFn = newModule.functions.find(f => f.mangledName === oldFn.mangledName);
    if (!newFn) {
      breakages.push({
        kind: "function_removed",
        symbol: oldFn.name,
        description: `function '${oldFn.name}' (mangled: ${oldFn.mangledName}) removed from ABI`,
      });
    } else {
      checkFunction(oldFn, newFn, breakages);
    }
  }

  // Check type changes
  for (const oldType of oldModule.types) {
    if (oldType.kind === "struct") {
      const newType = newModule.types.find(
        t => t.kind === "struct" && (t as AbiStructType).name === oldType.name
      );
      if (!newType) {
        breakages.push({ kind: "type_layout_changed", symbol: oldType.name, description: "struct removed" });
      } else {
        checkStruct(oldType, newType as AbiStructType, breakages);
      }
    }
    if (oldType.kind === "enum") {
      const newType = newModule.types.find(
        t => t.kind === "enum" && (t as AbiEnumType).name === oldType.name
      );
      if (!newType) {
        breakages.push({ kind: "enum_variant_removed", symbol: oldType.name, description: "enum removed" });
      } else {
        checkEnum(oldType, newType as AbiEnumType, breakages);
      }
    }
  }

  return breakages.length === 0
    ? { compatible: true }
    : { compatible: false, breaking: breakages };
}

// ── Mangler (C-compatible symbol names) ────────────────────────────────────

export function mangleC(moduleName: string, fnName: string): string {
  // C linkage: just the function name (no mangling)
  return fnName;
}

export function mangleUR(moduleName: string, fnName: string, paramTypes: AbiType[]): string {
  // UR mangling: _UR_<module>_<fn>_<param_sigs>
  const sigs = paramTypes.map(t => typeSignature(t).replace(/[^a-zA-Z0-9]/g, "_")).join("_");
  return `_UR_${moduleName}_${fnName}${sigs ? "_" + sigs : ""}`;
}
