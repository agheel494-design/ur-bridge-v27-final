// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: IncrementalLspBridge
//
// Connects the LSP server to src/compiler/incremental/ so that:
//   - Only changed documents are reanalyzed
//   - Diagnostics are derived from cached artifacts when possible
//   - The symbol table is updated only for affected files
// ─────────────────────────────────────────────────────────────────────────────

import {
  IncrementalPipeline,
  type CompilerFn,
  type CompilerFnResult,
  type PipelineOptions,
} from "../compiler/incremental/index.js";

import type { TextDocumentManager } from "./text-document-manager.js";
import type { SymbolTable } from "./symbol-table.js";
import type { DiagnosticEngine } from "./diagnostic-engine.js";
import type { UriResolver } from "./uri-resolver.js";
import { SymbolKind, type DocumentUri } from "./protocol.js";

export interface LspBuildResult {
  /** URIs that were reanalyzed. */
  reanalyzed: DocumentUri[];
  /** URIs served from cache. */
  cacheHits: DocumentUri[];
  /** Total diagnostics published. */
  diagnosticCount: number;
  /** Build duration (ms). */
  elapsedMs: number;
}

// ── Real compiler function ─────────────────────────────────────────────────
//
// CONFIRMED BUG (Verification & Recovery Mission, Stage 10): this function
// used to be a regex-based stub that scanned for RC2-era keywords
// (`fn|let|mut|struct|enum|trait|type|module` — not even UR 1.0 syntax) and
// ALWAYS returned `diagnostics: []`. This meant LspServer.onOpen()/onChange()
// NEVER surfaced any real compiler error — proven empirically: a program
// with an undefined-variable reference produced zero diagnostics through
// the actual onOpen() API. Fixed by wiring the real Lexer → Parser →
// Semantic Analyzer → Type Checker pipeline built in src/compiler/frontend,
// src/compiler/semantic, and src/compiler/typesystem.
//
// Lexer/Parser errors are reported with their own PE/LE codes; Semantic and
// TypeChecker diagnostics are merged in. All are mapped into the
// CachedDiagnostic shape the LSP's DiagnosticEngine expects.

import { lex } from "../compiler/frontend/lexer.js";
import type { Program, Statement, Expression, BlockStatement } from "../compiler/frontend/ast.js";

/** A single identifier usage found by walking the AST — the raw material for Find References. */
type RealReferenceInfo = {
  name: string;
  line: number;   // 1-based
  col: number;    // 1-based
  length: number;
};

/**
 * Walks the entire AST collecting every Identifier reference — call
 * expression callees, member-expression object roots, plain identifier
 * reads in expressions — so "Find References" can report real usages
 * instead of only ever the declaration site.
 *
 * CONFIRMED BUG (fixed): SymbolTable.addReference() was defined but never
 * called anywhere in the codebase. ReferencesProvider.provideReferences()
 * always returned an empty `refs` array (plus the declaration itself when
 * includeDeclaration was true), making Find References non-functional for
 * any real usage. Proven empirically on a real multi-file project: a
 * function called from a different line always reported exactly 1
 * reference (the declaration), never the call site.
 */
function collectReferences(program: Program): RealReferenceInfo[] {
  const refs: RealReferenceInfo[] = [];

  function visitExpr(e: Expression | undefined): void {
    if (!e) return;
    switch (e.kind) {
      case "Identifier":
        refs.push({ name: e.name, line: e.span.startLine, col: e.span.startColumn, length: e.name.length });
        break;
      case "CallExpression":
        visitExpr(e.callee);
        for (const a of e.args) visitExpr(a);
        break;
      case "MemberExpression":
        visitExpr(e.object);
        break;
      case "IndexExpression":
        visitExpr(e.object);
        visitExpr(e.index);
        break;
      case "UnaryExpression":
        visitExpr(e.operand);
        break;
      case "BinaryExpression":
        visitExpr(e.left);
        visitExpr(e.right);
        break;
      case "ConditionalExpression":
        visitExpr(e.condition);
        visitExpr(e.consequent);
        visitExpr(e.alternate);
        break;
      default:
        break; // literals — nothing to reference
    }
  }

  function visitBlock(b: BlockStatement | undefined): void {
    if (!b) return;
    for (const s of b.statements) visitStmt(s);
  }

  function visitStmt(s: Statement): void {
    switch (s.kind) {
      case "VariableDeclaration":
        visitExpr(s.initializer);
        break;
      case "Assignment":
        // The target's own leading identifier is a usage too (e.g. `x = 1`
        // references `x`; `obj.field = 1` references `obj`).
        visitExpr(s.target);
        visitExpr(s.value);
        break;
      case "IfStatement":
        visitExpr(s.condition);
        visitBlock(s.thenBranch);
        if (s.elseBranch) {
          if (s.elseBranch.kind === "IfStatement") visitStmt(s.elseBranch);
          else visitBlock(s.elseBranch);
        }
        break;
      case "WhileStatement":
        visitExpr(s.condition);
        visitBlock(s.body);
        break;
      case "ForStatement":
        visitExpr(s.iterable);
        visitBlock(s.body);
        break;
      case "ReturnStatement":
        visitExpr(s.value);
        break;
      case "ExpressionStatement":
        visitExpr(s.expression);
        break;
      default:
        break; // BreakStatement/ContinueStatement/BlockStatement (top-level) — nothing to visit
    }
  }

  for (const fn of program.functions) {
    for (const p of fn.params) {
      // Parameters are declaration sites, not usages — intentionally skipped.
      void p;
    }
    visitBlock(fn.body);
  }
  for (const g of program.globals) {
    visitExpr(g.initializer);
  }

  return refs;
}

import { parse } from "../compiler/frontend/parser.js";
import { analyze } from "../compiler/semantic/index.js";
import { typeCheck } from "../compiler/typesystem/checker.js";
import type { CachedDiagnostic } from "../compiler/incremental/build-cache.js";

function toLspSeverity(sev: "error" | "warning" | "note"): "error" | "warning" | "info" {
  return sev === "note" ? "info" : sev;
}

/** Real symbol info derived from the AST — name, kind, and true source span. */
type RealSymbolInfo = {
  name: string;
  kind: "function" | "variable" | "parameter" | "module";
  line: number; // 1-based, from the real Parser span
  col: number;  // 1-based, from the real Parser span
};

function defaultCompilerFn(path: string, content: string): CompilerFnResult {
  const diagnostics: CachedDiagnostic[] = [];
  const imports: string[] = [];

  const { tokens, errors: lexErrors } = lex(content);
  for (const e of lexErrors) {
    diagnostics.push({
      severity: "error",
      code: e.code,
      message: e.message,
      line: e.span.startLine,
      col: e.span.startCol,
    });
  }

  const { program, errors: parseErrors } = parse(tokens);
  for (const e of parseErrors) {
    diagnostics.push({
      severity: "error",
      code: e.code,
      message: e.message,
      line: e.span.startLine,
      col: e.span.startColumn,
    });
  }

  for (const imp of program.imports) imports.push(imp.path.join("/"));

  // Only run Semantic/TypeChecker if parsing succeeded well enough to
  // produce a usable AST — avoids cascading nonsense diagnostics on top
  // of already-reported parse errors.
  if (parseErrors.length === 0) {
    const semanticResult = analyze(program);
    for (const d of semanticResult.diagnostics) {
      diagnostics.push({
        severity: toLspSeverity(d.severity),
        code: d.code,
        message: d.message,
        line: d.span.startLine,
        col: d.span.startColumn,
      });
    }

    const typeResult = typeCheck(program);
    for (const d of typeResult.diagnostics) {
      diagnostics.push({
        severity: toLspSeverity(d.severity),
        code: d.code,
        message: d.message,
        line: d.span.startLine,
        col: d.span.startColumn,
      });
    }
  }

  // Real symbol extraction from the AST — replaces the previous
  // declaredNames-only approach. Each symbol carries its REAL span from
  // the Parser (not a hardcoded {0,0}), and its REAL kind (Function vs
  // Variable), derived directly from the AST node type rather than a
  // regex re-scan of the source text using RC2-era keywords.
  const symbols: RealSymbolInfo[] = [];
  if (parseErrors.length === 0) {
    for (const fn of program.functions) {
      symbols.push({
        name: fn.name,
        kind: "function",
        line: fn.span.startLine,
        col: fn.span.startColumn,
      });
      // CONFIRMED BUG (fixed): parameters were never registered as
      // symbols at all, so "Go to Definition" on a parameter usage
      // always returned null. Fixed by declaring each parameter with its
      // real span. Note: the current SymbolTable has document-level (not
      // function-scoped) name resolution, so a parameter name reused
      // across two functions in the same file will resolve to whichever
      // was declared last — a known, separate limitation of the symbol
      // table's scoping model, not of this fix.
      for (const p of fn.params) {
        symbols.push({
          name: p.name,
          kind: "parameter",
          line: p.span.startLine,
          col: p.span.startColumn,
        });
      }
    }
    for (const g of program.globals) {
      symbols.push({
        name: g.name,
        kind: "variable",
        line: g.span.startLine,
        col: g.span.startColumn,
      });
    }
    // CONFIRMED BUG (fixed): import aliases were never registered as
    // symbols, so "Go to Definition" on a module reference (e.g. `math`
    // in `math.add(...)`) always returned null. Fixed by declaring the
    // alias as a "module" symbol pointing at the import statement itself
    // — cross-file navigation to the target module's own source file is
    // out of scope for this fix (it would require resolving the import
    // path to an actual file, which the current single-file compilerFn
    // does not have access to), but jumping to the import declaration
    // that brought the module into scope is real, correct, and useful.
    for (const imp of program.imports) {
      const alias = imp.alias ?? imp.path[imp.path.length - 1] ?? imp.path.join(".");
      symbols.push({
        name: alias,
        kind: "module",
        line: imp.span.startLine,
        col: imp.span.startColumn,
      });
    }
  }

  const declaredNames = program.functions.map(f => f.name);
  const references = parseErrors.length === 0 ? collectReferences(program) : [];

  return {
    output: JSON.stringify({ path, declaredNames, symbols, references }),
    kind: "semantic",
    diagnostics,
    imports,
  };
}

// ── Bridge ────────────────────────────────────────────────────────────────────

export class IncrementalLspBridge {
  private readonly pipeline: IncrementalPipeline;
  private lastCacheStats: ReturnType<typeof this.pipeline.build>["cacheStats"] | null = null;

  constructor(
    private readonly docs: TextDocumentManager,
    private readonly symbols: SymbolTable,
    private readonly diagnostics: DiagnosticEngine,
    private readonly resolver: UriResolver,
    compilerFn: CompilerFn = defaultCompilerFn,
    options: PipelineOptions = {}
  ) {
    this.pipeline = new IncrementalPipeline(compilerFn, { defaultKind: "semantic", ...options });
  }

  // ── Analysis ─────────────────────────────────────────────────────────────

  /**
   * Run an incremental analysis pass over all open documents.
   * Only documents whose content changed since the last pass are reprocessed.
   */
  async analyzeAll(): Promise<LspBuildResult> {
    const t0 = Date.now();

    // Build input map: fsPath → content
    const inputs = new Map<string, string>();
    for (const doc of this.docs.all()) {
      const fsPath = this.tryResolvePath(doc.uri);
      inputs.set(fsPath, doc.text);
    }

    const result = this.pipeline.build({ files: inputs });
    this.lastCacheStats = result.cacheStats;

    // For recompiled files: update symbol table and diagnostics
    const reanalyzed: DocumentUri[] = [];
    const cacheHits: DocumentUri[] = [];
    let diagnosticCount = 0;

    for (const path of result.recompiled) {
      const uri = this.resolver.pathToUri(path);
      reanalyzed.push(uri);

      // Invalidate old symbols
      this.symbols.invalidateDocument(uri);

      // Re-index symbols from artifact
      const artifact = result.artifacts.get(path);
      if (artifact?.kind === "semantic") {
        try {
          const parsed = JSON.parse(artifact.output) as {
            declaredNames: string[];
            symbols: RealSymbolInfo[];
            references: RealReferenceInfo[];
          };
          const doc = this.docs.get(uri);
          if (doc) {
            this.indexRealSymbols(uri, parsed.symbols, parsed.references);
          }
        } catch {
          // Artifact parse failure is non-fatal
        }
      }
    }

    // CONFIRMED BUG (fixed): diagnostics must be published for cache-hit
    // files too, not only recompiled ones. The build's `diagnostics` array
    // (computed in pipeline.ts) already correctly includes entries for
    // BOTH recompiled and cache-served files — but this bridge previously
    // only ever iterated `result.recompiled` when deciding what to
    // publish. If a document's content reverted to something identical to
    // a previously-cached version (a very normal editing pattern — e.g.
    // undo, or retyping the same fix), the pipeline correctly served it
    // from cache with the correct (possibly zero) diagnostics, but this
    // bridge silently skipped publishing anything, leaving the LSP
    // diagnostic engine showing whatever was stale from the last time
    // THIS uri was actually recompiled. Fixed by publishing diagnostics
    // for every currently-open document that appears in this build's
    // results at all (recompiled OR cache-hit).
    for (const path of [...result.recompiled, ...result.cacheHits]) {
      const uri = this.resolver.pathToUri(path);
      const doc = this.docs.get(uri);
      if (!doc) continue;
      const fileDiags = result.diagnostics.filter((d) => d.path === path);
      const lspDiags = fileDiags.map((fd) =>
        this.diagnostics.convertDiagnostic(fd, doc.mapper)
      );
      this.diagnostics.publish(uri, lspDiags, doc.version);
      diagnosticCount += lspDiags.length;
    }

    for (const path of result.cacheHits) {
      cacheHits.push(this.resolver.pathToUri(path));
    }

    return {
      reanalyzed,
      cacheHits,
      diagnosticCount,
      elapsedMs: Date.now() - t0,
    };
  }

  /**
   * Analyze a single document immediately (used on didChange events).
   */
  async analyzeSingle(uri: DocumentUri): Promise<LspBuildResult> {
    const t0 = Date.now();
    const doc = this.docs.get(uri);
    if (!doc) return { reanalyzed: [], cacheHits: [], diagnosticCount: 0, elapsedMs: 0 };

    // Build workspace snapshot: ALL open documents + updated content for changed file.
    // This is essential for IncrementalPipeline to correctly detect unchanged files
    // and serve them from cache instead of recompiling the entire workspace.
    const inputs = new Map<string, string>();
    for (const openDoc of this.docs.all()) {
      inputs.set(this.tryResolvePath(openDoc.uri), openDoc.text);
    }
    const fsPath = this.tryResolvePath(uri);
    inputs.set(fsPath, doc.text); // ensure latest content for changed file

    const result = this.pipeline.build({ files: inputs });
    this.lastCacheStats = result.cacheStats;

    let diagnosticCount = 0;
    const reanalyzed: DocumentUri[] = [];

    if (result.recompiled.includes(fsPath)) {
      reanalyzed.push(uri);
      this.symbols.invalidateDocument(uri);

      const artifact = result.artifacts.get(fsPath);
      if (artifact?.kind === "semantic") {
        try {
          const parsed = JSON.parse(artifact.output) as {
            declaredNames: string[];
            symbols: RealSymbolInfo[];
            references: RealReferenceInfo[];
          };
          this.indexRealSymbols(uri, parsed.symbols, parsed.references);
        } catch { /* ignore */ }
      }
    }

    // CONFIRMED BUG (fixed): must publish diagnostics whenever this file
    // participated in the build AT ALL — whether recompiled or served
    // from cache — not only when recompiled. See the matching fix in
    // analyzeAll() above for the full explanation. Without this, reverting
    // a document's content to something identical to a previously-cached
    // version left stale diagnostics visible indefinitely.
    if (result.recompiled.includes(fsPath) || result.cacheHits.includes(fsPath)) {
      const fileDiags = result.diagnostics.filter((d) => d.path === fsPath);
      const lspDiags = fileDiags.map((fd) =>
        this.diagnostics.convertDiagnostic(fd, doc.mapper)
      );
      this.diagnostics.publish(uri, lspDiags, doc.version);
      diagnosticCount = lspDiags.length;
    }

    return {
      reanalyzed,
      cacheHits: result.cacheHits.map((p) => this.resolver.pathToUri(p)),
      diagnosticCount,
      elapsedMs: Date.now() - t0,
    };
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  getCacheStats() {
    return this.lastCacheStats ?? { hits: 0, misses: 0, size: 0, capacity: 0, evictions: 0 };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private tryResolvePath(uri: DocumentUri): string {
    try {
      return this.resolver.uriToPath(uri);
    } catch {
      return uri;
    }
  }

  /**
   * Real symbol indexing from AST-derived data (name, kind, real span).
   * Replaces the previous regex-based re-scan of the raw source text
   * (which used RC2-era keywords like `fn`/`mut`/`struct`/`enum` — not
   * even UR 1.0 syntax — and always recorded {0,0} as the definition
   * location, making "Go to Definition" always point to the top of the
   * file regardless of where a symbol was actually declared).
   */
  private indexRealSymbols(uri: DocumentUri, symbols: RealSymbolInfo[], references: RealReferenceInfo[] = []): void {
    for (const sym of symbols) {
      const lspKind =
        sym.kind === "function"  ? SymbolKind.Function :
        sym.kind === "module"    ? SymbolKind.Module :
        sym.kind === "parameter" ? SymbolKind.Variable :
        SymbolKind.Variable;
      this.symbols.declareSymbol({
        name: sym.name,
        kind: lspKind,
        definedIn: uri,
        definitionRange: {
          start: { line: sym.line - 1, character: sym.col - 1 }, // LSP positions are 0-based
          end: { line: sym.line - 1, character: sym.col - 1 + sym.name.length },
        },
        exported: true,
      });
    }

    const declaredNames = new Set(symbols.map(s => s.name));
    for (const ref of references) {
      if (!declaredNames.has(ref.name)) continue; // only track references to symbols we actually declared
      const declSym = symbols.find(s => s.name === ref.name)!;
      // Skip the occurrence that IS the declaration site itself (same line+col).
      if (ref.line === declSym.line && ref.col === declSym.col) continue;
      this.symbols.addReference({
        symbolName: ref.name,
        definedIn: uri,
        location: {
          uri,
          range: {
            start: { line: ref.line - 1, character: ref.col - 1 },
            end: { line: ref.line - 1, character: ref.col - 1 + ref.length },
          },
        },
      });
    }
  }
}
