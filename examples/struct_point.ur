// UR Language — Official Example: Struct (Point)
//
// Constructs two Point structs and computes the sum of their
// coordinate differences — demonstrates struct construction (via
// inference from the constructor call, per v1.0's current scope —
// see docs/CONFORMANCE_SUITE.md) and field access.
//
// Verified: runs correctly on the C Backend. Result: 4.

struct Point
  x: int
  y: int
end

function main(): int
  let p1 = Point(3, 4)
  let p2 = Point(1, 2)
  return (p1.x - p2.x) + (p1.y - p2.y)
end
