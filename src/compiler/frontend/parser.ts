// ─────────────────────────────────────────────────────────────────────────────
// UR Language 1.0 — Parser
// Specification: UR_LANGUAGE_SPEC_1_0.md  §5
// ─────────────────────────────────────────────────────────────────────────────
//
// Strategy:
//   - Recursive-descent for declarations and statements
//   - Pratt (top-down operator precedence) for expressions
//   - Error recovery: on syntax error emit ParseError, skip to a safe recovery
//     point (next NEWLINE or END_KW) and continue — never abort
//
// The Parser consumes Token[] from the Lexer and produces:
//   Program  (ast.ts)  — the frozen AST that Semantic/TypeSystem/Module use
//
// Design rule: every node sets its span from the first token consumed to the
// last token consumed. Span is never approximate.
// ─────────────────────────────────────────────────────────────────────────────

import type { Token, TokenKind, Span } from "./lexer.js";
import type {
  Program, ModuleDecl, ImportDecl, GlobalVariableDecl,
  FunctionDecl, Param, TypeRef, SourceSpan,
  StructDecl, StructField, TypeAliasDecl,
  Statement, BlockStatement, VariableDeclaration, Assignment,
  IfStatement, WhileStatement, ForStatement,
  BreakStatement, ContinueStatement, ReturnStatement, ExpressionStatement,
  Expression, Identifier, IntLiteral, FloatLiteral, StringLiteral, CharLiteral,
  BoolLiteral, NullLiteral, ArrayLiteral, UnaryExpression, BinaryExpression,
  ConditionalExpression, CallExpression, MemberExpression, IndexExpression,
} from "./ast.js";
import { CANONICAL_TYPE } from "./ast.js";
import { isCanonicalIn } from "../localization/index.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type ParseError = {
  code: "PE001" | "PE002" | "PE003" | "PE004" | "PE005" | "PE006" | "PE007" | "PE008" | "PE009" | "PE010" | "PE011" | "PE012" | "PE013";
  message: string;
  span: SourceSpan;
};

export type ParseResult = {
  program: Program;
  errors: ParseError[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function spanFromLexer(s: Span): SourceSpan {
  return { startLine: s.startLine, startColumn: s.startCol, endLine: s.endLine, endColumn: s.endCol };
}

function mergeSpan(a: SourceSpan, b: SourceSpan): SourceSpan {
  return { startLine: a.startLine, startColumn: a.startColumn, endLine: b.endLine, endColumn: b.endColumn };
}

// ── Parser class ──────────────────────────────────────────────────────────────

export function parse(tokens: Token[], file = "<input>"): ParseResult {
  // Filter NEWLINE tokens into a side buffer but keep them for statement
  // separation awareness. We expose a "skipNewlines()" helper.
  // Strategy: the main stream keeps ALL tokens; we skip newlines when they
  // are irrelevant (inside expressions, between parameters) and treat them
  // as statement separators at the statement level.
  const toks = tokens.filter(t => t.kind !== "EOF").concat(tokens.filter(t => t.kind === "EOF").slice(0, 1));
  let pos = 0;
  const errors: ParseError[] = [];

  // ── Token access ─────────────────────────────────────────────────────────

  function peek(offset = 0): Token {
    let i = pos, skipped = 0;
    while (i < toks.length) {
      if (skipped === offset) return toks[i]!;
      i++;
      skipped++;
    }
    return toks[toks.length - 1]!; // EOF
  }

  function peekSkipNL(offset = 0): Token {
    let i = pos, found = 0;
    while (i < toks.length) {
      if (toks[i]!.kind !== "NEWLINE") {
        if (found === offset) return toks[i]!;
        found++;
      }
      i++;
    }
    return toks[toks.length - 1]!;
  }

  // Pure lookahead (consumes nothing): true iff the CURRENT token starts
  // a chain of one-or-more consecutive bare IDENTIFIER tokens that is
  // immediately followed by FUNCTION_KW/STRUCT_KW/TYPE_KW — i.e. this is
  // a (possibly stacked) unrecognized-modifier sequence before a real
  // declaration, matching PE010's own full scope (see the fix comment at
  // its call site for why a single-token lookahead was insufficient for
  // 2+ stacked modifiers).
  function isModifierChainBeforeDeclaration(): boolean {
    let offset = 0;
    while (peekSkipNL(offset).kind === "IDENTIFIER") offset++;
    if (offset === 0) return false; // current token isn't even an identifier
    return ["FUNCTION_KW", "STRUCT_KW", "TYPE_KW"].includes(peekSkipNL(offset).kind);
  }

  function at(...kinds: TokenKind[]): boolean {
    return kinds.includes(peek().kind);
  }

  function atSkipNL(...kinds: TokenKind[]): boolean {
    return kinds.includes(peekSkipNL().kind);
  }

  function advance(): Token {
    const t = toks[pos] ?? toks[toks.length - 1]!;
    if (pos < toks.length - 1) pos++;
    return t;
  }

  function skipNewlines(): void {
    while (at("NEWLINE")) advance();
  }

  function eat(kind: TokenKind): Token | null {
    if (at(kind)) return advance();
    return null;
  }

  function eatSkipNL(kind: TokenKind): Token | null {
    skipNewlines();
    return eat(kind);
  }

  function span(t: Token): SourceSpan { return spanFromLexer(t.span); }

  function addError(code: ParseError["code"], message: string, tok: Token): void {
    errors.push({ code, message, span: span(tok) });
  }

  function expect(kind: TokenKind, code: ParseError["code"], message: string): Token {
    skipNewlines();
    if (at(kind)) return advance();
    addError(code, message + `, got '${peek().text}' (${peek().kind})`, peek());
    return peek(); // don't consume — let caller recover
  }

  /** Skip tokens until we hit a safe recovery point. */
  function syncTo(...recovery: TokenKind[]): void {
    while (!at("EOF") && !at(...recovery)) advance();
  }

  // ── Type expressions ──────────────────────────────────────────────────────

  function skipUnsupportedBlock(): void {
    advance(); // unsupported construct identifier
    while (!at("EOF") && !at("NEWLINE")) advance();
    eat("NEWLINE");

    let depth = 1;
    while (!at("EOF") && depth > 0) {
      if (at("IF_KW") || at("WHILE_KW") || at("FOR_KW")) {
        depth++;
        advance();
        continue;
      }
      if (at("END_KW")) {
        depth--;
        advance();
        continue;
      }
      advance();
    }
    eat("NEWLINE");
  }

  function parseTypeRef(): TypeRef | undefined {
    skipNewlines();
    const t = peek();
    if (t.kind !== "IDENTIFIER" && t.kind !== "TRUE_LIT" && t.kind !== "FALSE_LIT" && t.kind !== "NULL_LIT") return undefined;
    const raw = t.text;
    const canonical = CANONICAL_TYPE[raw] ?? raw;
    advance();
    // Bracket-suffix array type: `int[]`, `int[][]`, ... — LANGUAGE_SYNTAX_1_1_SPEC.md §1.2.
    // Loops to ANY depth structurally — multi-dimensional arrays are
    // rejected at LOWERING (an `ArrayLiteral` inside an `ArrayLiteral`
    // produces CG1001 "expression kind 'ArrayLiteral' is not supported
    // in this Level 2 phase"), not at the Parser/Grammar level. CORRECTED
    // (Compiler & Runtime Stabilization phase — the type-resolution fix
    // below revealed this comment's own prior claim, "TypeChecker-level
    // restriction, depth > 1 rejected later," was factually inaccurate:
    // no such TypeChecker-level check exists anywhere in checker.ts/
    // type-env.ts; `int[][]` type-checks successfully now that
    // resolveTypeRef correctly honors arrayDepth — the actual rejection
    // was always, and remains, at Lowering, confirmed directly).
    // Only consumes `[` `]` immediately adjacent with nothing between
    // them; backs off entirely if that's not the case (e.g. `[`
    // starting something else) rather than consuming partially.
    let arrayDepth = 0;
    while (at("LBRACKET")) {
      const save = pos;
      advance(); // '['
      if (at("RBRACKET")) {
        advance(); // ']'
        arrayDepth++;
      } else {
        pos = save; // not another array suffix — back off, stop looping
        break;
      }
    }
    return { kind: "TypeRef", name: canonical, arrayDepth: arrayDepth || undefined, span: span(t) };
  }

  // ── Statements ────────────────────────────────────────────────────────────

  function parseBlock(context: string): BlockStatement {
    const statements: Statement[] = [];
    const start = peek();
    skipNewlines();
    while (!at("EOF") && !at("END_KW") && !at("ELSE_KW")) {
      const before = pos;
      const stmt = parseStatement();
      if (stmt) statements.push(stmt);
      skipNewlines();
      // Defense-in-depth: guarantee forward progress. If a full iteration
      // consumed zero tokens (a bug elsewhere), force-advance rather than
      // loop forever — this can never mask a real parse, only prevent a hang.
      if (pos === before && !at("EOF")) advance();
    }
    const endSpan = span(at("END_KW") ? peek() : start);
    return {
      kind: "BlockStatement",
      statements,
      span: statements.length
        ? mergeSpan(span(start), endSpan)
        : endSpan,
    };
  }

  function parseStatement(): Statement | null {
    skipNewlines();
    const t = peek();

    switch (t.kind) {
      case "LET_KW":     return parseLetStatement();
      case "RETURN_KW":  return parseReturnStatement();
      case "IF_KW":      return parseIfStatement();
      case "WHILE_KW":   return parseWhileStatement();
      case "FOR_KW":     return parseForStatement();
      case "BREAK_KW":   { advance(); eat("NEWLINE"); return { kind: "BreakStatement", span: span(t) }; }
      case "CONTINUE_KW":{ advance(); eat("NEWLINE"); return { kind: "ContinueStatement", span: span(t) }; }
      case "EOF":        return null;
      case "END_KW":     return null; // consumed by caller
      case "NEWLINE":    { advance(); return null; }
      case "IDENTIFIER": {
        if (t.text === "switch") {
          addError("PE012", "switch statements are not supported in UR 1.0. This feature is planned for a future version.", t);
          skipUnsupportedBlock();
          return null;
        }
        if (t.text === "try") {
          addError("PE013", "try/catch/finally is not supported in UR 1.0. This feature is planned for a future version.", t);
          skipUnsupportedBlock();
          return null;
        }
        return parseExpressionStatement();
      }
      default:           return parseExpressionStatement();
    }
  }

  function parseLetStatement(): VariableDeclaration {
    const kw = advance(); // LET_KW
    skipNewlines();
    const nameTok = expect("IDENTIFIER", "PE006", "Expected identifier after 'let'/'عرف'");
    const name = nameTok.text;

    let type: TypeRef | undefined;
    if (eat("COLON")) { type = parseTypeRef(); }

    skipNewlines();
    expect("EQ", "PE007", "Expected '=' in let statement");
    skipNewlines();
    const value = parseExpression();
    eat("NEWLINE");

    return {
      kind: "VariableDeclaration",
      name,
      isConst: false,
      type,
      initializer: value,
      span: mergeSpan(span(kw), value?.span ?? span(nameTok)),
    };
  }

  function parseReturnStatement(): ReturnStatement {
    const kw = advance(); // RETURN_KW
    skipNewlines();
    if (at("NEWLINE") || at("EOF") || at("END_KW")) {
      eat("NEWLINE");
      return { kind: "ReturnStatement", span: span(kw) };
    }
    const value = parseExpression();
    eat("NEWLINE");
    return { kind: "ReturnStatement", value, span: mergeSpan(span(kw), value?.span ?? span(kw)) };
  }

  function parseIfStatement(): IfStatement {
    const kw = advance(); // IF_KW
    skipNewlines();
    const condition = parseExpression();
    eat("NEWLINE");

    const thenBranch = parseBlock("if");

    let elseBranch: BlockStatement | IfStatement | undefined;
    if (at("ELSE_KW")) {
      advance(); // ELSE_KW
      skipNewlines();
      if (at("IF_KW")) {
        // else if chain
        elseBranch = parseIfStatement();
      } else {
        eat("NEWLINE");
        elseBranch = parseBlock("else");
        const end = expect("END_KW", "PE002", "Expected 'end'/'نهاية' to close if statement");
        eat("NEWLINE");
        return {
          kind: "IfStatement", condition, thenBranch, elseBranch,
          span: mergeSpan(span(kw), span(end)),
        };
      }
    } else {
      const end = expect("END_KW", "PE002", "Expected 'end'/'نهاية' to close if statement");
      eat("NEWLINE");
      return {
        kind: "IfStatement", condition, thenBranch, elseBranch: undefined,
        span: mergeSpan(span(kw), span(end)),
      };
    }
    return { kind: "IfStatement", condition, thenBranch, elseBranch, span: span(kw) };
  }

  function parseWhileStatement(): WhileStatement {
    const kw = advance(); // WHILE_KW
    skipNewlines();
    const condition = parseExpression();
    eat("NEWLINE");
    const body = parseBlock("while");
    const end = expect("END_KW", "PE002", "Expected 'end'/'نهاية' to close while");
    eat("NEWLINE");
    return { kind: "WhileStatement", condition, body, span: mergeSpan(span(kw), span(end)) };
  }

  function parseForStatement(): ForStatement {
    const kw = advance(); // FOR_KW
    skipNewlines();
    const bindTok = expect("IDENTIFIER", "PE001", "Expected variable name after 'for'/'لكل'");
    skipNewlines();
    // Consume the contextual "in" keyword. This is intentionally NOT a
    // reserved TokenKind (see spec §5.8) — every supported language's word
    // for "in" tokenizes as a plain IDENTIFIER, and the Parser asks the
    // Language Mapper whether THIS PARTICULAR identifier text is any
    // language's canonical "in" word. The Parser itself never hardcodes
    // any language's literal spelling — adding an 11th language requires
    // zero changes here.
    if (peek().kind === "IDENTIFIER" && isCanonicalIn(peek().text)) {
      advance();
    } else {
      addError("PE001", "Expected 'in' keyword in for statement", peek());
    }
    skipNewlines();
    const iterable = parseExpression();
    eat("NEWLINE");
    const body = parseBlock("for");
    const end = expect("END_KW", "PE002", "Expected 'end'/'نهاية' to close for");
    eat("NEWLINE");
    return {
      kind: "ForStatement",
      binding: bindTok.text,
      iterable,
      body,
      span: mergeSpan(span(kw), span(end)),
    };
  }

  function parseExpressionStatement(): Statement | null {
    const expr = parseExpression();
    if (!expr) return null;

    // Check for assignment: `target = value`
    skipNewlines();
    if (at("EQ")) {
      const eqTok = advance();
      skipNewlines();
      const value = parseExpression();
      eat("NEWLINE");
      const assign: Assignment = {
        kind: "Assignment",
        operator: "=",
        target: expr,
        value,
        span: mergeSpan(expr.span, value?.span ?? span(eqTok)),
      };
      // Assignment is a first-class Statement in the AST union (ast.ts L99),
      // NOT an Expression (it does not appear in the Expression union,
      // ast.ts L189-201). Both the Semantic Analyzer (semantic/index.ts
      // L186, `case "Assignment": this.walkAssignment(stmt)`) and the Type
      // Checker (typesystem/checker.ts L106, same pattern) dispatch on
      // `stmt.kind` at the STATEMENT level with a dedicated Assignment
      // case, separate from their `case "ExpressionStatement"` handler
      // (which only calls walkExpr/inferExpr — neither has an "Assignment"
      // case in their Expression-level switch, since none should exist).
      //
      // The previous version of this function wrapped the Assignment node
      // inside ExpressionStatement.expression and cast it to Expression.
      // This type-checked (the cast suppressed the error) but was
      // semantically wrong: it routed every assignment through
      // walkExpr/inferExpr instead of walkAssignment/checkAssignment,
      // silently disabling SE1001 (undefined assignment target), SE4001
      // (assign to const), SE4002 (assign to parameter), and TY2002
      // (assignment type mismatch) for every single assignment statement
      // in every UR program. Found via the restored Semantic Analyzer test
      // suite (tests/compiler/semantic/semantic.test.ts).
      return assign;
    }

    eat("NEWLINE");
    return { kind: "ExpressionStatement", expression: expr, span: expr.span };
  }

  // ── Expressions (Pratt parser) ─────────────────────────────────────────────
  //
  // Precedences (higher = tighter binding):
  //   1  OR
  //   2  AND
  //   3  == !=
  //   4  < <= > >=
  //   5  + -
  //   6  * / %
  //   7  unary - !
  //   8  postfix: call, member, index

  function parsePrecedence(minPrec: number): Expression {
    let left = parseUnary();
    while (true) {
      const op = peek();
      const prec = infixPrec(op.kind);
      if (prec < minPrec) break;
      advance();
      const right = parsePrecedence(prec + 1);
      left = {
        kind: "BinaryExpression",
        operator: op.text,
        left,
        right,
        span: mergeSpan(left.span, right.span),
      } as BinaryExpression;
    }
    return left;
  }

  function infixPrec(kind: TokenKind): number {
    switch (kind) {
      case "OR":      return 1;
      case "AND":     return 2;
      case "EQ_EQ":
      case "BANG_EQ": return 3;
      case "LT": case "LT_EQ":
      case "GT": case "GT_EQ": return 4;
      case "PLUS":
      case "MINUS":   return 5;
      case "STAR":
      case "SLASH":
      case "PERCENT": return 6;
      default:        return -1;
    }
  }

  function parseUnary(): Expression {
    const t = peek();
    if (t.kind === "MINUS" || t.kind === "BANG") {
      advance();
      const operand = parseUnary();
      return {
        kind: "UnaryExpression",
        operator: t.text as "-" | "!",
        operand,
        span: mergeSpan(span(t), operand.span),
      } as UnaryExpression;
    }
    return parsePostfix();
  }

  function parsePostfix(): Expression {
    let expr = parsePrimary();
    while (true) {
      if (at("DOT")) {
        advance();
        const prop = expect("IDENTIFIER", "PE001", "Expected property name after '.'");
        expr = { kind: "MemberExpression", object: expr, property: prop.text, span: mergeSpan(expr.span, span(prop)) } as MemberExpression;
      } else if (at("LPAREN")) {
        const args = parseArgList();
        expr = { kind: "CallExpression", callee: expr, args: args.args, span: mergeSpan(expr.span, args.span) } as CallExpression;
      } else if (at("LBRACKET")) {
        advance();
        const index = parseExpression();
        const rb = expect("RBRACKET", "PE003", "Expected ']'");
        expr = { kind: "IndexExpression", object: expr, index, span: mergeSpan(expr.span, span(rb)) } as IndexExpression;
      } else {
        break;
      }
    }
    return expr;
  }

  function parseArgList(): { args: Expression[]; span: SourceSpan } {
    const lp = advance(); // LPAREN
    const args: Expression[] = [];
    skipNewlines();
    while (!at("RPAREN") && !at("EOF")) {
      args.push(parseExpression());
      skipNewlines();
      if (!eat("COMMA")) break;
      skipNewlines();
    }
    const rp = expect("RPAREN", "PE003", "Expected ')' to close argument list");
    return { args, span: mergeSpan(span(lp), span(rp)) };
  }

  function parsePrimary(): Expression {
    skipNewlines();
    const t = peek();

    // if-expression: `if cond ... end` used as an expression value
    if (t.kind === "IF_KW") {
      return parseIfExpression();
    }

    switch (t.kind) {
      case "INT_LIT": {
        advance();
        // Compiler & Runtime Stabilization FIX — confirmed real, Category
        // A (Critical) bug: `Number(t.text)` silently loses precision for
        // any integer literal beyond JS's own float64 exact-integer limit
        // (`Number.MAX_SAFE_INTEGER`, 2^53-1) — NOT only for genuinely
        // out-of-i64-range values. Confirmed directly: a realistic
        // nanosecond timestamp (`1700000000123456789`) and even
        // `2^53 + 1` (a perfectly ordinary, in-range i64 value) both
        // silently corrupted to a DIFFERENT, wrong number, with zero
        // diagnostic — genuine silent data corruption, not merely a
        // rare overflow edge case.
        //
        // DECISION (explicit, recorded): the full, correct fix requires
        // changing `IntLiteral.value` from `number` to `bigint` and
        // threading real 64-bit precision through the ENTIRE pipeline
        // (TypeChecker, constant-folding, Lowering, C emission) — a
        // genuinely larger change, deferred to a future version per
        // explicit reviewer decision (see the standing
        // ENGINEERING TODO below). For v1.0: reject any literal whose
        // exact value cannot be represented safely, rather than silently
        // continuing with a corrupted one — silent data corruption is
        // unacceptable regardless of how rare the triggering value is;
        // an explicit, clear rejection is always preferable.
        //
        // The check itself uses BigInt (exact, arbitrary-precision)
        // against the RAW literal text — never `Number()` — so the
        // check itself cannot suffer the same precision loss it exists
        // to catch. Applies uniformly to decimal/hex/binary forms
        // (BigInt() parses all three correctly) and to both the exact
        // boundary and beyond (`2^53-1` accepted, `2^53` rejected,
        // matching the exact boundary requested).
        //
        // ENGINEERING TODO (recorded per explicit request, not just an
        // inline comment easy to lose track of — see also
        // UR_LANGUAGE_VERSION_MATRIX.md for where deferred-feature
        // decisions are tracked): full, exact i64 precision for every
        // legal integer literal (not just those under 2^53-1) requires
        // converting `IntLiteral.value` (ast.ts) to `bigint` and
        // updating every consumer (TypeChecker's constant evaluation,
        // the Optimizer's constant-folding pass, Lowering's `const`
        // instruction construction, and the C Backend's literal
        // emission) to use exact bigint arithmetic instead of `number`
        // throughout. Scoped as its own, dedicated future item — not
        // attempted in this fix, which only prevents silent corruption
        // for the range this compiler cannot yet represent exactly.
        let magnitude: bigint;
        try {
          magnitude = BigInt(t.text);
        } catch {
          magnitude = BigInt(Number.MAX_SAFE_INTEGER) + 1n; // malformed text — treat as unsafe, fall through to the same clear rejection
        }
        if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
          addError("PE011", `Integer literal exceeds the compiler's safe precision limit (2^53-1 = ${Number.MAX_SAFE_INTEGER}). This literal cannot be written directly in source and is rejected rather than silently corrupted. Workaround: compute the value via arithmetic instead of a literal (e.g. 'let x: int = 9007199254740000 + 993' instead of writing the full number directly) - values PRODUCED by int arithmetic at runtime are exact and unaffected by this limit; only literals WRITTEN directly in source code are restricted. Full 64-bit integer literal precision is planned for a future version.`, t);
          return { kind: "IntLiteral", value: 0, raw: t.text, span: span(t) } as IntLiteral;
        }
        const v = t.text.startsWith("0x") ? parseInt(t.text, 16)
                : t.text.startsWith("0b") ? parseInt(t.text, 2)
                : Number(t.text);
        return { kind: "IntLiteral", value: v, raw: t.text, span: span(t) } as IntLiteral;
      }
      case "FLOAT_LIT": {
        advance();
        return { kind: "FloatLiteral", value: parseFloat(t.text), raw: t.text, span: span(t) } as FloatLiteral;
      }
      case "STRING_LIT": {
        advance();
        return { kind: "StringLiteral", value: t.text, raw: t.text, span: span(t) } as StringLiteral;
      }
      case "CHAR_LIT": {
        advance();
        return { kind: "CharLiteral", value: t.text, raw: t.text, span: span(t) } as CharLiteral;
      }
      case "TRUE_LIT":  { advance(); return { kind: "BoolLiteral", value: true,  span: span(t) } as BoolLiteral; }
      case "FALSE_LIT": { advance(); return { kind: "BoolLiteral", value: false, span: span(t) } as BoolLiteral; }
      case "NULL_LIT":  { advance(); return { kind: "NullLiteral", span: span(t) } as NullLiteral; }
      case "LBRACKET": {
        // Array literal: `[1, 2, 3]` — LANGUAGE_SYNTAX_1_1_SPEC.md §1.1.
        const open = advance(); // '['
        skipNewlines();
        const elements: Expression[] = [];
        while (!at("RBRACKET") && !at("EOF")) {
          elements.push(parseExpression());
          skipNewlines();
          if (!eat("COMMA")) break;
          skipNewlines();
        }
        const close = expect("RBRACKET", "PE003", "Expected ']' to close array literal");
        return { kind: "ArrayLiteral", elements, span: { startLine: span(open).startLine, startColumn: span(open).startColumn, endLine: span(close).endLine, endColumn: span(close).endColumn } } as ArrayLiteral;
      }
      case "IDENTIFIER": {
        advance();
        return { kind: "Identifier", name: t.text, span: span(t) } as Identifier;
      }
      case "LPAREN": {
        advance();
        const inner = parseExpression();
        expect("RPAREN", "PE003", "Expected ')'");
        return inner;
      }
      default: {
        addError("PE001", `Expected expression, got '${t.text}' (${t.kind})`, t);
        // CRITICAL: must always consume at least one token here, or any
        // caller looping while parsing expressions (e.g. parseExpressionStatement,
        // parseBlock) will spin forever on the same unexpected token.
        if (!at("EOF")) advance();
        return { kind: "NullLiteral", span: span(t) } as NullLiteral;
      }
    }
  }

  /**
   * Parses `if cond NEWLINE ... [else NEWLINE ...] end` as a
   * ConditionalExpression when used in an expression context (§5.6).
   */
  function parseIfExpression(): Expression {
    const kw = advance(); // IF_KW
    skipNewlines();
    const condition = parseExpression();
    eat("NEWLINE");

    // Parse the then-branch as a single expression value (last expr in block)
    const thenStmts: Statement[] = [];
    skipNewlines();
    while (!at("EOF") && !at("END_KW") && !at("ELSE_KW")) {
      const before = pos;
      const s = parseStatement();
      if (s) thenStmts.push(s);
      skipNewlines();
      if (pos === before && !at("EOF")) advance();
    }
    const thenVal = stmtsToExpr(thenStmts, kw);

    if (at("ELSE_KW")) {
      advance();
      eat("NEWLINE");
      const elseStmts: Statement[] = [];
      skipNewlines();
      while (!at("EOF") && !at("END_KW")) {
        const before = pos;
        const s = parseStatement();
        if (s) elseStmts.push(s);
        skipNewlines();
        if (pos === before && !at("EOF")) advance();
      }
      const elseVal = stmtsToExpr(elseStmts, kw);
      const end = expect("END_KW", "PE002", "Expected 'end'/'نهاية' to close if expression");
      eat("NEWLINE");
      return {
        kind: "ConditionalExpression",
        condition,
        consequent: thenVal,
        alternate: elseVal,
        span: mergeSpan(span(kw), span(end)),
      } as ConditionalExpression;
    }

    const end = expect("END_KW", "PE002", "Expected 'end'/'نهاية' to close if expression");
    eat("NEWLINE");
    return {
      kind: "ConditionalExpression",
      condition,
      consequent: thenVal,
      alternate: { kind: "NullLiteral", span: span(end) } as NullLiteral,
      span: mergeSpan(span(kw), span(end)),
    } as ConditionalExpression;
  }

  /** Extract the last expression from a list of statements for if-expression values. */
  function stmtsToExpr(stmts: Statement[], fallbackTok: Token): Expression {
    if (stmts.length === 0) return { kind: "NullLiteral", span: span(fallbackTok) } as NullLiteral;
    const last = stmts[stmts.length - 1]!;
    if (last.kind === "ExpressionStatement") return last.expression;
    return { kind: "NullLiteral", span: last.span } as NullLiteral;
  }

  function parseExpression(): Expression {
    return parsePrecedence(1);
  }

  // ── Struct declaration (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2.1) ───────
  //
  //   struct Point
  //     x: int
  //     y: int
  //   end
  //
  // Reuses the existing `name: type` field syntax (identical to how
  // function parameters are already parsed above) and the existing
  // block-`end` terminator pattern (identical to function/if/while).

  function parseTypeAliasDecl(): TypeAliasDecl {
    const kw = advance(); // TYPE_KW
    skipNewlines();
    const nameTok = expect("IDENTIFIER", "PE005", "Expected type name after 'type'/'نوع'");
    expect("EQ", "PE003", "Expected '=' after type alias name");
    skipNewlines();
    // Per §5.11's own grammar: type_body := LBRACE field_list RBRACE (struct-like,
    // deferred to 1.1 per §11's own deferred list) | type_expr (alias — the only
    // form in v1.0's own scope). This lexer has no LBRACE token at all (this
    // project's actual struct syntax uses indentation + END_KW, not braces,
    // a minor spec/implementation naming mismatch noted here rather than
    // silently worked around) — so any non-type-expression input here
    // naturally falls through to parseTypeRef() returning undefined, and
    // this function reports that clearly rather than defaulting silently.
    const aliasedType = parseTypeRef();
    if (!aliasedType) {
      addError("PE008", "Expected a type after '=' in type alias declaration (struct-like 'type NAME = ...' bodies are deferred to Specification 1.1, per §11 — only 'type NAME = <type>' aliases are supported in v1.0)", peek());
      syncTo("NEWLINE", "EOF", "END_KW", "FUNCTION_KW", "TYPE_KW");
      return { kind: "TypeAliasDecl", name: nameTok.text, aliasedType: { kind: "TypeRef", name: "int", span: span(nameTok) }, span: span(kw) } as TypeAliasDecl;
    }
    const declSpan = { ...span(kw), endLine: aliasedType.span.endLine, endColumn: aliasedType.span.endColumn };
    return { kind: "TypeAliasDecl", name: nameTok.text, aliasedType, span: declSpan } as TypeAliasDecl;
  }

  function parseStructDecl(): StructDecl {
    const kw = advance(); // STRUCT_KW
    skipNewlines();
    const nameTok = expect("IDENTIFIER", "PE005", "Expected struct name after 'struct'/'بنية'");
    eat("NEWLINE");
    skipNewlines();

    const fields: StructField[] = [];
    while (!at("END_KW") && !at("EOF")) {
      const before = pos;
      const fNameTok = expect("IDENTIFIER", "PE001", "Expected field name");
      expect("COLON", "PE003", "Expected ':' after field name");
      const fType = parseTypeRef();
      const fieldSpan = fType ? { ...span(fNameTok), endLine: fType.span.endLine, endColumn: fType.span.endColumn } : span(fNameTok);
      fields.push({
        kind: "StructField",
        name: fNameTok.text,
        type: fType ?? { kind: "TypeRef", name: "<error>", span: span(fNameTok) },
        span: fieldSpan,
      });
      skipNewlines();
      // CONFIRMED BUG (fixed): expect() does not consume the current token
      // on failure ("don't consume — let caller recover"). Without this
      // guard, a malformed field (e.g. a non-identifier token where a
      // field name is expected) leaves `pos` completely unchanged across
      // the entire loop body, so the loop condition never becomes false —
      // a genuine infinite loop, confirmed via direct reproduction
      // (timeout-killed after 5s in isolation; caused a real JS heap
      // exhaustion crash in tests/lsp/lsp.test.ts). Mirrors the identical
      // guard already used in parseBlock() and the top-level Program loop.
      if (pos === before && !at("EOF")) advance();
    }
    const end = expect("END_KW", "PE002", "Expected 'end'/'نهاية' to close struct");
    eat("NEWLINE");

    return {
      kind: "StructDecl",
      name: nameTok.text,
      fields,
      span: { startLine: span(kw).startLine, startColumn: span(kw).startColumn, endLine: span(end).endLine, endColumn: span(end).endColumn },
    };
  }

  // ── Top-level declarations ─────────────────────────────────────────────────

  function parseFunctionDecl(): FunctionDecl {
    const kw = advance(); // FUNCTION_KW
    skipNewlines();
    const nameTok = expect("IDENTIFIER", "PE005", "Expected function name after 'function'/'دالة'");
    expect("LPAREN", "PE003", "Expected '(' after function name");

    const params: Param[] = [];
    skipNewlines();
    while (!at("RPAREN") && !at("EOF")) {
      const pName = expect("IDENTIFIER", "PE001", "Expected parameter name");
      let pType: TypeRef | undefined;
      if (eat("COLON")) { pType = parseTypeRef(); }
      params.push({ kind: "Param", name: pName.text, type: pType, span: span(pName) });
      skipNewlines();
      if (!eat("COMMA")) break;
      skipNewlines();
    }
    expect("RPAREN", "PE003", "Expected ')' to close parameter list");

    let returnType: TypeRef | undefined;
    if (eat("COLON")) { returnType = parseTypeRef(); }

    eat("NEWLINE");
    const body = parseBlock("function");
    const end = expect("END_KW", "PE002", "Expected 'end'/'نهاية' to close function");
    eat("NEWLINE");

    return {
      kind: "FunctionDecl",
      name: nameTok.text,
      params,
      returnType,
      body,
      span: mergeSpan(span(kw), span(end)),
    };
  }

  function parseImportDecl(): ImportDecl {
    const kw = advance(); // IMPORT_KW
    skipNewlines();
    const parts: string[] = [];
    const first = expect("IDENTIFIER", "PE001", "Expected module name after 'import'/'استورد'");
    parts.push(first.text);
    let lastTok = first;
    while (at("DOT")) {
      advance();
      const part = expect("IDENTIFIER", "PE001", "Expected identifier after '.'");
      parts.push(part.text);
      lastTok = part;
    }
    eat("NEWLINE");
    return { kind: "ImportDecl", path: parts, span: mergeSpan(span(kw), span(lastTok)) };
  }

  // ── Program ───────────────────────────────────────────────────────────────

  const programImports: ImportDecl[] = [];
  const programFunctions: FunctionDecl[] = [];
  const programStructs: StructDecl[] = [];
  const programTypeAliases: TypeAliasDecl[] = [];
  const programGlobals: GlobalVariableDecl[] = [];
  const programBody: Statement[] = [];

  while (!at("EOF")) {
    skipNewlines();
    if (at("EOF")) break;
    const t = peek();
    const before = pos;

    try {
      if (t.kind === "IMPORT_KW") {
        programImports.push(parseImportDecl());
      } else if (t.kind === "FUNCTION_KW") {
        programFunctions.push(parseFunctionDecl());
      } else if (t.kind === "STRUCT_KW") {
        programStructs.push(parseStructDecl());
      } else if (t.kind === "TYPE_KW") {
        programTypeAliases.push(parseTypeAliasDecl());
      } else if (t.kind === "IDENTIFIER" && isModifierChainBeforeDeclaration()) {
        // FIX (Compiler & Runtime Stabilization — found via adversarial
        // audit, SIMULATED_AUDIT_REPORT.md Finding 1, classified
        // "Regression Against Documented Diagnostic Contract"): the prior
        // version of this check only looked ONE token ahead
        // (peekSkipNL(1)) — for a SINGLE modifier ("async function...")
        // this correctly found FUNCTION_KW next and fired. But for
        // STACKED modifiers ("async const function..."), peekSkipNL(1)
        // from "async" sees "const" (another bare IDENTIFIER, not a
        // declaration keyword) — so the check never fired for "async" at
        // all, silently swallowing it as a meaningless expression
        // statement (confirmed directly: it ended up in program.body as
        // an orphaned Identifier node) — exactly the defect class PE009/
        // PE010 were built to eliminate, surviving specifically for 2+
        // stacked modifiers. isModifierChainBeforeDeclaration() (below)
        // now scans forward through the ENTIRE chain of consecutive bare
        // identifiers before committing to this branch, so every word in
        // the chain gets its own PE010, not just the one immediately
        // before the keyword.
        while (peek().kind === "IDENTIFIER") {
          addError("PE010", `'${peek().text}' is not a recognized modifier in UR 1.0 — declarations do not support modifiers yet. This feature is planned for a future version.`, peek());
          advance();
        }
        // Deliberately do NOT consume the following declaration keyword —
        // let it parse normally afterward via its own existing branch, so
        // the declaration's own body is still checked/compiled (matching
        // this project's own "don't lose more than the invalid part"
        // recovery philosophy) — just without the (unsupported) modifier
        // chain silently applied, and with a diagnostic for every word.
      } else if (t.kind === "IDENTIFIER" && t.text === "enum" && peekSkipNL(1).kind === "IDENTIFIER") {
        // Per FINAL_CONSISTENCY_REVIEW.md's finding: `enum` is not a
        // reserved keyword (no ENUM_KW exists), so without this check it
        // silently parses as a sequence of meaningless bare-identifier
        // expression statements — zero diagnostic anywhere, the user's
        // declaration is discarded with no indication anything is wrong.
        // This is a diagnostics fix (per explicit instruction), not a new
        // feature: `enum` remains unimplemented, but attempting it now
        // produces a clear, correct message instead of silent success.
        addError("PE009", "enum declarations are not supported in UR 1.0. This feature is planned for a future version.", t);
        advance(); // 'enum'
        advance(); // the enum's name
        eat("NEWLINE");
        syncTo("END_KW", "EOF", "FUNCTION_KW", "TYPE_KW", "STRUCT_KW");
        eat("END_KW");
        eat("NEWLINE");
      } else if (t.kind === "LET_KW") {
        const decl = parseLetStatement();
        programGlobals.push({ ...decl, kind: "GlobalVariableDecl", isConst: false });
      } else {
        const stmt = parseStatement();
        if (stmt) programBody.push(stmt);
      }
    } catch (e) {
      addError("PE004", `Unexpected error: ${e instanceof Error ? e.message : String(e)}`, t);
      syncTo("NEWLINE", "EOF", "END_KW", "FUNCTION_KW", "IMPORT_KW");
      eat("NEWLINE");
    }
    if (pos === before && !at("EOF")) advance();
  }

  const program: Program = {
    kind: "Program",
    modules: [],
    functions: programFunctions,
    structs: programStructs,
    typeAliases: programTypeAliases,
    globals: programGlobals,
    imports: programImports,
    body: programBody,
    span: {
      startLine: 1, startColumn: 1,
      endLine: peek().span.endLine,
      endColumn: peek().span.endCol,
    },
  };

  return { program, errors };
}
