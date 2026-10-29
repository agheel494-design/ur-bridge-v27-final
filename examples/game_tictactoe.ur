function main(): int
  let board = [0, 0, 0, 0, 0, 0, 0, 0, 0]

  // لاعب X يلعب المربع 4 (المركز)
  board[4] = 1
  // لاعب O يلعب المربع 0
  board[0] = 2
  // X يلعب 1
  board[1] = 1
  // O يلعب 8
  board[8] = 2
  // X يلعب 7 — يُكمِل عموداً: 1، 4، 7
  board[7] = 1

  let i = 0
  while i < 9
    print(board[i])
    i = i + 1
  end

  // فحص العمود الأوسط (1, 4, 7) — هل فاز X؟
  let winner = 0
  if board[1] == 1
    if board[4] == 1
      if board[7] == 1
        winner = 1
      end
    end
  end

  print(winner)
  return 0
end
