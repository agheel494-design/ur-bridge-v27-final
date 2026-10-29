struct Point
  x: int
  y: int
end

function makePoint(x: int, y: int): Point
  return Point(x, y)
end

function main(): int
  let p = makePoint(3, 4)
  print(p.x)
  print(p.y)
  return 0
end
