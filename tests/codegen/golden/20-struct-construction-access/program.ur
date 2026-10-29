struct Point
  x: int
  y: int
end

function main(): int
  let p = Point(3, 4)
  return p.x + p.y
end
