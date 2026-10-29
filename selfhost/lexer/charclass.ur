// selfhost/lexer/charclass.ur - D-8 (UR-PM-DIRECTIVE-002).
// UR re-implementation of the lexer's character-class predicates (isUnicodeLetter, isIdentStart,
// isIdentContinue in src/compiler/frontend/lexer.ts). The compiler does NOT use this file; the TypeScript
// lexer remains the implementation. tests/selfhost/charclass-equivalence.test.ts checks equivalence over
// code points 0..65535. This demonstrates that UR can express and run a real compiler component.
// It is NOT self-hosting.
//
// main() prints, for each of the 16 blocks of 4096 code points, four numbers: the identStart count, the
// identContinue count, and for each the sum of (offset-in-block + 1) over matching code points - a
// positional checksum, so a range shifted inside a block is still detected.

function is_unicode_letter(cp: int): bool
  if (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)
    return true
  end
  if cp == 95
    return true
  end
  if cp >= 1569 && cp <= 1594
    return true
  end
  if cp >= 1601 && cp <= 1610
    return true
  end
  if cp >= 1646 && cp <= 1791
    return true
  end
  if cp >= 1872 && cp <= 1919
    return true
  end
  if cp >= 64336 && cp <= 65023
    return true
  end
  if cp >= 65136 && cp <= 65279
    return true
  end
  if cp >= 192 && cp <= 591
    return true
  end
  if cp >= 880 && cp <= 1023
    return true
  end
  if cp >= 1024 && cp <= 1279
    return true
  end
  if cp >= 19968 && cp <= 40959
    return true
  end
  if cp >= 2304 && cp <= 2401
    return true
  end
  if cp >= 2417 && cp <= 2431
    return true
  end
  if cp >= 12352 && cp <= 12543
    return true
  end
  return false
end

function is_ident_start(cp: int): bool
  return is_unicode_letter(cp) || cp == 95
end

function is_ident_continue(cp: int): bool
  if is_ident_start(cp) || (cp >= 48 && cp <= 57)
    return true
  end
  if cp >= 1611 && cp <= 1631
    return true
  end
  if cp == 1648
    return true
  end
  if cp >= 2304 && cp <= 2307
    return true
  end
  if cp >= 2362 && cp <= 2383
    return true
  end
  if cp >= 2389 && cp <= 2403
    return true
  end
  if cp >= 2406 && cp <= 2415
    return true
  end
  return false
end

function main(): int
  let block: int = 0
  while block < 16
    let base: int = block * 4096
    let cp: int = base
    let stop: int = base + 4096
    let starts: int = 0
    let conts: int = 0
    let startsW: int = 0
    let contsW: int = 0
    while cp < stop
      if is_ident_start(cp)
        starts = starts + 1
        startsW = startsW + (cp - base + 1)
      end
      if is_ident_continue(cp)
        conts = conts + 1
        contsW = contsW + (cp - base + 1)
      end
      cp = cp + 1
    end
    print(starts)
    print(conts)
    print(startsW)
    print(contsW)
    block = block + 1
  end
  return 0
end
