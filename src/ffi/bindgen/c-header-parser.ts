// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Binding Generator: C Header Parser
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
// Parses a simplified subset of C headers sufficient to generate UR bindings.
// Handles: typedefs, structs, enums, unions, function declarations, #define constants.
// Does NOT handle: preprocessor conditionals, templates, C++ classes.

// ── Token types ────────────────────────────────────────────────────────────

export type CTokenKind =
  | "ident" | "number" | "string"
  | "lparen" | "rparen" | "lbrace" | "rbrace" | "lbracket" | "rbracket"
  | "semi" | "comma" | "star" | "amp" | "assign" | "arrow"
  | "kw_typedef" | "kw_struct" | "kw_union" | "kw_enum"
  | "kw_const" | "kw_unsigned" | "kw_signed" | "kw_void"
  | "kw_extern" | "kw_static" | "kw_inline"
  | "define" | "include"
  | "ellipsis"
  | "eof";

export type CToken = {
  kind: CTokenKind;
  text: string;
  line: number;
  col: number;
};

// ── Tokenizer ──────────────────────────────────────────────────────────────

const KEYWORDS: Record<string, CTokenKind> = {
  typedef:  "kw_typedef",
  struct:   "kw_struct",
  union:    "kw_union",
  enum:     "kw_enum",
  const:    "kw_const",
  unsigned: "kw_unsigned",
  signed:   "kw_signed",
  void:     "kw_void",
  extern:   "kw_extern",
  static:   "kw_static",
  inline:   "kw_inline",
};

export function tokenizeCHeader(src: string): CToken[] {
  const tokens: CToken[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  function col(): number { return i - lineStart + 1; }
  function peek(n = 0): string { return src[i + n] ?? ""; }
  function advance(): string { const c = src[i++]!; if (c === "\n") { line++; lineStart = i; } return c; }

  while (i < src.length) {
    const c = peek();

    // Whitespace
    if (/\s/.test(c)) { advance(); continue; }

    // Line comment
    if (c === "/" && peek(1) === "/") {
      while (i < src.length && peek() !== "\n") advance();
      continue;
    }

    // Block comment
    if (c === "/" && peek(1) === "*") {
      advance(); advance();
      while (i < src.length && !(peek() === "*" && peek(1) === "/")) advance();
      if (i < src.length) { advance(); advance(); }
      continue;
    }

    // Preprocessor directives (simplified)
    if (c === "#") {
      const l = line; const cl = col();
      advance();
      let directive = "";
      while (i < src.length && /[a-zA-Z]/.test(peek())) directive += advance();
      // skip whitespace
      while (i < src.length && peek() === " ") advance();
      if (directive === "define") {
        tokens.push({ kind: "define", text: directive, line: l, col: cl });
        // do NOT skip the rest of the line — #define's name/value tokens
        // must be tokenized normally so the parser can read them.
      } else if (directive === "include") {
        // skip the rest of the line
        while (i < src.length && peek() !== "\n") advance();
      } else {
        // unknown/unsupported directive (#ifdef, #pragma, etc.) — skip its line
        while (i < src.length && peek() !== "\n") advance();
      }
      continue;
    }

    // String literals
    if (c === '"') {
      const l = line; const cl = col();
      advance(); // opening quote
      let str = "";
      while (i < src.length && peek() !== '"') {
        if (peek() === "\\") { advance(); str += advance(); }
        else { str += advance(); }
      }
      if (i < src.length) advance(); // closing quote
      tokens.push({ kind: "string", text: str, line: l, col: cl });
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_]/.test(c)) {
      const l = line; const cl = col();
      let word = "";
      while (i < src.length && /[a-zA-Z0-9_]/.test(peek())) word += advance();
      const kw = KEYWORDS[word];
      tokens.push({ kind: kw ?? "ident", text: word, line: l, col: cl });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(c) || (c === "0" && /[xXbB]/.test(peek(1)))) {
      const l = line; const cl = col();
      let num = "";
      while (i < src.length && /[0-9a-fA-FxXuUlLbB_]/.test(peek())) num += advance();
      // decimal point followed by more digits (float literal)
      if (peek() === "." && /[0-9]/.test(peek(1))) {
        num += advance(); // consume '.'
        while (i < src.length && /[0-9fFlL]/.test(peek())) num += advance();
      }
      tokens.push({ kind: "number", text: num, line: l, col: cl });
      continue;
    }

    // Ellipsis
    if (c === "." && peek(1) === "." && peek(2) === ".") {
      const l = line; const cl = col();
      advance(); advance(); advance();
      tokens.push({ kind: "ellipsis", text: "...", line: l, col: cl });
      continue;
    }

    // Single-char tokens
    const l = line; const cl = col();
    advance();
    const singles: Record<string, CTokenKind> = {
      "(": "lparen", ")": "rparen", "{": "lbrace", "}": "rbrace",
      "[": "lbracket", "]": "rbracket", ";": "semi", ",": "comma",
      "*": "star", "&": "amp", "=": "assign",
    };
    const sk = singles[c];
    if (sk) {
      tokens.push({ kind: sk, text: c, line: l, col: cl });
    }
    // skip unknown chars silently (e.g. preprocessor noise)
  }

  tokens.push({ kind: "eof", text: "", line, col: col() });
  return tokens;
}

// ── C AST Nodes ───────────────────────────────────────────────────────────

export type CTypeRef =
  | { kind: "named"; name: string; const_: boolean }
  | { kind: "pointer"; base: CTypeRef; const_: boolean }
  | { kind: "array"; base: CTypeRef; size: number | null }
  | { kind: "primitive"; prim: string; unsigned: boolean; const_: boolean };

export type CField = {
  name: string;
  type: CTypeRef;
};

export type CStructDecl = {
  kind: "struct" | "union";
  name: string | null;
  fields: CField[];
};

export type CEnumVariant = {
  name: string;
  value: number | null; // null = auto-increment
};

export type CEnumDecl = {
  kind: "enum";
  name: string | null;
  variants: CEnumVariant[];
};

export type CParam = {
  name: string | null; // unnamed params allowed
  type: CTypeRef;
  variadic: boolean;
};

export type CFunctionDecl = {
  kind: "function";
  name: string;
  returnType: CTypeRef;
  params: CParam[];
  variadic: boolean;
};

export type CTypedef = {
  kind: "typedef";
  alias: string;
  target: CTypeRef | CStructDecl | CEnumDecl;
};

export type CDefine = {
  kind: "define";
  name: string;
  value: string; // raw text — caller parses
};

export type CDecl = CFunctionDecl | CTypedef | CStructDecl | CEnumDecl | CDefine;

export type CHeader = {
  decls: CDecl[];
  errors: CParseError[];
};

export type CParseError = {
  message: string;
  line: number;
  col: number;
};

// ── Parser ─────────────────────────────────────────────────────────────────

export function parseCHeader(src: string): CHeader {
  const tokens = tokenizeCHeader(src);
  const errors: CParseError[] = [];
  const decls: CDecl[] = [];
  let pos = 0;

  function peek(n = 0): CToken { return tokens[pos + n] ?? tokens[tokens.length - 1]!; }
  function advance(): CToken { return tokens[pos++] ?? tokens[tokens.length - 1]!; }
  function expect(kind: CTokenKind): CToken {
    const t = peek();
    if (t.kind === kind) { pos++; return t; }
    errors.push({ message: `expected ${kind}, got ${t.kind} '${t.text}'`, line: t.line, col: t.col });
    return t;
  }
  function at(kind: CTokenKind): boolean { return peek().kind === kind; }
  function eat(kind: CTokenKind): boolean { if (at(kind)) { pos++; return true; } return false; }

  // ── C type-specifier-sequence parser ──────────────────────────────────────
  // C allows type specifiers in almost any interleaved order:
  //   "unsigned long int", "long unsigned int", "const long long int"
  // are all legal and mean the same thing. This implementation collects ALL
  // specifier tokens first (a proper specifier-collection loop), then
  // resolves them to a canonical string name matching the keys already in
  // builtinRegistry() in converter.ts — no per-case ad-hoc patching.
  //
  // Supported specifier keywords:
  //   Qualifiers:  const, volatile (volatile ignored for ABI purposes)
  //   Signedness:  signed, unsigned
  //   Width:       short, long, long long
  //   Base:        int, char, float, double, bool, _Bool
  //
  // Also handles: struct/union tags, enum tags, void, and plain named
  // types (typedefs) when no specifier keyword has been seen yet.
  //
  // Valid combinations that now resolve correctly (regression coverage in
  // tests/ffi/bindgen.test.ts "multi-token type specifiers"):
  //   long long, unsigned long long, long double, unsigned long,
  //   unsigned int, unsigned short, unsigned char, signed char,
  //   const unsigned long long, volatile unsigned int (volatile dropped)
  //
  // Root-cause regression: SQLite3's "long long" parameter types
  // (sqlite3_bind_int64, sqlite3_column_int64, sqlite3_last_insert_rowid)
  // were silently dropped by the prior single-token code, corrupting
  // parameter lists for any declaration using multi-token integer widths.

  const C_BUILTIN_SPECIFIERS = new Set([
    "short", "long", "int", "char", "float", "double", "bool", "_Bool",
  ]);

  function resolveSpecifiers(s: {
    const_: boolean; unsigned: boolean; signed_: boolean;
    short: boolean; long: number; base: string | null;
  }, errTok: CToken): CTypeRef {
    const c = s.const_;
    if (s.unsigned && (s.base === "float" || s.base === "double"))
      throw new Error(`invalid type specifier: unsigned ${s.base}`);
    if (s.short && s.long > 0) throw new Error("invalid type specifier: short long");
    if (s.long > 2) throw new Error("invalid type specifier: long long long");
    if (s.base === "float" && (s.short || s.long > 0))
      throw new Error("invalid type specifier: short/long float");
    if (s.base === "double" && s.short) throw new Error("invalid type specifier: short double");
    if (s.base === "double" && s.long > 1) throw new Error("invalid type specifier: long long double");

    let name: string;
    if (s.base === "float")                           name = "float";
    else if (s.base === "double" && s.long === 1)     name = "long double";
    else if (s.base === "double")                     name = "double";
    else if (s.base === "bool" || s.base === "_Bool") name = "bool";
    else if (s.base === "char") {
      name = s.unsigned ? "unsigned char" : s.signed_ ? "signed char" : "char";
    }
    else if (s.short)    name = s.unsigned ? "unsigned short"     : "short";
    else if (s.long >= 2) name = s.unsigned ? "unsigned long long" : "long long";
    else if (s.long === 1) name = s.unsigned ? "unsigned long"     : "long";
    else {
      // int, bare unsigned, bare signed — or nothing at all
      if (s.base === null && !s.unsigned && !s.signed_)
        throw new Error(`expected a type, got ${errTok.kind} '${errTok.text}'`);
      name = s.unsigned ? "unsigned int" : "int";
    }
    return { kind: "named", name, const_: c };
  }

  function finishPointers(base: CTypeRef): CTypeRef {
    let result = base;
    while (eat("star")) {
      const ptrConst = eat("kw_const");
      result = { kind: "pointer", base: result, const_: ptrConst };
    }
    return result;
  }

  function parseTypeRef(): CTypeRef {
    const s = { const_: false, unsigned: false, signed_: false, short: false, long: 0, base: null as string | null };
    let anySpecifier = false;

    loop: for (;;) {
      if (eat("kw_const")) { s.const_ = true; anySpecifier = true; continue; }
      // volatile: no dedicated token — emitted as plain ident. Consume and
      // ignore; volatile doesn't affect ABI signatures.
      if (at("ident") && peek().text === "volatile") { advance(); anySpecifier = true; continue; }
      if (eat("kw_unsigned")) {
        if (s.unsigned || s.signed_) throw new Error("conflicting signedness specifiers");
        s.unsigned = true; anySpecifier = true; continue;
      }
      if (eat("kw_signed")) {
        if (s.unsigned || s.signed_) throw new Error("conflicting signedness specifiers");
        s.signed_ = true; anySpecifier = true; continue;
      }
      if (at("ident") && C_BUILTIN_SPECIFIERS.has(peek().text)) {
        const txt = peek().text;
        if (txt === "short") { advance(); s.short = true; anySpecifier = true; continue; }
        if (txt === "long")  { advance(); s.long++;       anySpecifier = true; continue; }
        // int, char, float, double, bool, _Bool — only one allowed
        if (s.base !== null) throw new Error(`duplicate base type specifier: ${s.base} and ${txt}`);
        advance(); s.base = txt; anySpecifier = true; continue;
      }
      // plain named type (typedef / struct tag / ...) — fires when
      // no specifiers have been seen yet, OR when only qualifiers
      // (const/volatile) have been seen (e.g. "const CvMat*").
      if (at("ident") && !s.unsigned && !s.signed_ && !s.short && s.long === 0 && s.base === null &&
          !C_BUILTIN_SPECIFIERS.has(peek().text)) {
        const name = advance().text;
        while (eat("kw_const")) s.const_ = true;
        return finishPointers({ kind: "named", name, const_: s.const_ });
      }
      if (at("kw_void")) {
        advance();
        return finishPointers({ kind: "primitive", prim: "void", unsigned: false, const_: s.const_ });
      }
      if (!anySpecifier) {
        // struct / union / enum tags
        if (at("kw_struct") || at("kw_union")) {
          const sk = advance().kind === "kw_struct" ? "struct" : "union";
          const sname = at("ident") ? advance().text : null;
          let base: CTypeRef;
          if (at("lbrace")) {
            const sd = parseStructBody(sk as "struct" | "union", sname);
            decls.push(sd);
            base = { kind: "named", name: sname ?? "__anon", const_: s.const_ };
          } else {
            base = { kind: "named", name: sname ?? "__unknown", const_: s.const_ };
          }
          return finishPointers(base);
        }
        if (at("kw_enum")) {
          advance();
          const ename = at("ident") ? advance().text : null;
          return finishPointers({ kind: "named", name: ename ?? "__anon_enum", const_: s.const_ });
        }
      }
      break loop;
    }

    return finishPointers(resolveSpecifiers(s, peek()));
  }

  function parseStructBody(kind: "struct" | "union", name: string | null): CStructDecl {
    expect("lbrace");
    const fields: CField[] = [];
    while (!at("rbrace") && !at("eof")) {
      try {
        const type = parseTypeRef();
        while (!at("semi") && !at("eof")) {
          const fname = at("ident") ? advance().text : "__field";
          // handle arrays
          if (eat("lbracket")) {
            const sz = at("number") ? parseInt(advance().text) : null;
            eat("rbracket");
            fields.push({ name: fname, type: { kind: "array", base: type, size: sz } });
          } else {
            fields.push({ name: fname, type });
          }
          if (!eat("comma")) break;
        }
        eat("semi");
      } catch {
        // recovery: skip to next semicolon
        while (!at("semi") && !at("rbrace") && !at("eof")) advance();
        eat("semi");
      }
    }
    expect("rbrace");
    return { kind, name, fields };
  }

  function parseEnumBody(name: string | null): CEnumDecl {
    expect("lbrace");
    const variants: CEnumVariant[] = [];
    while (!at("rbrace") && !at("eof")) {
      if (!at("ident")) { advance(); continue; }
      const vname = advance().text;
      let value: number | null = null;
      if (eat("assign")) {
        const neg = peek().text === "-"; if (neg) advance();
        if (at("number")) {
          const raw = advance().text;
          const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw);
          value = neg ? -n : n;
        }
      }
      variants.push({ name: vname, value });
      if (!eat("comma")) break;
    }
    expect("rbrace");
    return { kind: "enum", name, variants };
  }

  function parseFunctionParams(): { params: CParam[]; variadic: boolean } {
    const params: CParam[] = [];
    let variadic = false;
    expect("lparen");
    while (!at("rparen") && !at("eof")) {
      if (eat("ellipsis")) { variadic = true; break; }
      const type = parseTypeRef();
      const name = at("ident") ? advance().text : null;
      params.push({ name, type, variadic: false });
      if (!eat("comma")) break;
    }
    expect("rparen");
    return { params, variadic };
  }

  // ── Top-level parse loop ─────────────────────────────────────────────────

  while (!at("eof")) {
    try {
      // #define NAME value
      if (at("define")) {
        advance();
        const name = at("ident") ? advance().text : "__define";
        let value = "";
        while (!at("eof") && peek().line === tokens[pos - 1]!.line) {
          value += advance().text + " ";
        }
        decls.push({ kind: "define", name, value: value.trim() });
        continue;
      }

      // Skip extern "C" { ... } wrappers
      if (at("kw_extern")) {
        advance();
        if (at("string")) { advance(); }
        if (at("lbrace")) { advance(); continue; }
      }

      // typedef
      if (eat("kw_typedef")) {
        if (at("kw_struct") || at("kw_union")) {
          const sk = advance().kind === "kw_struct" ? "struct" : "union";
          const sname = at("ident") && !at("lbrace") ? advance().text : null;
          if (!at("lbrace")) {
            // Forward-declaration style: `typedef struct TAG NAME;`
            // (also covers `typedef struct TAG *NAME;` via pointer typedefs below)
            const alias = at("ident") ? advance().text : sname ?? "__typedef";
            eat("semi");
            decls.push({
              kind: "typedef",
              alias,
              target: { kind: "named", name: sname ?? alias, const_: false },
            });
            continue;
          }
          const s = parseStructBody(sk as "struct" | "union", sname);
          const alias = at("ident") ? advance().text : "__typedef";
          eat("semi");
          decls.push({ kind: "typedef", alias, target: s });
          continue;
        }
        if (at("kw_enum")) {
          advance();
          const ename = at("ident") ? advance().text : null;
          const e = parseEnumBody(ename);
          const alias = at("ident") ? advance().text : "__enum_typedef";
          eat("semi");
          decls.push({ kind: "typedef", alias, target: e });
          continue;
        }
        const type = parseTypeRef();
        // typedef void (*FnPtr)(args)  — function pointer typedef
        if (at("lparen")) {
          advance(); eat("star");
          const alias = at("ident") ? advance().text : "__fnptr";
          expect("rparen");
          const { params, variadic } = parseFunctionParams();
          eat("semi");
          decls.push({ kind: "typedef", alias, target: { kind: "named", name: alias, const_: false } });
          continue;
        }
        const alias = at("ident") ? advance().text : "__typedef";
        eat("semi");
        decls.push({ kind: "typedef", alias, target: type });
        continue;
      }

      // struct/union at top level (not typedef)
      if (at("kw_struct") || at("kw_union")) {
        const sk = advance().kind === "kw_struct" ? "struct" : "union";
        const sname = at("ident") ? advance().text : null;
        if (at("lbrace")) {
          const s = parseStructBody(sk as "struct" | "union", sname);
          eat("semi");
          decls.push(s);
        } else {
          // forward declaration — skip
          eat("semi");
        }
        continue;
      }

      // enum at top level
      if (at("kw_enum")) {
        advance();
        const ename = at("ident") ? advance().text : null;
        if (at("lbrace")) {
          const e = parseEnumBody(ename);
          eat("semi");
          decls.push(e);
        } else {
          eat("semi");
        }
        continue;
      }

      // eat closing braces from extern "C" blocks
      if (eat("rbrace")) continue;

      // Function declaration or variable declaration
      eat("kw_static"); eat("kw_inline");
      const retType = parseTypeRef();
      if (!at("ident")) { eat("semi"); continue; }
      const name = advance().text;

      if (at("lparen")) {
        const { params, variadic } = parseFunctionParams();
        eat("semi");
        decls.push({ kind: "function", name, returnType: retType, params, variadic });
      } else {
        // global variable — skip
        while (!at("semi") && !at("eof")) advance();
        eat("semi");
      }
    } catch (err) {
      const t = peek();
      errors.push({ message: `parse error: ${err}`, line: t.line, col: t.col });
      // recovery: skip to next semicolon or rbrace
      while (!at("semi") && !at("rbrace") && !at("eof")) advance();
      eat("semi");
    }
  }

  return { decls, errors };
}
