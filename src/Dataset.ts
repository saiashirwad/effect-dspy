/**
 * Hash-addressed collections of examples.
 *
 * A `Dataset` decodes rows with a codec, rejects duplicate example IDs, and
 * hashes the encoded rows so artifacts can record exactly which data produced
 * them. Splits are seeded and replayable.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Number from "effect/Number"
import * as Order from "effect/Order"
import * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Struct from "effect/Struct"
import { DatasetError } from "./Errors.ts"
import { hash, seeded, shuffle } from "./internal/util.ts"

/**
 * A single identified example with an input and its expected result.
 *
 * @category models
 * @since 0.1.0
 */
export interface Example<I, Expected> {
  readonly id: string
  readonly input: I
  readonly expected: Expected
}

/**
 * The role of a split partition.
 *
 * @category models
 * @since 0.1.0
 */
export type Role = "train" | "validation" | "test"

/**
 * Where a split partition came from.
 *
 * @category models
 * @since 0.1.0
 */
export interface Split {
  readonly parentHash: string
  readonly role: Role
  readonly options: SplitOptions
}

/**
 * Runtime identifier for `Dataset` values.
 *
 * @category type IDs
 * @since 0.1.0
 */
export const TypeId = "~effect-dspy/Dataset"

/**
 * An identified collection of examples.
 *
 * @category models
 * @since 0.1.0
 */
export interface Dataset<I, Expected> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly id: string
  readonly hash: string
  readonly examples: ReadonlyArray<Example<I, Expected>>
  readonly split: Split | undefined
}

const Proto = { ...Pipeable.Prototype, [TypeId]: TypeId }

/**
 * Returns `true` when a value is a `Dataset`.
 *
 * @category guards
 * @since 0.1.0
 */
export const isDataset = (u: unknown): u is Dataset<unknown, unknown> =>
  Predicate.hasProperty(u, TypeId)

const make = <I, X>(fields: Omit<Dataset<I, X>, "pipe" | typeof TypeId>): Dataset<I, X> =>
  Object.assign(Object.create(Proto), fields)

/**
 * A JSON description of a dataset for artifact provenance.
 *
 * @category accessors
 * @since 0.1.0
 */
export const provenance = <I, X>(self: Dataset<I, X>): Schema.Json => ({
  id: self.id,
  hash: self.hash,
  examples: self.examples.map(Struct.get("id")),
  ...(self.split
    && {
      split: { parentHash: self.split.parentHash, role: self.split.role, ...self.split.options }
    })
})

/**
 * Decodes rows into a `Dataset`.
 *
 * **Details**
 *
 * Fails with a `DatasetError` when a row does not decode, an ID is empty or
 * repeated, or an encoded row is not JSON.
 *
 * @category constructors
 * @since 0.1.0
 */
export const fromIterable = <I, X, Encoded, RD, RE>(
  id: string,
  schema: Schema.Codec<Example<I, X>, Encoded, RD, RE>,
  rows: Iterable<unknown>
): Effect.Effect<Dataset<I, X>, DatasetError, RD | RE> =>
  Effect.gen(function*() {
    const codec = Schema.Array(schema)
    const examples = yield* Schema.decodeUnknownEffect(codec)(Array.from(rows))
    const seen = new Set<string>()

    for (const example of examples) {
      if (example.id.trim() === "" || seen.has(example.id)) {
        return yield* new DatasetError({
          message: `Example IDs must be nonempty and unique: "${example.id}"`
        })
      }

      seen.add(example.id)
    }

    const encoded = yield* Schema.encodeEffect(codec)(examples).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json))
    )

    return make({ id, hash: hash(encoded), examples, split: undefined })
  }).pipe(
    Effect.catchTag("SchemaError", (cause) =>
      Effect.fail(new DatasetError({ message: `Invalid dataset ${id}: ${cause.message}`, cause })))
  )

/**
 * Collects a stream of rows into a `Dataset`.
 *
 * @category constructors
 * @since 0.1.0
 */
export const collect: {
  <I, X, Encoded, RD, RE>(
    id: string,
    schema: Schema.Codec<Example<I, X>, Encoded, RD, RE>
  ): <E, R>(
    self: Stream.Stream<unknown, E, R>
  ) => Effect.Effect<Dataset<I, X>, E | DatasetError, RD | RE | R>
  <E, R, I, X, Encoded, RD, RE>(
    self: Stream.Stream<unknown, E, R>,
    id: string,
    schema: Schema.Codec<Example<I, X>, Encoded, RD, RE>
  ): Effect.Effect<Dataset<I, X>, E | DatasetError, RD | RE | R>
} = dual(
  3,
  <E, R, I, X, Encoded, RD, RE>(
    self: Stream.Stream<unknown, E, R>,
    id: string,
    schema: Schema.Codec<Example<I, X>, Encoded, RD, RE>
  ) => Effect.flatMap(Stream.runCollect(self), (rows) => fromIterable(id, schema, rows))
)

const Ratio = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

const SplitOptions = Schema.Struct({
  train: Ratio,
  validation: Ratio,
  test: Ratio,
  seed: Schema.String
}).check(
  Schema.makeFilter(
    ({ train, validation, test }) => Math.abs(train + validation + test - 1) <= 1e-10,
    {
      message: "Split ratios must sum to 1"
    }
  )
)

/**
 * Split ratios and the seed that shuffles examples before partitioning.
 *
 * @category models
 * @since 0.1.0
 */
export type SplitOptions = typeof SplitOptions.Type

/**
 * The partitions produced by {@link split}.
 *
 * @category models
 * @since 0.1.0
 */
export type Splits<I, X> = { readonly [K in Role]: Dataset<I, X> }

const roles: ReadonlyArray<Role> = ["train", "validation", "test"]

/**
 * Partitions a dataset by seeded shuffle and largest-remainder allocation.
 *
 * **Details**
 *
 * A zero ratio never receives examples. Each partition's hash is derived from
 * the parent hash, its role, and its example IDs.
 *
 * @category combinators
 * @since 0.1.0
 */
export const split: {
  (options: SplitOptions): <I, X>(self: Dataset<I, X>) => Effect.Effect<Splits<I, X>, DatasetError>
  <I, X>(self: Dataset<I, X>, options: SplitOptions): Effect.Effect<Splits<I, X>, DatasetError>
} = dual(2, <I, X>(self: Dataset<I, X>, input: SplitOptions) =>
  Effect.gen(function*() {
    const options = yield* Schema.decodeEffect(SplitOptions)(input).pipe(
      Effect.mapError((cause) =>
        new DatasetError({ message: `Invalid split options: ${cause.message}`, cause })
      )
    )

    const size = self.examples.length
    const shuffled = shuffle([...self.examples], seeded(options.seed))
    const counts = roles.map((role) => Math.floor(options[role] * size))

    const byRemainder = roles.map((role, index) => ({
      index,
      remainder: options[role] * size - counts[index]
    }))
      .sort(Struct.makeOrder({ remainder: Order.flip(Number.Order), index: Number.Order }))

    for (
      let i = 0;
      i < size - Number.sumAll(counts);
      i++
    ) counts[byRemainder[i % roles.length].index]++

    let start = 0

    const partition = (role: Role, count: number): Dataset<I, X> => {
      const examples = shuffled.slice(start, start += count)

      return make({
        id: `${self.id}/${role}`,
        hash: hash({ parent: self.hash, role, examples: examples.map(Struct.get("id")) }),
        examples,
        split: { parentHash: self.hash, role, options }
      })
    }

    return {
      train: partition("train", counts[0]),
      validation: partition("validation", counts[1]),
      test: partition("test", counts[2])
    }
  }))
