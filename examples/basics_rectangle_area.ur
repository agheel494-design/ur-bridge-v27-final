// UR Language — Official Example: Basics (variables & arithmetic)
//
// The simplest possible example: variable declarations and basic
// arithmetic, no functions beyond main, no loops. Computes the area
// of a rectangle.
//
// Verified: runs correctly on BOTH the C Backend and the WASM
// Backend (unlike most other examples in this directory, this one
// uses no function calls with arguments, so it isn't blocked by the
// WASM Backend's own current limitation — see WASM_BACKEND_GUIDE.md).
// Result: 60.

function main(): int
  let width = 12
  let height = 5
  let area = width * height
  return area
end
