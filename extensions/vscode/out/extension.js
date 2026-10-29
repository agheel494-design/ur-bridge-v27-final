"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// UR Language — VS Code Extension (Layer B)
// ─────────────────────────────────────────────────────────────────────────────
//
// Spawns the REAL Layer A LSP transport server (src/lsp/transport.ts's own
// runOnStdio()) as a child process and connects to it via the standard
// vscode-languageclient library - no mock, no reimplementation of any
// server-side logic. This file contains ONLY client-side wiring.
//
// Per the V2-M7 Design Gate: this package's own dependencies
// (vscode-languageclient, @types/vscode) are confined entirely to this
// extension's own package.json - the main project's own package.json is
// untouched.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const node_1 = require("vscode-languageclient/node");
let client;
/** Micro-Fix B-1: the server (server/run-server.ts) is launched via `tsx`
 *  directly, NOT via a tsc-compiled .js entry point - and deliberately so.
 *  run-server.ts's own single line of real logic imports the main
 *  project's src/lsp/transport.ts, which is itself never compiled to .js
 *  anywhere in this repository (the whole project runs via tsx). Ahead-
 *  of-time tsc-compiling run-server.ts would produce a .js file whose own
 *  relative import of "transport.js" could never resolve, regardless of
 *  path depth, since no such compiled file exists. tsx is therefore the
 *  correct, not merely convenient, way to run this specific entry point -
 *  matching this whole project's own established runtime convention.
 *  This extension's own tsconfig.json (rootDir "src") compiles ONLY
 *  src/extension.ts (this file) into out/extension.js, matching
 *  package.json's own "main" field exactly - server/run-server.ts is
 *  deliberately excluded from that compilation.
 *  Both paths below are resolved via context.asAbsolutePath(), relative
 *  to this extension's own installed location - never process.cwd(). */
function resolveServerLaunch(context) {
    const tsxPath = context.asAbsolutePath(path.join("node_modules", ".bin", "tsx"));
    const serverScriptPath = context.asAbsolutePath(path.join("server", "run-server.ts"));
    return { tsxPath, serverScriptPath };
}
function activate(context) {
    const { tsxPath, serverScriptPath } = resolveServerLaunch(context);
    const serverOptions = {
        run: { command: tsxPath, args: [serverScriptPath], transport: node_1.TransportKind.stdio },
        debug: { command: tsxPath, args: [serverScriptPath], transport: node_1.TransportKind.stdio },
    };
    const clientOptions = {
        documentSelector: [{ scheme: "file", language: "ur" }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.ur"),
        },
    };
    client = new node_1.LanguageClient("urLanguageServer", "UR Language Server", serverOptions, clientOptions);
    // Per the Design Gate's own explicit requirement: a clear, visible
    // failure notification if the server does not start - not left silent.
    // vscode-languageclient's own client.start() rejects its returned
    // promise on a genuine startup failure (e.g. the server module missing,
    // or the child process exiting immediately) - caught here explicitly.
    client.start().then(() => {
        // Started successfully - vscode-languageclient's own built-in
        // restart-on-crash behavior (configured via its default
        // ErrorAction/CloseAction handlers) covers the "server crashes
        // after a successful start" case without extra wiring here.
    }, (err) => {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`UR Language Server failed to start: ${message}`);
    });
    context.subscriptions.push({
        dispose: () => {
            client?.stop();
        },
    });
}
function deactivate() {
    return client?.stop();
}
//# sourceMappingURL=extension.js.map