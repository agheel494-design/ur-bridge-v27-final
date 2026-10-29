import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { ALL_LANGUAGES } from "../../../src/compiler/localization/index.js";

function stripIdentifierText(node: any): any {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripIdentifierText);
  const out: any = {};
  for (const key of Object.keys(node)) {
    if (key === "span" || key === "name" || key === "binding" || key === "path") continue;
    out[key] = stripIdentifierText(node[key]);
  }
  return out;
}

const JAPANESE_PROGRAM = `インポート アドオン

構造体 点
  x: int
  y: int
終了

型 整数 = int

関数 合計(n: int): int
  レット 結果: int = 0
  レット i: int = 0
  ながら i < n
    もし i == 3
      続行
    違えば
      もし i == 7
        中断
      終了
    終了
    結果 = 結果 + i
    i = i + 1
  終了
  返す 結果
終了

関数 メイン(): int
  レット 未使用: int = 無
  レット 有効: bool = 真
  もし 有効 == 偽
    返す 0
  終了
  レット 数値のリスト: int = 5
  レット 累計: int = 0
  繰り返す 番号 内 数値のリスト
    累計 = 累計 + 番号
  終了
  返す 合計(数値のリスト)
終了
`;

const ENGLISH_EQUIVALENT = `import addon

struct Point
  x: int
  y: int
end

type Integer = int

function sum(n: int): int
  let result: int = 0
  let i: int = 0
  while i < n
    if i == 3
      continue
    else
      if i == 7
        break
      end
    end
    result = result + i
    i = i + 1
  end
  return result
end

function main(): int
  let unused: int = null
  let valid: bool = true
  if valid == false
    return 0
  end
  let numbersList: int = 5
  let total: int = 0
  for number in numbersList
    total = total + number
  end
  return sum(numbersList)
end
`;

describe("Reviewer-requested Proof 1: complete Japanese program, all 17 keywords, real usage", () => {
  it("Japanese program: zero Lexer errors, zero Parser errors", () => {
    const l = lex(JAPANESE_PROGRAM, "japanese-full.ur");
    expect(l.errors.length).toBe(0);
    const p = parse(l.tokens, "japanese-full.ur");
    expect(p.errors.length).toBe(0);
  });

  it("English equivalent: zero Lexer errors, zero Parser errors (baseline)", () => {
    const l = lex(ENGLISH_EQUIVALENT, "english-full.ur");
    expect(l.errors.length).toBe(0);
    const p = parse(l.tokens, "english-full.ur");
    expect(p.errors.length).toBe(0);
  });

  it("Japanese and English produce STRUCTURALLY IDENTICAL ASTs (identifier text stripped, everything else compared)", () => {
    const jaTokens = lex(JAPANESE_PROGRAM, "ja.ur").tokens;
    const jaProgram = parse(jaTokens, "ja.ur").program;
    const enTokens = lex(ENGLISH_EQUIVALENT, "en.ur").tokens;
    const enProgram = parse(enTokens, "en.ur").program;
    expect(JSON.stringify(stripIdentifierText(jaProgram))).toBe(JSON.stringify(stripIdentifierText(enProgram)));
  });

  it("real, explicit usage confirmation: FOR uses IN, both real Japanese words, and the loop is genuinely a ForStatement node in the AST", () => {
    const tokens = lex(JAPANESE_PROGRAM, "ja.ur").tokens;
    const program = parse(tokens, "ja.ur").program;
    const mainFn = (program.functions as any[]).find((f) => f.name === "メイン");
    const forStmt = mainFn.body.statements.find((s: any) => s.kind === "ForStatement");
    expect(forStmt !== undefined).toBe(true);
    expect(forStmt.binding).toBe("番号");
  });
});

describe("Reviewer-requested Proof 2: STRUCT genuinely USED, not merely declared", () => {
  it("Japanese STRUCT (kouzoutai) used as a real function parameter type, with real field access in the function body", () => {
    const program = `構造体 点
  x: int
  y: int
終了

関数 メイン(p: 点): int
  返す p.x
終了
`;
    const l = lex(program, "struct-usage.ur");
    expect(l.errors.length).toBe(0);
    const p = parse(l.tokens, "struct-usage.ur");
    expect(p.errors.length).toBe(0);
    const fn = (p.program.functions as any[])[0];
    expect(fn.params[0].type.kind).toBe("TypeRef");
    expect(fn.params[0].type.name).toBe("点");
    expect(fn.body.statements[0].kind).toBe("ReturnStatement");
    expect(fn.body.statements[0].value.kind).toBe("MemberExpression");
    expect(fn.body.statements[0].value.property).toBe("x");
    expect(fn.body.statements[0].value.object.name).toBe("p");
  });
});

describe("Reviewer-requested Proofs 3-4: Italian completely removed from the system", () => {
  it("'it' is not present anywhere in the language registry", () => {
    const codes = (ALL_LANGUAGES as any[]).map((l) => l.code);
    expect(codes.includes("it")).toBe(false);
  });

  it("real, former Italian keywords ('funzione', 'sia', 'ritorna', 'fine') are no longer recognized as keywords - a program using them fails to parse", () => {
    const formerItalianProgram = `funzione test(): int
  sia x: int = 5
  ritorna x
fine
`;
    const l = lex(formerItalianProgram, "former-italian.ur");
    const p = parse(l.tokens, "former-italian.ur");
    expect(p.errors.length > 0).toBe(true);
  });
});
