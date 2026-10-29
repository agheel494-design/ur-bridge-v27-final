// A minimal, real process entry point wiring the transport to real stdio -
// used by the real, child-process end-to-end test. Separate from the main
// project's own future extension entry point (not yet built - Layer B) so
// this Layer A test does not depend on anything from Layer B.
import { runOnStdio } from "../../../src/lsp/transport.js";
runOnStdio();
