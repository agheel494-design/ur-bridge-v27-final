// UR Language — Official Example: type alias
//
// Demonstrates a `type` alias declaration. IMPORTANT, verified
// limitation (see issues/named-type-annotations-not-resolved.md and
// KNOWN_LIMITATIONS.md): the alias NAME itself cannot yet be used as
// an explicit type annotation elsewhere (`let a: Age = 30` fails).
// Only the declaration itself is v1.0 scope — this example
// deliberately does not use `Age` as an annotation anywhere, to avoid
// shipping an example that doesn't actually compile.
//
// Verified: runs correctly on the C Backend. Result: 30.

type Age = int

function main(): int
  let a: int = 30
  return a
end
