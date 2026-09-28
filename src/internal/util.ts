import * as Array from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { createHash } from "node:crypto"

// Stable JSON representation: object insertion order does not affect hashes.
/** @internal */
export const canonical = (value: Schema.Json): string => {
  if (Array.isArray<Schema.Json>(value)) return `[${value.map(canonical).join(",")}]`

  if (Predicate.isObject(value)) {
    // SAFETY: a non-array object in a Json tree is a JsonObject.
    const entries = Object.entries(value as Schema.JsonObject).sort((
      [a],
      [b]
    ) => (a < b ? -1 : a > b ? 1 : 0))

    return `{${
      entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")
    }}`
  }

  return JSON.stringify(value)
}

/** @internal */
export const hash = (value: Schema.Json): string =>
  createHash("sha256").update(canonical(value)).digest("hex")

// Local deterministic PRNG, never alters Effect's or the application's random state.
/** @internal */
export const seeded = (seed: string): () => number => {
  let state = parseInt(hash(seed).slice(0, 8), 16)

  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// In-place Fisher-Yates shuffle driven by the given PRNG.
/** @internal */
export const shuffle = <A>(items: A[], random: () => number): A[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const previous = items[i]
    items[i] = items[j]
    items[j] = previous
  }

  return items
}

// Metric contract: a finite score in [0, 1].
/** @internal */
export const Score = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
