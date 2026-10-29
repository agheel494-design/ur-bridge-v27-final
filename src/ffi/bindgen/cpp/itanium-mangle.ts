// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Binding Generator: Itanium C++ ABI Name Mangler
// Phase 7 — Native Ecosystem Hardening — C++ Bindings
// ─────────────────────────────────────────────────────────────────────────────
//
// Implements the subset of the Itanium C++ ABI mangling grammar
// (https://itanium-cxx-abi.github.io/cxx-abi/abi.html#mangling) needed to
// produce link-compatible symbol names for:
//   - free functions (namespaced or not), including overloads
//   - class/struct member functions (including const-qualified)
//   - constructors (`C1`) and destructors (`D1`)
//   - builtin, pointer, reference, and const-qualified parameter types
//   - the Itanium substitution table (`S_`, `S0_`, `S1_`, ...) for repeated
//     namespace/class-qualified names and compound (pointer/reference/const)
//     types
//
// Templates: explicit instantiation only (no template argument deduction,
// no SFINAE/concepts). A "template-instance" type names a concrete
// instantiation, e.g. Box<int> = { path: ["Box"], args: [builtin("int")] }.
// Multiple inheritance, RTTI, and full template support are explicitly out
// of scope for this phase — see ROADMAP_LOCK.md "Phase 7" for the agreed
// scope boundary.
//
// Ground truth: every fixture in tests/ffi/cpp/itanium-mangle.test.ts was
// captured by compiling real C++ with `g++ 13.3.0 -c` and reading the
// mangled symbol names back out with `nm` — not guessed from memory. See
// that file's header comment for the exact reproduction steps.
// ─────────────────────────────────────────────────────────────────────────────

export type CppBuiltin =
  | "void" | "bool"
  | "char" | "signed char" | "unsigned char"
  | "short" | "unsigned short"
  | "int" | "unsigned int"
  | "long" | "unsigned long"
  | "long long" | "unsigned long long"
  | "float" | "double" | "long double";

export type CppType =
  | { kind: "builtin"; name: CppBuiltin }
  | { kind: "named"; path: string[] } // ["Widget"] or ["a","b","Foo"]
  | { kind: "template-instance"; path: string[]; args: CppType[] } // ["Box"]<int> or ["ns1","Wrap"]<int>
  | { kind: "pointer"; pointee: CppType }
  | { kind: "reference"; pointee: CppType }
  | { kind: "const"; inner: CppType };

export type CppMemberKind = "ctor" | "dtor" | "method" | "static-method";

export type CppFunctionToMangle = {
  /** Namespace path, outermost first. Empty for global-scope functions. */
  namespace: string[];
  /** Class path, outermost first (supports nested classes). Empty for free functions. */
  classPath: string[];
  /** If the innermost (last) entry of classPath is a template, its concrete instantiation args, e.g. [int] for Box<int>. */
  classTemplateArgs?: CppType[];
  /** Function or member name. Ignored for ctor/dtor (the special name is derived from memberKind). */
  name: string;
  memberKind?: CppMemberKind; // absent => free function
  params: CppType[];
  isConst?: boolean; // const-qualified member function
};

// ── Builtin type codes ───────────────────────────────────────────────────────

const BUILTIN_CODES: Record<CppBuiltin, string> = {
  "void": "v",
  "bool": "b",
  "char": "c",
  "signed char": "a",
  "unsigned char": "h",
  "short": "s",
  "unsigned short": "t",
  "int": "i",
  "unsigned int": "j",
  "long": "l",
  "unsigned long": "m",
  "long long": "x",
  "unsigned long long": "y",
  "float": "f",
  "double": "d",
  "long double": "e",
};

// ── Substitution table ───────────────────────────────────────────────────────
//
// Per the Itanium spec, every <type> other than a bare builtin-type, and
// every successive prefix of a qualified (namespaced/nested) name, is a
// candidate for back-reference compression. We track candidates with a
// canonical string key (structural, not the mangled bytes) so equal types
// reliably dedupe regardless of how they were reached.

class SubstitutionTable {
  private keys: string[] = [];

  /** Returns the back-reference token (`S_`, `S0_`, ...) if `key` was seen before, else null. */
  find(key: string): string | null {
    const idx = this.keys.indexOf(key);
    if (idx === -1) return null;
    return idx === 0 ? "S_" : `S${idx - 1}_`;
  }

  add(key: string): void {
    // Itanium never stores the exact same component twice — guard defensively
    // even though callers are expected to check `find` first.
    if (!this.keys.includes(key)) this.keys.push(key);
  }
}

function canonicalType(t: CppType): string {
  switch (t.kind) {
    case "builtin": return t.name;
    case "named": return t.path.join("::");
    case "template-instance": return `${t.path.join("::")}<${t.args.map(canonicalType).join(",")}>`;
    case "pointer": return `${canonicalType(t.pointee)}*`;
    case "reference": return `${canonicalType(t.pointee)}&`;
    case "const": return `const ${canonicalType(t.inner)}`;
  }
}

function sourceNameEncode(name: string): string {
  return `${name.length}${name}`;
}

// ── Type mangling ─────────────────────────────────────────────────────────────

type PathSegment = {
  text: string;
  raw?: boolean; // emit literally, no length prefix (ctor/dtor tokens)
  templateArgs?: CppType[]; // segment is a template-id, e.g. "Box" with args=[int] => Box<int>
};

function mangleQualifiedPath(
  ctx: SubstitutionTable,
  segments: PathSegment[],
  registerLast = true,
): string {
  // Encodes a multi-component qualified name's *interior* (without the
  // surrounding N...E) with incremental substitution: each successive
  // prefix (not just the whole path) is checked against — and added to —
  // the substitution table independently. `raw` segments (ctor/dtor's
  // special "C1"/"D1" tokens) are emitted literally instead of as a
  // length-prefixed <source-name>, per the <ctor-dtor-name> grammar
  // production.
  //
  // `registerLast=false` is used when `segments` is a class/namespace
  // <prefix> chain followed by the function/member's own name: per the
  // Itanium grammar, <nested-name> = N <prefix> <unqualified-name> E —
  // only the <prefix> portion (the qualifiers *before* the function name)
  // is independently substitutable; the function name itself, combined
  // with its prefix, is not registered as a new back-reference candidate.
  // (Verified empirically: g++ on `a::b::Foo::m(a::b::Foo&, a::b::Foo&)`
  // assigns the *class* prefixes indices 0–2 and skips one index for "m"
  // before registering the reference-to-Foo compound type.)
  //
  // A `templateArgs` segment (e.g. "Box<int>") has TWO independent
  // substitution candidates: the bare template name ("Box", qualified by
  // whatever namespace precedes it) and the fully-instantiated form
  // ("Box<int>"). Verified empirically: in `mixedBox(Box<int>&,
  // Box<double>&)`, the second param reuses "Box" as a backreference
  // (since Box<int> already registered it) but still spells out `IdE` for
  // the new `<double>` argument: `RS_IdE`, not a full backreference.
  let code = "";
  let cumulativeKey = "";

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isLast = i === segments.length - 1;

    if (seg.templateArgs) {
      const bareKey = cumulativeKey === "" ? seg.text : `${cumulativeKey}::${seg.text}`;
      const bareSub = ctx.find(bareKey);
      const prefixCode = bareSub !== null ? bareSub : sourceNameEncode(seg.text);
      if (bareSub === null) ctx.add(bareKey);

      const fullKey = `${bareKey}<${seg.templateArgs.map(canonicalType).join(",")}>`;
      const fullSub = ctx.find(fullKey);
      if (fullSub !== null) {
        code = fullSub; // whole template-id collapses to a backreference
      } else {
        const argsCode = "I" + seg.templateArgs.map((a) => mangleType(ctx, a)).join("") + "E";
        code += prefixCode + argsCode;
        if (!isLast || registerLast) ctx.add(fullKey);
      }
      cumulativeKey = fullKey;
      continue;
    }

    cumulativeKey = cumulativeKey === "" ? seg.text : `${cumulativeKey}::${seg.text}`;
    const sub = ctx.find(cumulativeKey);
    if (sub !== null) {
      // A backreference replaces everything accumulated up to (and
      // including) this component; continue extending from here.
      code = sub;
      continue;
    }
    code += seg.raw ? seg.text : sourceNameEncode(seg.text);
    if (!isLast || registerLast) ctx.add(cumulativeKey);
  }

  return code;
}

function mangleType(ctx: SubstitutionTable, t: CppType): string {
  if (t.kind === "builtin") {
    // Bare builtin types are never substitutable on their own.
    return BUILTIN_CODES[t.name];
  }

  const key = canonicalType(t);
  const sub = ctx.find(key);
  if (sub !== null) return sub;

  let code: string;
  switch (t.kind) {
    case "named": {
      code = t.path.length === 1
        ? sourceNameEncode(t.path[0]!)
        : `N${mangleQualifiedPath(ctx, t.path.map((text) => ({ text })))}E`;
      // mangleQualifiedPath already registers every intermediate prefix,
      // including the full path (== `key`), so for the multi-component
      // case the table entry for `key` already exists — adding again is a
      // no-op thanks to SubstitutionTable.add's dedupe guard. For the
      // single-component case we still need to register it explicitly.
      if (t.path.length === 1) ctx.add(key);
      return code;
    }
    case "template-instance": {
      const segments: PathSegment[] = t.path.map((text, i) =>
        i === t.path.length - 1 ? { text, templateArgs: t.args } : { text }
      );
      code = t.path.length === 1
        ? mangleQualifiedPath(ctx, segments) // single segment still goes through the templateArgs branch, no N...E needed
        : `N${mangleQualifiedPath(ctx, segments)}E`;
      return code;
    }
    case "pointer":
      code = "P" + mangleType(ctx, t.pointee);
      break;
    case "reference":
      code = "R" + mangleType(ctx, t.pointee);
      break;
    case "const":
      code = "K" + mangleType(ctx, t.inner);
      break;
  }

  ctx.add(key);
  return code;
}

// ── Function mangling ─────────────────────────────────────────────────────────

/**
 * Mangle a single function/method into its Itanium-ABI link symbol.
 *
 * One `SubstitutionTable` is scoped per mangled name (substitution never
 * crosses symbols), matching the real ABI.
 */
export function itaniumMangle(fn: CppFunctionToMangle): string {
  const ctx = new SubstitutionTable();
  const qualPath = [...fn.namespace, ...fn.classPath];

  let nameEncoding: string;

  if (qualPath.length === 0) {
    // Plain free function at global scope: <unscoped-name>, no N...E wrapper.
    if (fn.memberKind === "ctor" || fn.memberKind === "dtor") {
      throw new Error("itaniumMangle: ctor/dtor requires a classPath");
    }
    nameEncoding = sourceNameEncode(fn.name);
  } else {
    const lastClassIdx = fn.namespace.length + fn.classPath.length - 1;
    const qualSegments: PathSegment[] = qualPath.map((text, i) =>
      fn.classTemplateArgs && i === lastClassIdx ? { text, templateArgs: fn.classTemplateArgs } : { text }
    );
    const segments: PathSegment[] = [...qualSegments, memberNameSegment(fn)];
    const cvPrefix = fn.isConst ? "K" : "";
    const inner = mangleQualifiedPath(ctx, segments, /* registerLast */ false);
    nameEncoding = `N${cvPrefix}${inner}E`;
  }

  const paramsEncoding = fn.params.length === 0
    ? "v"
    : fn.params.map((p) => mangleType(ctx, p)).join("");

  return `_Z${nameEncoding}${paramsEncoding}`;
}

function memberNameSegment(fn: CppFunctionToMangle): PathSegment {
  if (fn.memberKind === "ctor") return { text: "C1", raw: true }; // complete-object constructor
  if (fn.memberKind === "dtor") return { text: "D1", raw: true }; // complete-object destructor
  return { text: fn.name };
}

/** Convenience: free function, no namespace, no class. */
export function mangleFreeFunction(name: string, params: CppType[]): string {
  return itaniumMangle({ namespace: [], classPath: [], name, params });
}
