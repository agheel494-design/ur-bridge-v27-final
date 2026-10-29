// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Binding Generator: C++ Declarations → Mangled Binding Plan
// Phase 7 — Native Ecosystem Hardening — C++ Bindings
// ─────────────────────────────────────────────────────────────────────────────
//
// Converts the AST produced by cpp-header-parser.ts into a flat list of
// concrete, link-ready bindings: every free function and every PUBLIC
// class method gets its real Itanium-mangled symbol name attached (via
// itanium-mangle.ts), ready for either (a) extern "C" trampoline
// generation when source is available, or (b) direct dlsym() lookup by
// mangled name against an already-compiled shared library — the technique
// needed to bind to precompiled C++ libraries (e.g. OpenCV) without
// requiring their source.
//
// Templates: only EXPLICIT instantiations requested by the caller are
// monomorphized into concrete bindings (no template argument deduction).
// Private/protected members are parsed (for completeness) but never
// produce bindings — only `public` members are exported, matching how a
// real opaque-handle FFI boundary works.
// ─────────────────────────────────────────────────────────────────────────────

import type { CppParseResult, CppClassDecl, CppFunctionDecl, CppMethodDecl, CppParam } from "./cpp-header-parser.js";
import { itaniumMangle, type CppType, type CppFunctionToMangle } from "./itanium-mangle.js";

export type TemplateInstantiationRequest = {
  /** Namespace of the template class, outermost first. */
  namespace: string[];
  /** Name of the template class, e.g. "Box". */
  className: string;
  /** Concrete type arguments, e.g. [{kind:"builtin",name:"int"}] for Box<int>. */
  args: CppType[];
  /** Display label for the instantiation, used in generated names (e.g. "int" -> "Box_int"). */
  label: string;
};

export type BoundFunction = {
  kind: "function";
  namespace: string[];
  name: string;
  params: CppParam[];
  returnType: CppType;
  mangledName: string;
};

export type BoundMethod = {
  kind: "ctor" | "dtor" | "method" | "static-method";
  /** Empty for ctor/dtor. */
  name: string;
  params: CppParam[];
  returnType: CppType;
  isConst: boolean;
  mangledName: string;
};

export type BoundClass = {
  kind: "class";
  namespace: string[];
  className: string;
  /** "Box_int" for an instantiation of Box<int>; equals className for non-templates. */
  bindingName: string;
  isOpaque: boolean;
  templateArgs?: CppType[];
  methods: BoundMethod[];
};

export type BindingPlan = {
  classes: BoundClass[];
  functions: BoundFunction[];
  /** Template classes seen in the input that had no matching instantiation request (informational, not an error). */
  unboundTemplates: string[];
};

function substituteTemplateParam(t: CppType, paramName: string, replacement: CppType): CppType {
  switch (t.kind) {
    case "builtin": return t;
    case "named":
      return t.path.length === 1 && t.path[0] === paramName ? replacement : t;
    case "template-instance":
      return { ...t, args: t.args.map((a) => substituteTemplateParam(a, paramName, replacement)) };
    case "pointer": return { kind: "pointer", pointee: substituteTemplateParam(t.pointee, paramName, replacement) };
    case "reference": return { kind: "reference", pointee: substituteTemplateParam(t.pointee, paramName, replacement) };
    case "const": return { kind: "const", inner: substituteTemplateParam(t.inner, paramName, replacement) };
  }
}

function substituteParams(params: CppParam[], templateParams: string[], args: CppType[]): CppParam[] {
  return params.map((p) => {
    let type = p.type;
    templateParams.forEach((name, i) => { type = substituteTemplateParam(type, name, args[i]!); });
    return { name: p.name, type };
  });
}

function bindFreeFunction(decl: CppFunctionDecl): BoundFunction {
  const toMangle: CppFunctionToMangle = {
    namespace: decl.namespace, classPath: [], name: decl.name,
    params: decl.params.map((p) => p.type),
  };
  return {
    kind: "function", namespace: decl.namespace, name: decl.name,
    params: decl.params, returnType: decl.returnType,
    mangledName: itaniumMangle(toMangle),
  };
}

function bindMethod(
  m: CppMethodDecl,
  namespace: string[],
  classPath: string[],
  classTemplateArgs: CppType[] | undefined,
  paramsOverride?: CppParam[],
  returnTypeOverride?: CppType,
): BoundMethod {
  const params = paramsOverride ?? m.params;
  const returnType = returnTypeOverride ?? m.returnType;
  const toMangle: CppFunctionToMangle = {
    namespace, classPath, classTemplateArgs,
    name: m.name,
    memberKind: m.memberKind === "ctor" ? "ctor" : m.memberKind === "dtor" ? "dtor" : undefined,
    params: params.map((p) => p.type),
    isConst: m.isConst,
  };
  const kind: BoundMethod["kind"] = m.memberKind === "ctor" ? "ctor"
    : m.memberKind === "dtor" ? "dtor"
    : m.isStatic ? "static-method" : "method";
  return {
    kind, name: m.name, params, returnType, isConst: m.isConst,
    mangledName: itaniumMangle(toMangle),
  };
}

function bindClass(decl: CppClassDecl): BoundClass {
  const publicMethods = decl.methods.filter((m) => m.access === "public");
  return {
    kind: "class",
    namespace: decl.namespace,
    className: decl.name,
    bindingName: decl.name,
    isOpaque: decl.isOpaque,
    methods: publicMethods.map((m) => bindMethod(m, decl.namespace, [decl.name], undefined)),
  };
}

function bindTemplateInstantiation(decl: CppClassDecl, req: TemplateInstantiationRequest): BoundClass {
  const publicMethods = decl.methods.filter((m) => m.access === "public");
  return {
    kind: "class",
    namespace: decl.namespace,
    className: decl.name,
    bindingName: `${decl.name}_${req.label}`,
    isOpaque: false,
    templateArgs: req.args,
    methods: publicMethods.map((m) => {
      const params = substituteParams(m.params, decl.templateParams, req.args);
      let returnType = m.returnType;
      decl.templateParams.forEach((name, i) => {
        returnType = substituteTemplateParam(returnType, name, req.args[i]!);
      });
      return bindMethod(m, decl.namespace, [decl.name], req.args, params, returnType);
    }),
  };
}

export function buildBindingPlan(
  parsed: CppParseResult,
  instantiations: TemplateInstantiationRequest[] = [],
): BindingPlan {
  const classes: BoundClass[] = [];
  const functions: BoundFunction[] = [];
  const unboundTemplates: string[] = [];

  for (const decl of parsed.decls) {
    if (decl.declKind === "function") {
      functions.push(bindFreeFunction(decl));
      continue;
    }
    // class
    if (!decl.isTemplate) {
      if (!decl.isOpaque) classes.push(bindClass(decl));
      continue;
    }
    const matching = instantiations.filter(
      (r) => r.className === decl.name && sameNamespace(r.namespace, decl.namespace),
    );
    if (matching.length === 0) {
      unboundTemplates.push(qualifiedName(decl.namespace, decl.name));
      continue;
    }
    for (const req of matching) classes.push(bindTemplateInstantiation(decl, req));
  }

  return { classes, functions, unboundTemplates };
}

function sameNamespace(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function qualifiedName(namespace: string[], name: string): string {
  return [...namespace, name].join("::");
}
