// UR Language — Official Example: byte
//
// Demonstrates the `byte` Tier 1 type. See KNOWN_LIMITATIONS.md for
// two important, documented open questions about byte's own
// semantics (range validation, arithmetic support) before relying on
// byte for anything beyond simple storage/assignment as shown here.
//
// Verified: runs correctly on the C Backend. Result: 255.

function main(): byte
  let red: byte = 255
  return red
end
