// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Semantic Analyzer: Symbol Table
//
// Defines Symbol (a named, typed declaration) and ScopeTree (a linked chain
// of scopes built during semantic analysis). Used by:
//   - NameResolver    (src/semantic/name-resolver.ts)
//   - FunctionChecker (src/semantic/function-checker.ts)
//   - SemanticAnalyzer (src/semantic/index.ts)
//
// No dependency on src/compiler, src/runtime, or src/cli.
// ─────────────────────────────────────────────────────────────────────────────

import type { SourceSpan } from "../frontend/ast.js";

// ── Symbol kinds ──────────────────────────────────────────────────────────────

export type SymbolKind =
  | "variable"    // let / const declarations
  | "parameter"   // function parameters
  | "function"    // fn declarations
  | "module"      // module declarations
  | "import";     // import aliases

export interface Symbol {
  name: string;
  kind: SymbolKind;
  /** Whether the binding is immutable (const / parameter). */
  isConst: boolean;
  /** Declared type annotation (may be undefined if inferred). */
  declaredType?: string | undefined;
  /** Number of parameters, for function symbols. */
  arity?: number | undefined;
  /** Source location of the declaration. */
  span: SourceSpan;
}

// ── Scope ─────────────────────────────────────────────────────────────────────

export class Scope {
  private symbols = new Map<string, Symbol>();
  readonly parent: Scope | undefined;
  readonly name: string;

  constructor(name: string, parent?: Scope) {
    this.name = name;
    this.parent = parent;
  }

  /** Declares a symbol in this scope. Returns the existing symbol if already
   *  declared (caller must report the duplicate-definition error). */
  declare(sym: Symbol): Symbol | undefined {
    const existing = this.symbols.get(sym.name);
    if (existing) return existing;
    this.symbols.set(sym.name, sym);
    return undefined;
  }

  /** Looks up a name in this scope only (not ancestors). */
  lookupOwn(name: string): Symbol | undefined {
    return this.symbols.get(name);
  }

  /** Looks up a name in this scope and all ancestor scopes. */
  lookup(name: string): Symbol | undefined {
    return this.symbols.get(name) ?? this.parent?.lookup(name);
  }

  /** All symbols declared directly in this scope. */
  ownSymbols(): Symbol[] {
    return Array.from(this.symbols.values());
  }
}

// ── ScopeTree ─────────────────────────────────────────────────────────────────

/**
 * Manages the stack of lexical scopes during a single analysis pass.
 *
 * Usage:
 *   tree.push("fn:add")      // enter a new scope (e.g. function body)
 *   tree.declare(sym)         // declare a symbol in the current scope
 *   tree.lookup("x")          // resolve a name through the scope chain
 *   tree.pop()                // exit the current scope
 */
export class ScopeTree {
  private stack: Scope[] = [];

  /** The global (file-level) scope, always available. */
  readonly global: Scope;

  constructor() {
    this.global = new Scope("global");
    this.stack.push(this.global);
  }

  get current(): Scope {
    return this.stack[this.stack.length - 1]!;
  }

  push(name: string): Scope {
    const child = new Scope(name, this.current);
    this.stack.push(child);
    return child;
  }

  pop(): Scope {
    if (this.stack.length <= 1) {
      throw new Error("ScopeTree.pop(): cannot pop the global scope");
    }
    return this.stack.pop()!;
  }

  /** Declare a symbol in the current scope. Returns the conflicting symbol
   *  if one already exists in this scope, undefined on success. */
  declare(sym: Symbol): Symbol | undefined {
    return this.current.declare(sym);
  }

  /** Resolve a name through the current scope chain. */
  lookup(name: string): Symbol | undefined {
    return this.current.lookup(name);
  }

  depth(): number {
    return this.stack.length;
  }
}
