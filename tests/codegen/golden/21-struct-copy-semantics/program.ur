struct Point
  x: int
  y: int
end

function main(): int
  let p = Point(1, 2)
  let q = p
  q.x = 10
  return p.x
end
