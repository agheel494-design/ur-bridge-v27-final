<div align="center">

<img src="docs/assets/ur/ur-logo-source.png" alt="UR Programming Language" width="180">

# UR Programming Language

### A multilingual programming language built for humans.

UR is a programming language designed around a simple idea: developers should
be able to express programs through supported human-language surfaces while
sharing one language and compiler architecture.

**Stable V1.0** · **Open Source**

**[Get Started](#getting-started)** · **[Developer Guide](UR_LANGUAGE_V1_0.md)** · **[Examples](examples/)**

</div>

---

## Try UR

A minimal UR program:

```ur
function main(): int
  return 42
end
```

Run a UR source file through the V1.0 CLI:

```bash
ur run program.ur
```

`ur run` compiles the source to UR IR and executes it through the UR interpreter.

For installation and environment setup, see the [Installation Guide](docs/INSTALLATION_GUIDE.md).

---

## Why UR?

### Multilingual by design

UR is designed around multilingual source surfaces rather than tying the language identity to a single human language.

### One language, multiple implementation paths

UR has an interpreter-based CLI execution path together with separate C and WebAssembly backends.

Backend availability is not the same as CLI exposure. In particular, the existence of the WebAssembly backend does not imply a V1.0 CLI command for direct WASM execution.

### Explicit capability boundaries

UR V1.0 documentation distinguishes between language specification, frontend recognition, type checking, lowering, backend support, CLI exposure, and end-to-end verification.

A construct being recognized by the parser does not automatically mean that it is fully executable across every backend.

### Evidence-oriented development

The V1.0 documentation records supported capabilities, known limitations, architectural decisions, and release evidence separately so that current language behavior is not confused with historical engineering records.

---

## UR V1.0 at a glance

| Capability | V1.0 status |
|---|---|
| Variables and core expressions | Supported |
| Functions | Supported, with documented boundaries |
| `if` / `else` statements | Supported |
| `while`, `break`, `continue` | Supported |
| Array `for/in` iteration | Supported |
| Range-based `for` | Deferred to V1.1 |
| Arrays | Supported |
| Nested / multidimensional arrays | Supported |
| Structs | Supported, with limitations |
| Direct package imports | Supported, with limitations |
| `char` and character literals | Supported |
| Type-alias declarations | Supported, with limitations |
| Named-type annotations | Deferred to V1.1 |
| `null` | Recognized; executable semantics deferred |
| C Backend | Implemented as a separate backend |
| WebAssembly Backend | Implemented with documented limitations |

For the precise contract and important qualifications, use the [Official Developer Guide](UR_LANGUAGE_V1_0.md).

---

## Getting Started

### 1. Read the installation requirements

Follow the verified setup instructions in the [Installation Guide](docs/INSTALLATION_GUIDE.md).

### 2. Create a source file

Create `program.ur`:

```ur
function main(): int
  return 42
end
```

### 3. Run it

```bash
ur run program.ur
```

### 4. Explore the language

Continue with:

- [Official Developer Guide](UR_LANGUAGE_V1_0.md)
- [Examples](examples/)
- [Language Specification](UR_LANGUAGE_SPEC_1_0.md)

---

## Language capabilities

### Functions and control flow

UR V1.0 includes functions and statement-oriented control flow such as `if` / `else`, `while`, `break`, and `continue`.

Array-based `for/in` belongs to the V1.0 language contract. Range iteration is separate and deferred to V1.1.

### Arrays

V1.0 supports arrays, indexing, supported element reads and writes, and nested/multidimensional arrays.

Some whole-array operations and type-inference cases remain restricted. See the Developer Guide and Known Limitations before relying on more advanced array behavior.

### Structs

Struct declarations, construction, and direct field access are part of V1.0.

Some chained access patterns and struct/array combinations have documented limitations and should not be generalized beyond the verified cases.

### Packages and imports

Direct UR package imports through the verified `ur_packages` layout are supported with limitations.

Nested/transitive imports, arbitrary package exports, source-level relative imports, and native/FFI package resolution have distinct contracts. See the Developer Guide for the exact boundaries.

### C and WebAssembly

UR includes separate C and WebAssembly backend implementations.

These backends should not be confused with the normal `ur run` / `ur build` CLI paths, and support in one backend must not be generalized to another without corresponding evidence.

---

## Documentation

The **Official Developer Guide** is the recommended starting point for UR V1.0.

### Start here

**[UR_LANGUAGE_V1_0.md](UR_LANGUAGE_V1_0.md)**  
The developer-facing map of the V1.0 language, implemented capabilities, limitations, backend distinctions, and documentation authority.

### Language definition

- [Language Specification](UR_LANGUAGE_SPEC_1_0.md) — grammar and language semantics.
- [Version Matrix](UR_LANGUAGE_VERSION_MATRIX.md) — feature placement across V1.0 and later versions.

### Implementation and limitations

- [Implementation Matrix](SPEC_IMPLEMENTATION_MATRIX.md) — implementation evidence and layer-by-layer status.
- [Known Limitations](KNOWN_LIMITATIONS.md) — recorded implementation constraints and known boundaries.

### Installation and usage

- [Installation Guide](docs/INSTALLATION_GUIDE.md)
- [Using UR-Bridge Today](docs/USING_UR_BRIDGE_TODAY.md)

### Examples and conformance

- [Examples](examples/)
- [Conformance material](tests/conformance/)

### Release evidence

[UR V1.0 Final Release Evidence](UR_V1_0_FINAL_RELEASE_EVIDENCE.md) records release identity and verification evidence. It is not a replacement for the language specification or current capability guide.

---

## V1.0 boundaries

UR V1.0 deliberately does not claim every planned language feature.

Examples of capabilities assigned beyond the V1.0 contract include:

- named-type annotations in the documented deferred cases;
- range-based `for`;
- `if` expressions;
- broader contextual/bidirectional type inference;
- full exact 64-bit source integer-literal precision beyond the V1.0 safe literal subset.

Larger capabilities such as generics, classes, async/await, pattern matching, closures, `try` / `catch`, operator overloading, macros, and multiple return values are outside the V1.x contract according to the current version documentation.

See the Developer Guide for the distinction between **Deferred**, **Unsupported**, **Backend-specific**, **Recognized only**, and **Unresolved**.

---

## Project identity

UR is developed as a programming language with an emphasis on:

- multilingual programming surfaces;
- clear separation between language semantics and backend implementation;
- explicit documentation of capability boundaries;
- reproducible verification and release evidence;
- preserving engineering history without presenting historical documents as current authority.

The project documentation intentionally separates:

**Specification → Version placement → Implementation evidence → Limitations → Release evidence**

This separation helps developers understand not only what UR is intended to mean, but what UR V1.0 actually supports.

---

## Contributing

Contributions should preserve the distinction between language design, compiler implementation, backend capability, CLI exposure, tests and verification, and documentation.

Before proposing a language or implementation change, review the [Official Developer Guide](UR_LANGUAGE_V1_0.md), the [Language Specification](UR_LANGUAGE_SPEC_1_0.md), and the relevant implementation and limitations documentation.

Use the repository's GitHub issue and pull-request workflows for proposed changes.

---

## UR V1.0

UR V1.0 is the stable published release represented by the `v1.0.0` release.

**[View UR V1.0 Release](https://github.com/agheel494-design/ur-bridge-v27-final/releases/tag/v1.0.0)**

The published release artifact and its historical verification record remain separate from later documentation improvements on development branches.

---

<div align="center">

<img src="docs/assets/ur/ur-logo-source.png" alt="UR" width="72">

**UR Programming Language**

Multilingual programming, one language architecture.

[Developer Guide](UR_LANGUAGE_V1_0.md) · [Language Specification](UR_LANGUAGE_SPEC_1_0.md) · [Examples](examples/) · [Known Limitations](KNOWN_LIMITATIONS.md) · [Issues](https://github.com/agheel494-design/ur-bridge-v27-final/issues)

</div>
