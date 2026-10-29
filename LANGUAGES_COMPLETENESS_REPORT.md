# LANGUAGES_COMPLETENESS_REPORT.md

Scope held exactly to src/compiler/localization/. Zero files touched
outside this directory this session - confirmed via git diff before
this report was written. No keyword added, none removed, no
Parser/Lexer/Semantic/TypeChecker/IR/Backend/Bridge touched, no test
modified, no other document modified.

---

## Result: All 10 Languages Cover All 17 Canonical Keywords, Zero Gaps, Zero Internal Duplicates, Zero Cross-Language Collisions

| Language | Code | Unique canonicals covered | Internal duplicates | Structure matches reference (en.ts) |
|---|---|---|---|---|
| Arabic | ar | 17/17 | 0 | Yes |
| English | en | 17/17 | 0 | Yes (reference itself) |
| French | fr | 17/17 | 0 | Yes |
| Spanish | es | 17/17 | 0 | Yes |
| German | de | 17/17 | 0 | Yes |
| Russian | ru | 17/17 | 0 | Yes |
| Chinese | zh | 17/17 | 0 | Yes |
| Japanese | ja | 17/17 | 0 | Yes |
| Hindi | hi | 17/17 | 0 | Yes |
| Portuguese | pt | 17/17 | 0 | Yes |

Cross-language collision check (via the existing, unmodified
detectCrossLanguageCollisions()): 0 collisions, run live.

## A Real Contradiction Found in the Direction Itself - Reported, Not Resolved Unilaterally

Rule requested: confirm all 10 files contain the same NUMBER of keys.

Real, measured key counts:

```
ar: 19 keys   en: 19 keys   fr/es/de/ru/zh/ja/hi/pt: 17 keys each
```

Root cause, verified directly: ar.ts and en.ts each contain two
legitimate synonym pairs - real, intentional additional words for
the same canonical meaning, not errors or accidental duplicates:

- ar.ts: "عرف" and "دع" both map to LET; "بينما" and "طالما" both
  map to WHILE.
- en.ts: "function" and "func" both map to FUNCTION; "let" and "var"
  both map to LET.

Every one of the 8 other languages maps each of the 17 canonicals to
exactly one word - no synonyms.

Why this was not resolved unilaterally: closing this gap to reach
"same number for all 10" has exactly two possible directions, and
both directly violate an explicit rule in the same instruction:

1. Remove the synonym pairs from ar.ts/en.ts (2 words each) -
   violates Rule 2 (removing an existing word is prohibited).
2. Add matching synonym pairs to the other 8 languages (2 words
   each) - violates Rule 1 (adding a new keyword is prohibited).

Since choosing either path would mean silently breaking a different
explicit rule in the same direction, no change was made to any
language file to resolve this - the contradiction is reported here
for an explicit decision, rather than resolved by picking one
prohibition to violate over the other.

What IS true regardless of this open question: this does not
represent a coverage gap - every language, including ar and en,
covers all 17 canonicals with zero missing entries. The discrepancy
is additional, legitimate synonyms in exactly 2 of the 10 files, not
an inconsistency in what is actually supported.

## Keywords That Could Not Be Translated

None. All 17 canonical keywords have a real, linguistically
appropriate translation in all 10 languages - confirmed by direct
inspection of every file, and previously verified live through the
full compiler pipeline in a prior session (not re-run or modified
this session, per the explicit prohibition on touching tests).

## Files in Scope (unchanged this session - this report is inspection only)

```
src/compiler/localization/ar.ts
src/compiler/localization/en.ts
src/compiler/localization/fr.ts
src/compiler/localization/es.ts
src/compiler/localization/de.ts
src/compiler/localization/ru.ts
src/compiler/localization/zh.ts
src/compiler/localization/ja.ts
src/compiler/localization/hi.ts
src/compiler/localization/pt.ts
src/compiler/localization/canonical.ts (reference, read-only)
src/compiler/localization/index.ts (registry, read-only - used only
  to run the existing detectCrossLanguageCollisions() check)
```

No file above was modified. This report reflects an inspection pass
only, per the explicit instruction that this phase is preparation
for independent testing, not development.
