# `@skillescrow/shared`

Shared domain logic, currency conversions, fee calculations, and cross-repository canonical test vectors for the Soroban Escrow application.

## Overview

This package is the authoritative TypeScript implementation of the core money mathematics used across the frontend (`apps/web`), backend API (`apps/api`), and worker processes. It guarantees 100% mathematical and behavioral parity with the Soroban Rust smart contract (`contracts/bounty_escrow`).

## Core Modules

### 1. `amounts.ts`
- **`TOKEN_DECIMALS`**: Constant set to `7` (standard Stellar token decimals).
- **`toBaseUnits(s: string, decimals = 7): bigint`**: Strictly parses decimal strings into base units (e.g. `"50.5"` -> `505000000n`). Rejects malformed strings (whitespace, signs, scientific exponents, multiple decimal points, non-ASCII digits, and precision exceeding `decimals`).
- **`fromBaseUnits(v: bigint, decimals = 7, minFrac = 0): string`**: Formats base units back to canonical decimal representation with trailing zero trimming.
- **`normalise(s: string): string`**: Normalises a valid decimal string to canonical form (removing redundant leading/trailing zeros).

### 2. `fees.ts`
- **`BPS`**: `10_000n` (basis points denominator).
- **`MAX_FEE_BPS`**: `1_000` (10% maximum protocol fee).
- **`I128_MAX`**: `(1n << 127n) - 1n` (`170141183460469231731687303715884105727n`). Matches Rust `i128::MAX`.
- **`fee(amount: bigint, bps: number | bigint): bigint`**: Floor integer division `(amount * bps) / 10000n`. Strictly enforces checked arithmetic, throwing `overflow` if `amount * bps > I128_MAX`.
- **`net(amount: bigint, bps: number | bigint): bigint`**: `amount - fee(amount, bps)`. Enforces invariant `net + fee === amount`.
- **`portion(amount: bigint, winnerBps: number | bigint): bigint`**: Calculates split allocation using floor division.

## Canonical Test Vectors (`fee-vectors.json`)

`fee-vectors.json` defines cross-repository test vectors verifying:
1. Standard basis point fees (1 bps, 300 bps, 1000 bps).
2. Boundary rounding cut-offs (e.g. 33 units at 300 bps rounds down to 0; 34 units rounds to 1).
3. Split portions (33.33% winner split).
4. Decimal string conversions and normalisation.
5. Checked arithmetic cut-offs at `i128::MAX / 10_000n` and overflow rejection.

### Schema Structure
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Soroban Escrow Canonical Fee & Amount Vectors",
  "constants": {
    "BPS": "10000",
    "MAX_FEE_BPS": 1000,
    "TOKEN_DECIMALS": 7,
    "I128_MAX": "170141183460469231731687303715884105727"
  },
  "fee_vectors": [...],
  "portion_vectors": [...],
  "amount_vectors": [...]
}
```

## Cross-Repository Consumption Story

To prevent calculation drift across repositories (TypeScript UI/API, Rust smart contract, Rust backend), `fee-vectors.json` serves as the single source of truth:

1. **Rust Contract (`contracts/bounty_escrow`)**:
   - The contract repository references `fee-vectors.json` via a pinned Git submodule or downloads the pinned artifact via GitHub Actions during `cargo test`.
   - In Rust test suite: `serde_json::from_str` reads `fee-vectors.json` and runs parameterised unit tests directly against `fees.rs`.

2. **Automated CI Parity Check**:
   - In `.github/workflows/ci.yml`, a lightweight step compares `packages/shared/fee-vectors.json` with the upstream reference to detect unauthorized divergence before pull requests merge.

## Property-Based Testing

Extensive property tests using `fast-check` guarantee:
- **Round-trip parity**: `fromBaseUnits(toBaseUnits(x)) === normalise(x)` for arbitrary decimal inputs.
- **Additive conservation**: `net(amount, bps) + fee(amount, bps) === amount`.
- **Monotonicity**: `amountA <= amountB ==> fee(amountA, bps) <= fee(amountB, bps)`.
- **Boundedness**: `0 <= fee(amount, bps) <= amount` for any valid basis point parameter.
- **Mutation resistance**: Floor division invariants verify that round-to-nearest mutations are caught by at least two independent tests.
