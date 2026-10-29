// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Binding Generator: C++ Header Parser
// Phase 7 — Native Ecosystem Hardening — C++ Bindings
// ─────────────────────────────────────────────────────────────────────────────
//
// Parses a pragmatic subset of C++ headers, scoped per ROADMAP_LOCK.md
// "Phase 7": namespaces (full), classes (basic, single translation-unit
// flat layout, no inheritance), constructors/destructors, methods
// (including const-qualified, static, and overloaded), and class
// templates (declaration only — concrete bindings require an explicit
// instantiation request fed to the converter, see cpp-converter.ts).
//
// Explicitly NOT supported (will either be skipped or reported as a
// parse error, never silently mis-parsed): inheritance (single or
// multiple), RTTI, operator overloading, SFINAE/concepts, non-type
// template parameters, variadic templates, lambdas, nested
// function-pointer types, and preprocessor conditionals (same limitation
// as the C header parser).
// ─────────────────────────────────────────────────────────────────────────────

import type { CppType, CppBuiltin } from "./itanium-mangle.js";

// ── Token types ────────────────────────────────────────────────────────────

export type CppTokenKind =
  | "ident" | "number" | "string"
  | "lparen" | "rparen" | "lbrace" | "rbrace"
  | "lt" | "gt" // < > (templates)
  | "semi" | "comma" | "colon" | "coloncolon"
  | "star" | "amp" | "tilde"
  | "kw_namespace" | "kw_class" | "kw_struct" | "kw_public" | "kw_private" | "kw_protected"
  | "kw_const" | "kw_static" | "kw_virtual" | "kw_explicit" | "kw_inline" | "kw_friend"
  | "kw_template" | "kw_typename"
  | "kw_unsigned" | "kw_signed" | "kw_void" | "kw_bool"
  | "kw_short" | "kw_int" | "kw_long" | "kw_char" | "kw_float" | "kw_double"
  | "eof";

export type CppToken = { kind: CppTokenKind; text: string; line: number; col: number };

const KEYWORDS: Record<string, CppTokenKind> = {
  namespace: "kw_namespace", class: "kw_class", struct: "kw_struct",
  public: "kw_public", private: "kw_private", protected: "kw_protected",
  const: "kw_const", static: "kw_static", virtual: "kw_virtual",
  explicit: "kw_explicit", inline: "kw_inline", friend: "kw_friend",
  template: "kw_template", typename: "kw_typename",
  unsigned: "kw_unsigned", signed: "kw_signed", void: "kw_void", bool: "kw_bool",
  short: "kw_short", int: "kw_int", long: "kw_long", char: "kw_char",
  float: "kw_float", double: "kw_double",
};

export function tokenizeCppHeader(src: string): CppToken[] {
  const tokens: CppToken[] = [];
  let i = 0, line = 1, lineStart = 0;
  const col = () => i - lineStart + 1;
  const peek = (n = 0) => src[i + n] ?? "";
  const advance = () => { const c = src[i++]!; if (c === "\n") { line++; lineStart = i; } return c; };

  while (i < src.length) {
    const c = peek();
    if (/\s/.test(c)) { advance(); continue; }
    if (c === "/" && peek(1) === "/") { while (i < src.length && peek() !== "\n") advance(); continue; }
    if (c === "/" && peek(1) === "*") {
      advance(); advance();
      while (i < src.length && !(peek() === "*" && peek(1) === "/")) advance();
      if (i < src.length) { advance(); advance(); }
      continue;
    }
    if (c === "#") { while (i < src.length && peek() !== "\n") advance(); continue; } // skip preprocessor lines

    const l = line, cl = col();

    if (/[A-Za-z_]/.test(c)) {
      let text = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(peek())) text += advance();
      tokens.push({ kind: KEYWORDS[text] ?? "ident", text, line: l, col: cl });
      continue;
    }
    if (/[0-9]/.test(c)) {
      let text = "";
      while (i < src.length && /[0-9.]/.test(peek())) text += advance();
      tokens.push({ kind: "number", text, line: l, col: cl });
      continue;
    }
    if (c === '"') {
      advance();
      let text = "";
      while (i < src.length && peek() !== '"') text += advance();
      if (i < src.length) advance();
      tokens.push({ kind: "string", text, line: l, col: cl });
      continue;
    }
    if (c === ":" && peek(1) === ":") { advance(); advance(); tokens.push({ kind: "coloncolon", text: "::", line: l, col: cl }); continue; }

    const single: Record<string, CppTokenKind> = {
      "(": "lparen", ")": "rparen", "{": "lbrace", "}": "rbrace",
      "<": "lt", ">": "gt", ";": "semi", ",": "comma", ":": "colon",
      "*": "star", "&": "amp", "~": "tilde",
    };
    if (single[c]) { advance(); tokens.push({ kind: single[c]!, text: c, line: l, col: cl }); continue; }

    // Unknown character (e.g. stray punctuation) — skip it; the parser
    // reports a structural error if this leaves something unparseable.
    advance();
  }

  tokens.push({ kind: "eof", text: "", line, col: col() });
  return tokens;
}

// ── AST types ────────────────────────────────────────────────────────────

export type CppAccess = "public" | "private" | "protected";
export type CppParam = { name: string; type: CppType };

export type CppMethodDecl = {
  declKind: "method";
  memberKind: "ctor" | "dtor" | "method";
  name: string; // "" for ctor/dtor
  params: CppParam[];
  returnType: CppType; // void for ctor/dtor
  isConst: boolean;
  isStatic: boolean;
  access: CppAccess;
};

export type CppClassDecl = {
  declKind: "class";
  name: string;
  namespace: string[];
  isOpaque: boolean; // forward-declared only (no body)
  isTemplate: boolean;
  templateParams: string[]; // e.g. ["T"]
  methods: CppMethodDecl[];
};

export type CppFunctionDecl = {
  declKind: "function";
  name: string;
  namespace: string[];
  params: CppParam[];
  returnType: CppType;
};

export type CppTopDecl = CppClassDecl | CppFunctionDecl;

export type CppParseError = { message: string; line: number; col: number };
export type CppParseResult = { decls: CppTopDecl[]; errors: CppParseError[] };

// ── Parser ───────────────────────────────────────────────────────────────

const BUILTIN_KEYWORD_TO_NAME: Partial<Record<CppTokenKind, string>> = {
  kw_void: "void", kw_bool: "bool", kw_char: "char",
  kw_short: "short", kw_int: "int", kw_long: "long",
  kw_float: "float", kw_double: "double",
};

export function parseCppHeader(src: string): CppParseResult {
  const tokens = tokenizeCppHeader(src);
  let pos = 0;
  const errors: CppParseError[] = [];

  const peek = (n = 0) => tokens[pos + n] ?? tokens[tokens.length - 1]!;
  const at = (k: CppTokenKind) => peek().kind === k;
  const advance = () => tokens[pos++]!;
  function expect(k: CppTokenKind, ctx: string): CppToken {
    if (!at(k)) {
      const t = peek();
      errors.push({ message: `expected ${k} ${ctx}, got ${t.kind} '${t.text}'`, line: t.line, col: t.col });
      return t; // best-effort: don't consume, let caller's loop re-sync
    }
    return advance();
  }

  function skipToRecoveryPoint(): void {
    // Panic-mode recovery: skip tokens until a statement/decl boundary.
    while (!at("semi") && !at("rbrace") && !at("eof")) advance();
    if (at("semi") || at("rbrace")) advance();
  }

  // ── Type parsing ──────────────────────────────────────────────────────
  // Parses a (possibly qualified/pointer/reference/const) type name, e.g.
  // "const char*", "Widget&", "ns1::ns2::Deep*", "unsigned long".

  function parseBaseType(): CppType {
    let isConst = false;
    while (at("kw_const")) { advance(); isConst = true; }

    let base: CppType;
    if (at("kw_unsigned") || at("kw_signed")) {
      const signedness = advance().kind; // kw_unsigned | kw_signed
      let width: CppBuiltin = "int";
      if (at("kw_char")) { advance(); width = "char"; }
      else if (at("kw_short")) { advance(); width = "short"; }
      else if (at("kw_long")) {
        advance();
        width = at("kw_long") ? (advance(), "long long") : "long";
      } else if (at("kw_int")) { advance(); width = "int"; }
      const name: CppBuiltin = signedness === "kw_unsigned"
        ? (`unsigned ${width}` as CppBuiltin)
        : (width === "char" ? "signed char" : width);
      base = { kind: "builtin", name };
    } else if (at("kw_long")) {
      advance();
      if (at("kw_long")) { advance(); base = { kind: "builtin", name: "long long" }; }
      else if (at("kw_double")) { advance(); base = { kind: "builtin", name: "long double" }; }
      else base = { kind: "builtin", name: "long" };
    } else {
      const kw = peek().kind;
      const builtinName = BUILTIN_KEYWORD_TO_NAME[kw];
      if (builtinName) {
        advance();
        base = { kind: "builtin", name: builtinName as CppBuiltin };
      } else if (at("ident")) {
        // Possibly-qualified named type: Foo or a::b::Foo, optionally Box<Arg>.
        const path: string[] = [advance().text];
        while (at("coloncolon")) { advance(); path.push(expect("ident", "after '::'").text); }
        if (at("lt")) {
          advance();
          const args: CppType[] = [];
          if (!at("gt")) {
            args.push(parseBaseType());
            while (at("comma")) { advance(); args.push(parseBaseType()); }
          }
          expect("gt", "to close template argument list");
          base = { kind: "template-instance", path, args };
        } else {
          base = { kind: "named", path };
        }
      } else {
        const t = peek();
        errors.push({ message: `expected a type, got ${t.kind} '${t.text}'`, line: t.line, col: t.col });
        base = { kind: "builtin", name: "void" };
      }
    }

    // const may also appear AFTER the base type name (e.g. "char const").
    while (at("kw_const")) { advance(); isConst = true; }

    return isConst ? { kind: "const", inner: base } : base;
  }

  function parseType(): CppType {
    let t = parseBaseType();
    // Pointer/reference declarators. A trailing "* const" (top-level const
    // on the pointer itself) doesn't affect the ABI/mangling for
    // pass-by-value parameters, so we deliberately consume and drop it.
    for (;;) {
      if (at("star")) { advance(); t = { kind: "pointer", pointee: t }; while (at("kw_const")) advance(); continue; }
      if (at("amp")) { advance(); t = { kind: "reference", pointee: t }; continue; }
      break;
    }
    return t;
  }

  // ── Parameter list ────────────────────────────────────────────────────

  function parseParams(): CppParam[] {
    expect("lparen", "to start parameter list");
    const params: CppParam[] = [];
    if (at("kw_void") && peek(1).kind === "rparen") { advance(); expect("rparen", "after 'void' param list"); return params; }
    if (!at("rparen")) {
      params.push(parseOneParam());
      while (at("comma")) { advance(); params.push(parseOneParam()); }
    }
    expect("rparen", "to close parameter list");
    return params;
  }

  function parseOneParam(): CppParam {
    const type = parseType();
    const name = at("ident") ? advance().text : "";
    return { name, type };
  }

  // ── Class body ────────────────────────────────────────────────────────

  function parseClassBody(className: string, defaultAccess: CppAccess): CppMethodDecl[] {
    expect("lbrace", "to start class body");
    const methods: CppMethodDecl[] = [];
    let access: CppAccess = defaultAccess;

    while (!at("rbrace") && !at("eof")) {
      if (at("kw_public")) { advance(); expect("colon", "after access specifier"); access = "public"; continue; }
      if (at("kw_private")) { advance(); expect("colon", "after access specifier"); access = "private"; continue; }
      if (at("kw_protected")) { advance(); expect("colon", "after access specifier"); access = "protected"; continue; }

      // skip qualifiers that don't change our binding decision; real
      // dynamic dispatch for `virtual` methods works transparently
      // through the trampoline (the compiled trampoline calls through a
      // real object pointer, so the C++ compiler resolves the vtable
      // itself — bindgen doesn't need to special-case it).
      while (at("kw_virtual") || at("kw_explicit") || at("kw_inline") || at("kw_friend")) advance();

      if (at("tilde")) {
        advance();
        const nm = expect("ident", "in destructor name");
        if (nm.text !== className) {
          errors.push({ message: `destructor name '~${nm.text}' does not match class '${className}'`, line: nm.line, col: nm.col });
        }
        const params = parseParams();
        if (at("semi")) advance(); else skipToRecoveryPoint();
        methods.push({ declKind: "method", memberKind: "dtor", name: "", params, returnType: { kind: "builtin", name: "void" }, isConst: false, isStatic: false, access });
        continue;
      }

      if (at("ident") && peek().text === className && peek(1).kind === "lparen") {
        // Constructor: ClassName(params)
        advance();
        const params = parseParams();
        if (at("semi")) advance(); else skipToRecoveryPoint();
        methods.push({ declKind: "method", memberKind: "ctor", name: "", params, returnType: { kind: "builtin", name: "void" }, isConst: false, isStatic: false, access });
        continue;
      }

      let isStatic = false;
      if (at("kw_static")) { advance(); isStatic = true; }

      if (at("kw_class") || at("kw_struct") || at("kw_namespace") || at("kw_template")) {
        // Nested types/templates inside a class body are out of scope —
        // skip the declaration without losing parser sync.
        errors.push({ message: "nested class/namespace/template declarations are not supported", line: peek().line, col: peek().col });
        skipToRecoveryPoint();
        continue;
      }

      // Regular method OR a plain data member declaration. Data members
      // (e.g. `int id_;`) are irrelevant to opaque-handle FFI bindings —
      // skip them silently rather than reporting a parse error.
      const returnType = parseType();
      if (!at("ident")) {
        const t = peek();
        errors.push({ message: `expected method or member name, got ${t.kind} '${t.text}'`, line: t.line, col: t.col });
        skipToRecoveryPoint();
        continue;
      }
      const name = advance().text;
      if (!at("lparen")) {
        // Data member, not a method: `Type name;` (possibly with an array
        // suffix or initializer, which skipToRecoveryPoint will consume).
        skipToRecoveryPoint();
        continue;
      }
      const params = parseParams();
      let isConst = false;
      if (at("kw_const")) { advance(); isConst = true; }
      if (at("semi")) advance(); else skipToRecoveryPoint();
      methods.push({ declKind: "method", memberKind: "method", name, params, returnType, isConst, isStatic, access });
    }

    expect("rbrace", "to close class body");
    expect("semi", "after class declaration");
    return methods;
  }

  // ── Top-level declarations ────────────────────────────────────────────

  function parseTopLevel(namespace: string[]): CppTopDecl[] {
    const decls: CppTopDecl[] = [];

    while (!at("eof") && !at("rbrace")) {
      if (at("kw_namespace")) {
        advance();
        const nsName = expect("ident", "after 'namespace'").text;
        expect("lbrace", "to start namespace body");
        decls.push(...parseTopLevel([...namespace, nsName]));
        expect("rbrace", "to close namespace body");
        continue;
      }

      if (at("kw_template")) {
        advance();
        expect("lt", "after 'template'");
        const templateParams: string[] = [];
        if (!at("gt")) {
          for (;;) {
            if (at("kw_typename") || peek().text === "class") advance();
            else errors.push({ message: "expected 'typename' in template parameter", line: peek().line, col: peek().col });
            templateParams.push(expect("ident", "as template parameter name").text);
            if (at("comma")) { advance(); continue; }
            break;
          }
        }
        expect("gt", "to close template parameter list");

        if (!at("kw_class") && !at("kw_struct")) {
          errors.push({ message: "only template classes/structs are supported", line: peek().line, col: peek().col });
          skipToRecoveryPoint();
          continue;
        }
        const isStruct = at("kw_struct");
        advance();
        const name = expect("ident", "as template class name").text;
        if (at("semi")) { advance(); decls.push({ declKind: "class", name, namespace, isOpaque: true, isTemplate: true, templateParams, methods: [] }); continue; }
        const methods = parseClassBody(name, isStruct ? "public" : "private");
        decls.push({ declKind: "class", name, namespace, isOpaque: false, isTemplate: true, templateParams, methods });
        continue;
      }

      if (at("kw_class") || at("kw_struct")) {
        const isStruct = at("kw_struct");
        advance();
        const name = expect("ident", "as class name").text;
        if (at("semi")) { advance(); decls.push({ declKind: "class", name, namespace, isOpaque: true, isTemplate: false, templateParams: [], methods: [] }); continue; }
        const methods = parseClassBody(name, isStruct ? "public" : "private");
        decls.push({ declKind: "class", name, namespace, isOpaque: false, isTemplate: false, templateParams: [], methods });
        continue;
      }

      // Free function declaration: ReturnType name(params);
      const startPos = pos;
      const returnType = parseType();
      if (!at("ident")) {
        if (pos === startPos) advance(); // guarantee forward progress
        else skipToRecoveryPoint();
        continue;
      }
      const name = advance().text;
      if (!at("lparen")) {
        errors.push({ message: `expected '(' to start parameter list for '${name}'`, line: peek().line, col: peek().col });
        skipToRecoveryPoint();
        continue;
      }
      const params = parseParams();
      if (at("semi")) advance(); else skipToRecoveryPoint();
      decls.push({ declKind: "function", name, namespace, params, returnType });
    }

    return decls;
  }

  const decls = parseTopLevel([]);
  return { decls, errors };
}
