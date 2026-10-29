// UR Standard Library — std.io
// Per explicit instruction: minimal scope only. Thin wrapper functions
// around the existing `print`/`input` builtins (see
// src/compiler/semantic/builtins-registry.ts) — no new compiler
// capability required. Verified directly (C Backend: compiles and
// runs correctly; WASM Backend: rejected, same reason as std.math).

function write(s: string): int
  print(s)
  return 0
end

// writeLine deliberately uses two separate print() calls, not string
// concatenation (`s + "\n"`) — string concatenation was directly
// tested and confirmed to fail (gcc compile error). Two print() calls
// were confirmed to work directly instead.
function writeLine(s: string): int
  print(s)
  print("\n")
  return 0
end

function readLine(): string
  return input()
end
