// ─────────────────────────────────────────────────────────────────────────────
// UR Language — VS Code Extension — Server Entry Point
// ─────────────────────────────────────────────────────────────────────────────
//
// A thin wrapper, not a reimplementation: imports and runs the REAL Layer A
// transport (src/lsp/transport.ts's own runOnStdio()) from the main project.
// This file exists only because a VS Code extension needs its own concrete
// "run this as a child process" entry point distinct from the test-only one
// used by tests/lsp/transport/e2e_process_entry.ts - both call the exact
// same runOnStdio() function; neither duplicates any transport or semantic
// logic.

import { runOnStdio } from "../../../src/lsp/transport.js";

runOnStdio();
