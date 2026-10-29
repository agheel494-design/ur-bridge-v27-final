// Minimal reproducer for the WASM SSA bug (issues/wasm-loop-local-let-affecting-outer-state.md)
//
// History: this exact source was used throughout Stage 3 (RCA),
// Stage 3.5 (Patch Design), and Stage 4 (Fix) to isolate, prove, and
// verify the fix for a WASM Code Generator defect where a loop-local
// `let` value used to update two outer variables in the same
// iteration produced a wrong result.
//
// Expected result (both backends, after the Stage 4 fix): 1
// Pre-fix WASM result (for the historical record): 2

function main(): int
  let a = 0
  let b = 1
  let i = 0
  while i < 2
    let temp = a + b
    a = b
    b = temp
    i = i + 1
  end
  return a
end
