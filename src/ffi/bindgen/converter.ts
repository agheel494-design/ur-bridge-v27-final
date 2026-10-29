// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Binding Generator: C → UR Converter
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
// Converts parsed C AST into AbiModule + generates UR source bindings.

import type {
  AbiType, AbiStructType, AbiEnumType, AbiUnionType,
  AbiFunctionSignature, AbiParam, AbiModule, AbiConstant,
  CallingConvention,
} from "../abi/types.js";
import { CURRENT_ABI_VERSION } from "../abi/types.js";
import { buildStructType, PLATFORM_X64_SYSV, type TargetPlatform } from "../abi/layout.js";
import { mangleC } from "../abi/versioning.js";
import type {
  CDecl, CTypeRef, CStructDecl, CEnumDecl, CFunctionDecl,
  CTypedef, CDefine, CHeader,
} from "./c-header-parser.js";

// ── Type registry (tracks typedef aliases) ─────────────────────────────────

type TypeRegistry = Map<string, AbiType>;

function builtinRegistry(): TypeRegistry {
  const reg: TypeRegistry = new Map();
  const prim = (p: string): AbiType => ({ kind: "primitive", prim: p as any });

  // Standard C typedefs
  const aliases: Record<string, AbiType> = {
    "int":           prim("i32"),
    "long":          prim("i64"),
    "short":         prim("i16"),
    "char":          prim("i8"),
    "float":         prim("f32"),
    "double":        prim("f64"),
    "bool":          prim("bool"),
    "_Bool":         prim("bool"),
    "size_t":        prim("usize"),
    "ptrdiff_t":     prim("isize"),
    "uint8_t":       prim("u8"),
    "uint16_t":      prim("u16"),
    "uint32_t":      prim("u32"),
    "uint64_t":      prim("u64"),
    "int8_t":        prim("i8"),
    "int16_t":       prim("i16"),
    "int32_t":       prim("i32"),
    "int64_t":       prim("i64"),
    "uintptr_t":     prim("usize"),
    "intptr_t":      prim("isize"),
    // Multi-token type specifiers produced by the generalized parseTypeRef
    // specifier-collection rewrite (see c-header-parser.ts). These must
    // match the canonical string names resolveSpecifiers() produces exactly.
    "long long":          prim("i64"),
    "unsigned long long": prim("u64"),
    "unsigned long":      prim("u64"),
    "unsigned int":       prim("u32"),
    "unsigned short":     prim("u16"),
    "unsigned char":      prim("u8"),
    "signed char":        prim("i8"),
    "long double":        prim("f64"), // no native f128; best safe approximation

  };
  for (const [k, v] of Object.entries(aliases)) reg.set(k, v);
  return reg;
}

function resolveType(ref: CTypeRef, registry: TypeRegistry, platform: TargetPlatform): AbiType {
  switch (ref.kind) {
    case "primitive": {
      const map: Record<string, string> = {
        "void": "void", "int": "i32", "long": "i64", "short": "i16",
        "char": "i8", "float": "f32", "double": "f64",
      };
      const p = map[ref.prim] ?? "i32";
      const prim = ref.unsigned && p.startsWith("i") ? "u" + p.slice(1) : p;
      return { kind: "primitive", prim: prim as any };
    }
    case "named": {
      const resolved = registry.get(ref.name);
      if (resolved) return resolved;
      // Unknown type — opaque pointer
      return {
        kind: "struct",
        name: ref.name,
        fields: [],
        sizeBytes: platform.pointerBytes,
        alignBytes: platform.pointerBytes,
        packed: false,
        repr: "C",
      };
    }
    case "pointer": {
      const base = resolveType(ref.base, registry, platform);
      // char* → string (cstr)
      if (base.kind === "primitive" && base.prim === "i8") {
        return { kind: "string", encoding: "cstr" };
      }
      return { kind: "pointer", pointee: base, mutable: !ref.const_, nullable: true };
    }
    case "array": {
      const el = resolveType(ref.base, registry, platform);
      if (ref.size !== null) return { kind: "array", element: el, length: ref.size };
      return { kind: "pointer", pointee: el, mutable: true, nullable: true };
    }
  }
}

// ── Struct converter ───────────────────────────────────────────────────────

function convertStruct(
  decl: CStructDecl,
  registry: TypeRegistry,
  platform: TargetPlatform
): AbiStructType {
  const name = decl.name ?? "__anon";
  const fields = decl.fields.map(f => ({
    name: f.name,
    type: resolveType(f.type, registry, platform),
  }));
  return buildStructType(name, fields, platform);
}

function convertUnion(
  decl: CStructDecl,
  registry: TypeRegistry,
  platform: TargetPlatform
): AbiUnionType {
  const name = decl.name ?? "__anon_union";
  let maxSize = 0, maxAlign = 1;
  const variants = decl.fields.map(f => {
    const t = resolveType(f.type, registry, platform);
    return { name: f.name, type: t, offsetBytes: 0 };
  });
  return { kind: "union", name, variants, sizeBytes: maxSize, alignBytes: maxAlign, repr: "C" };
}

// ── Enum converter ─────────────────────────────────────────────────────────

function convertEnum(decl: CEnumDecl): AbiEnumType {
  let counter = 0;
  const variants = decl.variants.map(v => {
    const val = v.value !== null ? v.value : counter;
    counter = val + 1;
    return { name: v.name, value: val };
  });
  return {
    kind: "enum",
    name: decl.name ?? "__anon_enum",
    discriminantType: "i32",
    variants,
    repr: "C",
  };
}

// ── Function converter ─────────────────────────────────────────────────────

function convertFunction(
  decl: CFunctionDecl,
  registry: TypeRegistry,
  platform: TargetPlatform,
  convention: CallingConvention
): AbiFunctionSignature {
  const params: AbiParam[] = decl.params
    .filter(p => !p.variadic)
    .map((p, i) => ({
      name: p.name ?? `arg${i}`,
      type: resolveType(p.type, registry, platform),
      passBy: "value" as const,
    }));

  return {
    name: decl.name,
    mangledName: mangleC("", decl.name),
    params,
    ret: resolveType(decl.returnType, registry, platform),
    convention,
    noexcept: true,
    deprecated: false,
    since: CURRENT_ABI_VERSION,
  };
}

// ── Main converter ─────────────────────────────────────────────────────────

export type BindgenOptions = {
  moduleName: string;
  platform?: TargetPlatform;
  convention?: CallingConvention;
  filterPrefix?: string; // only include symbols starting with this prefix
};

export type BindgenResult = {
  module: AbiModule;
  warnings: string[];
};

export function convertCHeaderToAbi(
  header: CHeader,
  opts: BindgenOptions
): BindgenResult {
  const platform = opts.platform ?? PLATFORM_X64_SYSV;
  const convention = opts.convention ?? "C";
  const registry = builtinRegistry();
  const warnings: string[] = [];

  const functions: AbiFunctionSignature[] = [];
  const types: AbiType[] = [];
  const constants: AbiConstant[] = [];

  for (const decl of header.decls) {
    try {
      switch (decl.kind) {
        case "struct": {
          const t = decl.kind === "struct"
            ? convertStruct(decl as CStructDecl, registry, platform)
            : convertUnion(decl as CStructDecl, registry, platform);
          registry.set(t.name, t);
          types.push(t);
          break;
        }
        case "union": {
          const t = convertUnion(decl as CStructDecl, registry, platform);
          registry.set(t.name, t);
          types.push(t);
          break;
        }
        case "enum": {
          const t = convertEnum(decl as CEnumDecl);
          registry.set(t.name, t);
          types.push(t);
          break;
        }
        case "typedef": {
          const td = decl as CTypedef;
          if (typeof td.target === "object" && "kind" in td.target) {
            if ((td.target as any).kind === "struct") {
              const s = convertStruct(td.target as CStructDecl, registry, platform);
              const named = { ...s, name: td.alias };
              registry.set(td.alias, named);
              types.push(named);
            } else if ((td.target as any).kind === "union") {
              const u = convertUnion(td.target as CStructDecl, registry, platform);
              const named = { ...u, name: td.alias };
              registry.set(td.alias, named);
              types.push(named);
            } else if ((td.target as any).kind === "enum") {
              const e = convertEnum(td.target as CEnumDecl);
              const named = { ...e, name: td.alias };
              registry.set(td.alias, named);
              types.push(named);
            } else {
              // typedef to a type ref
              const resolved = resolveType(td.target as CTypeRef, registry, platform);
              registry.set(td.alias, resolved);
            }
          }
          break;
        }
        case "function": {
          const fn = decl as CFunctionDecl;
          if (opts.filterPrefix && !fn.name.startsWith(opts.filterPrefix)) break;
          const sig = convertFunction(fn, registry, platform, convention);
          functions.push(sig);
          break;
        }
        case "define": {
          const def = decl as CDefine;
          // Try to parse numeric constants
          const raw = def.value.trim().replace(/[uUlLfF]+$/, "");
          const num = raw.startsWith("0x")
            ? parseInt(raw, 16)
            : raw.startsWith("0b")
            ? parseInt(raw, 2)
            : parseFloat(raw);
          if (!isNaN(num) && isFinite(num)) {
            constants.push({
              name: def.name,
              type: { kind: "primitive", prim: Number.isInteger(num) ? "i32" : "f64" },
              value: num,
              since: CURRENT_ABI_VERSION,
            });
          }
          break;
        }
      }
    } catch (err) {
      warnings.push(`bindgen: skipped '${(decl as any).name ?? "?"}': ${err}`);
    }
  }

  for (const e of header.errors) {
    warnings.push(`parse: line ${e.line}: ${e.message}`);
  }

  return {
    module: {
      name: opts.moduleName,
      version: CURRENT_ABI_VERSION,
      functions,
      types,
      constants,
    },
    warnings,
  };
}
