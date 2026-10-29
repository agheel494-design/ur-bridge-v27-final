// UR Standard Library — std.math
// Per explicit instruction: UR Standard Library v1.0 Foundation Sprint,
// deliberately small scope. Pure UR functions — no runtime externs, no
// compiler intrinsics. Verified directly (C Backend: compiles and runs
// correctly; WASM Backend: rejected — see the module-level note below).
//
// WASM BACKEND NOTE (confirmed directly, not assumed): every function
// below takes parameters, and the WASM Backend does not yet support
// function calls with arguments (tracked in
// UR_LANGUAGE_VERSION_MATRIX.md as v1.1 scope). Until that lands,
// this module is usable via the C Backend only.

function abs(x: int): int
  if x < 0
    return 0 - x
  end
  return x
end

function min(a: int, b: int): int
  if a < b
    return a
  end
  return b
end

function max(a: int, b: int): int
  if a > b
    return a
  end
  return b
end

function clamp(x: int, lo: int, hi: int): int
  if x < lo
    return lo
  end
  if x > hi
    return hi
  end
  return x
end
