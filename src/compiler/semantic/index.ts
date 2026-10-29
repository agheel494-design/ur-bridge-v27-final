// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Semantic Analyzer (Phase 1.3)
//
// Takes a parsed, structurally-valid Program AST (from src/frontend/parser +
// src/frontend/validator) and performs semantic analysis in two passes:
//
//   Pass 1 — Hoist declarations
//     Registers all top-level function names and global variables into the
//     global scope before any expressions are analysed. This lets functions
//     be called before they are textually defined (mutual recursion).
//
//   Pass 2 — Resolve and check
//     Walks the full AST, resolving every Identifier to a Symbol, detecting:
//       - Undefined symbols (SE1001)
//       - Undefined functions (SE1002)
//       - Duplicate definitions (SE2001–SE2004)
//       - Arity mismatches (SE3001)
//       - Assignments to const / parameter bindings (SE4001/SE4002)
//       - break/continue outside a loop (SE5001/SE5002)
//       - Import aliases duplicating another name (SE2004)
//
// Boundary: this module MUST NOT import from src/compiler, src/runtime,
// src/cli, or src/lsp.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Program, FunctionDecl, Param,
  Statement, BlockStatement, Assignment,
  IfStatement,
  Expression, Identifier, CallExpression,
  StructField,
  SourceSpan,
} from "../frontend/ast.js";

import { ScopeTree } from "./symbol-table.js";
import { CODES, makeResult, type SemanticDiagnostic, type SemanticResult } from "./diagnostics.js";
import { lookupBuiltin } from "./builtins-registry.js";

// ── Analyzer class ────────────────────────────────────────────────────────────

class SemanticAnalyzer {
  private diags: SemanticDiagnostic[] = [];
  private scopes = new ScopeTree();
  private loopDepth = 0;
  // BUG-SA-001 fix: functionDepth tracks whether we're currently
  // inside a function body, the exact same pattern already used for
  // loopDepth (break/continue outside a loop). Confirmed via direct
  // pipeline trace (PIPELINE_TRACE_MAP.md) that `return` outside any
  // function previously passed through every stage with zero
  // diagnostics, all the way to a successful IR build.
  private functionDepth = 0;
  /** Level 2.8 Struct Registry — name -> field list, populated during hoisting. Consulted by walkCall() for struct construction (LANGUAGE_SYNTAX_1_1_SPEC.md §2.7), after the Symbol Table and before SE1002. */
  private structRegistry = new Map<string, { fields: StructField[]; span: SourceSpan }>();
  /**
   * Real cross-module wiring (Blocker 1, per explicit direction):
   * names of functions exported by modules this program imports,
   * pre-resolved by the caller (typically via ModuleRegistry) and
   * passed in explicitly. Consulted by walkCall() immediately before
   * SE1002 - if a call target isn't a local symbol, builtin, or
   * struct, but IS a known external function name, no error is
   * raised. This is a real, minimal, backward-compatible addition:
   * the constructor parameter is optional and defaults to an empty
   * set, so every existing call site (single-file analysis) behaves
   * exactly as before.
   */
  private readonly externalFunctionNames: ReadonlySet<string>;

  constructor(externalFunctionNames: ReadonlySet<string> = new Set()) {
    this.externalFunctionNames = externalFunctionNames;
  }

  // ── Diagnostics helpers ───────────────────────────────────────────────────

  private err(
    code: string,
    message: string,
    span: SourceSpan,
    related?: Array<{ message: string; span: SourceSpan }>,
  ): void {
    this.diags.push({ severity: "error", code, message, span, related });
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  analyze(program: Program): SemanticResult {
    // Pass 1: hoist top-level declarations
    this.hoistProgram(program);
    // Pass 2: full walk
    this.walkProgram(program);
    return makeResult(this.diags);
  }

  // ── Pass 1: Hoisting ──────────────────────────────────────────────────────

  private hoistProgram(program: Program): void {
    // Module names
    for (const mod of program.modules) {
      const conflict = this.scopes.declare({
        name: mod.name, kind: "module", isConst: true, span: mod.span,
      });
      if (conflict) {
        this.err(CODES.DUPLICATE_MODULE,
          `duplicate module name '${mod.name}'`, mod.span,
          [{ message: "previously declared here", span: conflict.span }]);
      }
    }

    // Import aliases
    for (const imp of program.imports) {
      const name = imp.alias ?? imp.path[imp.path.length - 1] ?? imp.path.join(".");
      const conflict = this.scopes.declare({
        name, kind: "import", isConst: true, span: imp.span,
      });
      if (conflict) {
        this.err(CODES.DUPLICATE_FUNCTION,
          `duplicate import name '${name}'`, imp.span,
          [{ message: "previously declared here", span: conflict.span }]);
      }
    }

    // Global variables
    for (const g of program.globals) {
      const conflict = this.scopes.declare({
        name: g.name,
        kind: "variable",
        isConst: g.isConst,
        declaredType: g.type?.name,
        span: g.span,
      });
      if (conflict) {
        this.err(CODES.DUPLICATE_VARIABLE,
          `duplicate global variable '${g.name}'`, g.span,
          [{ message: "previously declared here", span: conflict.span }]);
      }
    }

    // Struct declarations (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2) —
    // registered in a dedicated Struct Registry, NOT the Symbol Table
    // (structs are types, not values/functions; walkCall consults this
    // registry separately, after the Symbol Table, for construction
    // calls like `Point(1, 2)` — §2.7).
    const PRIMITIVE_FIELD_TYPES = new Set(["int", "float", "bool", "string"]);
    for (const s of program.structs) {
      if (this.structRegistry.has(s.name)) {
        const existing = this.structRegistry.get(s.name)!;
        this.err(CODES.DUPLICATE_STRUCT,
          `duplicate struct '${s.name}'`, s.span,
          [{ message: "previously declared here", span: existing.span }]);
        continue;
      }
      const seenFields = new Map<string, StructField>();
      for (const field of s.fields) {
        const dup = seenFields.get(field.name);
        if (dup) {
          this.err(CODES.DUPLICATE_FIELD,
            `duplicate field '${field.name}' in struct '${s.name}'`, field.span,
            [{ message: "previously declared here", span: dup.span }]);
          continue;
        }
        seenFields.set(field.name, field);
        // §2.6: fields must be primitive scalar types — no nested
        // structs, no array-typed fields (arrayDepth would be set for
        // an array-typed field; a name not in the primitive set could
        // be another struct name or an unknown type — either way,
        // rejected here for this phase).
        if (field.type.arrayDepth || !PRIMITIVE_FIELD_TYPES.has(field.type.name)) {
          this.err(CODES.INVALID_FIELD_TYPE,
            `field '${field.name}' of struct '${s.name}' must be a primitive scalar type (int, float, bool, string) — nested structs and array fields are deferred (LANGUAGE_SYNTAX_1_1_SPEC.md §2.6)`,
            field.span);
        }
      }
      this.structRegistry.set(s.name, { fields: s.fields, span: s.span });
    }

    // Function names (with arity, for call-site checking)
    for (const fn of program.functions) {
      const conflict = this.scopes.declare({
        name: fn.name, kind: "function", isConst: true,
        arity: fn.params.length, span: fn.span,
      });
      if (conflict) {
        this.err(CODES.DUPLICATE_FUNCTION,
          `duplicate function '${fn.name}'`, fn.span,
          [{ message: "previously declared here", span: conflict.span }]);
      }
    }
  }

  // ── Pass 2: Walk ──────────────────────────────────────────────────────────

  private walkProgram(program: Program): void {
    for (const g of program.globals) {
      if (g.initializer) this.walkExpr(g.initializer);
    }
    for (const fn of program.functions) {
      this.walkFunction(fn);
    }
    // REAL ROOT CAUSE FOUND while verifying the BUG-SA-001 fix:
    // program.body (top-level/script-mode statements, outside any
    // function) was never visited by walkProgram at all - so the
    // functionDepth check added to walkStatement's own
    // ReturnStatement case was correct but never actually executed
    // for this exact case. This loop is the real fix: walk body's
    // own statements too, at functionDepth 0 (we are, correctly,
    // not inside any function here).
    for (const stmt of program.body) {
      this.walkStatement(stmt);
    }
  }

  private walkFunction(fn: FunctionDecl): void {
    this.scopes.push(`fn:${fn.name}`);

    // Declare parameters in the function scope
    const seenParams = new Map<string, Param>();
    for (const param of fn.params) {
      const prev = seenParams.get(param.name);
      if (prev) {
        this.err(CODES.DUPLICATE_PARAM,
          `duplicate parameter '${param.name}' in function '${fn.name}'`, param.span,
          [{ message: "previously declared here", span: prev.span }]);
        continue;
      }
      seenParams.set(param.name, param);
      this.scopes.declare({
        name: param.name, kind: "parameter", isConst: true,
        declaredType: param.type?.name, span: param.span,
      });
    }

    this.functionDepth++;
    this.walkBlock(fn.body);
    this.functionDepth--;
    this.scopes.pop();
  }

  private walkBlock(block: BlockStatement): void {
    this.scopes.push("block");
    for (const stmt of block.statements) {
      this.walkStatement(stmt);
    }
    this.scopes.pop();
  }

  private walkStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "BlockStatement":
        this.walkBlock(stmt);
        break;

      case "VariableDeclaration": {
        if (stmt.initializer) this.walkExpr(stmt.initializer);
        const conflict = this.scopes.declare({
          name: stmt.name, kind: "variable", isConst: stmt.isConst,
          declaredType: stmt.type?.name, span: stmt.span,
        });
        if (conflict) {
          this.err(CODES.DUPLICATE_VARIABLE,
            `duplicate variable '${stmt.name}'`, stmt.span,
            [{ message: "previously declared here", span: conflict.span }]);
        }
        break;
      }

      case "Assignment":
        this.walkAssignment(stmt);
        break;

      case "IfStatement":
        this.walkIf(stmt);
        break;

      case "WhileStatement":
        this.walkExpr(stmt.condition);
        this.loopDepth++;
        this.walkBlock(stmt.body);
        this.loopDepth--;
        break;

      case "ForStatement":
        this.walkExpr(stmt.iterable);
        this.loopDepth++;
        this.scopes.push("for");
        this.scopes.declare({
          name: stmt.binding, kind: "variable", isConst: false, span: stmt.span,
        });
        this.walkBlock(stmt.body);
        this.scopes.pop();
        this.loopDepth--;
        break;

      case "SwitchStatement":
        this.walkExpr(stmt.discriminant);
        for (const c of stmt.cases) {
          if (c.test) this.walkExpr(c.test);
          this.scopes.push("case");
          for (const s of c.body) this.walkStatement(s);
          this.scopes.pop();
        }
        break;

      case "TryCatchStatement":
        this.walkBlock(stmt.tryBlock);
        if (stmt.catchBlock) {
          this.scopes.push("catch");
          if (stmt.catchParam) {
            this.scopes.declare({
              name: stmt.catchParam, kind: "variable", isConst: false, span: stmt.span,
            });
          }
          this.walkBlock(stmt.catchBlock);
          this.scopes.pop();
        }
        if (stmt.finallyBlock) this.walkBlock(stmt.finallyBlock);
        break;

      case "BreakStatement":
        if (this.loopDepth === 0) {
          this.err(CODES.BREAK_OUTSIDE_LOOP, "'break' outside of a loop", stmt.span);
        }
        break;

      case "ContinueStatement":
        if (this.loopDepth === 0) {
          this.err(CODES.CONTINUE_OUTSIDE_LOOP, "'continue' outside of a loop", stmt.span);
        }
        break;

      case "ReturnStatement":
        if (this.functionDepth === 0) {
          this.err(CODES.RETURN_OUTSIDE_FN, "'return' outside of a function", stmt.span);
        }
        if (stmt.value) this.walkExpr(stmt.value);
        break;

      case "ExpressionStatement":
        this.walkExpr(stmt.expression);
        break;
    }
  }

  private walkAssignment(stmt: Assignment): void {
    this.walkExpr(stmt.value);
    // Check the target is resolvable, and not a const/param (for simple identifiers)
    if (stmt.target.kind === "Identifier") {
      const sym = this.scopes.lookup(stmt.target.name);
      if (!sym) {
        this.err(CODES.UNDEFINED_SYMBOL,
          `undefined variable '${stmt.target.name}'`, stmt.target.span);
      } else if (sym.kind === "parameter") {
        this.err(CODES.ASSIGN_TO_PARAM,
          `cannot assign to parameter '${stmt.target.name}'`, stmt.target.span,
          [{ message: "parameter declared here", span: sym.span }]);
      } else if (sym.isConst && sym.kind === "variable") {
        this.err(CODES.ASSIGN_TO_CONST,
          `cannot assign to const '${stmt.target.name}'`, stmt.target.span,
          [{ message: "const declared here", span: sym.span }]);
      }
    } else {
      this.walkExpr(stmt.target);
    }
  }

  private walkIf(stmt: IfStatement): void {
    this.walkExpr(stmt.condition);
    this.walkBlock(stmt.thenBranch);
    if (stmt.elseBranch) {
      if (stmt.elseBranch.kind === "BlockStatement") {
        this.walkBlock(stmt.elseBranch);
      } else {
        this.walkIf(stmt.elseBranch);
      }
    }
  }

  // ── Expressions ───────────────────────────────────────────────────────────

  private walkExpr(expr: Expression): void {
    switch (expr.kind) {
      case "Identifier":
        this.walkIdentifier(expr);
        break;

      case "IntLiteral":
      case "FloatLiteral":
      case "StringLiteral":
      case "BoolLiteral":
      case "NullLiteral":
        break;

      case "ArrayLiteral":
        // CONFIRMED BUG (fixed): this case was missing entirely. Since
        // walkExpr's switch has no `default` and returns void, a missing
        // case silently does nothing (no TypeScript error) — meaning any
        // undefined symbol inside an array literal (e.g. `[undefinedVar,
        // 2, 3]`) was never checked at all. Confirmed via direct
        // reproduction before this fix: zero diagnostics for a program
        // referencing a genuinely undefined variable inside `[...]`.
        for (const el of expr.elements) this.walkExpr(el);
        break;

      case "UnaryExpression":
        this.walkExpr(expr.operand);
        break;

      case "BinaryExpression":
        this.walkExpr(expr.left);
        this.walkExpr(expr.right);
        break;

      case "ConditionalExpression":
        this.walkExpr(expr.condition);
        this.walkExpr(expr.consequent);
        this.walkExpr(expr.alternate);
        break;

      case "CallExpression":
        this.walkCall(expr);
        break;

      case "MemberExpression":
        this.walkExpr(expr.object);
        break;

      case "IndexExpression":
        this.walkExpr(expr.object);
        this.walkExpr(expr.index);
        break;
    }
  }

  private walkIdentifier(id: Identifier): void {
    if (id.name === "<error>") return; // recovery placeholder — skip
    if (!this.scopes.lookup(id.name)) {
      this.err(CODES.UNDEFINED_SYMBOL, `undefined symbol '${id.name}'`, id.span);
    }
  }

  private walkCall(expr: CallExpression): void {
    // Resolve the callee
    if (expr.callee.kind === "Identifier") {
      const name = expr.callee.name;
      if (name === "<error>") {
        for (const arg of expr.args) this.walkExpr(arg);
        return;
      }
      const sym = this.scopes.lookup(name);
      if (!sym) {
        // Step 2 of resolution (Level 2.5): a generic, name-agnostic
        // lookup against the Builtins Registry (builtins-registry.ts).
        // This is NOT a special case for any specific builtin — it is
        // the exact same kind of lookup as the scope-table check above,
        // against a different table. Adding a new builtin later requires
        // zero changes here; only a new entry in that registry.
        const builtin = lookupBuiltin(name);
        if (builtin) {
          if (expr.args.length !== builtin.arity) {
            this.err(CODES.ARITY_MISMATCH,
              `function '${name}' expects ${builtin.arity} argument(s), got ${expr.args.length}`,
              expr.span);
          }
        } else {
          // Step 3 of resolution (Level 2.8): struct construction —
          // LANGUAGE_SYNTAX_1_1_SPEC.md §2.7. `Point(1, 2)` is
          // syntactically an ordinary CallExpression; if no function or
          // builtin named "Point" exists, check the Struct Registry
          // before finally falling through to SE1002. Rule 1 (strict
          // arity): argument count must exactly equal field count — no
          // default values, no partial construction.
          const struct = this.structRegistry.get(name);
          if (struct) {
            if (expr.args.length !== struct.fields.length) {
              this.err(CODES.ARITY_MISMATCH,
                `struct '${name}' has ${struct.fields.length} field(s), got ${expr.args.length} argument(s)`,
                expr.span,
                [{ message: "struct declared here", span: struct.span }]);
            }
          } else if (this.externalFunctionNames.has(name)) {
            // Real cross-module wiring (Blocker 1): a call to a
            // function exported by an imported module - not a local
            // symbol, builtin, or struct, but explicitly known to be
            // provided externally. No error - this is the exact,
            // minimal fix for the previously-logged "SE1002 despite
            // successful import resolution" gap.
          } else {
            this.err(CODES.UNDEFINED_FUNCTION, `undefined function '${name}'`, expr.callee.span);
          }
        }
      } else if (sym.kind !== "function" && sym.kind !== "import") {
        this.err(CODES.NOT_A_FUNCTION,
          `'${name}' is a ${sym.kind}, not a function`, expr.callee.span);
      } else if (sym.kind === "function" && sym.arity !== undefined) {
        if (expr.args.length !== sym.arity) {
          this.err(CODES.ARITY_MISMATCH,
            `function '${name}' expects ${sym.arity} argument(s), got ${expr.args.length}`,
            expr.span,
            [{ message: "function declared here", span: sym.span }]);
        }
      }
    } else {
      // Method / computed callee — resolve the callee expression; we can't
      // check arity for dynamic dispatch at this phase.
      this.walkExpr(expr.callee);
    }
    for (const arg of expr.args) this.walkExpr(arg);
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Performs semantic analysis on a parsed Program AST.
 * Always returns a SemanticResult (never throws).
 *
 * Expected usage:
 *   const { ast } = parse(source, file);
 *   const { valid, violations } = validateAST(ast);
 *   const semantic = analyze(ast);
 *   if (!semantic.valid) { ... }
 */
export function analyze(program: Program, externalFunctionNames?: ReadonlySet<string>): SemanticResult {
  return new SemanticAnalyzer(externalFunctionNames).analyze(program);
}
