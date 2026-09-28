/**
 * Named grading computations.
 *
 * A `Metric` pairs an identifier with a function from an input to an `Effect`
 * that produces a graded result. Metrics compose with {@link map},
 * {@link mapInput}, and {@link provide}, and several metrics run together with
 * {@link all} over one shared input.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import type * as Layer from "effect/Layer"
import * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Record from "effect/Record"

/**
 * Runtime identifier for `Metric` values.
 *
 * @category type IDs
 * @since 0.1.0
 */
export const TypeId = "~effect-dspy/Metric"

/**
 * A named grading computation.
 *
 * **When to use**
 *
 * Use to score a model output, or a whole run, against an expected result
 * during evaluation.
 *
 * **Details**
 *
 * `run` is deferred with `Effect.suspend`, so each call evaluates the wrapped
 * function afresh and no work is shared between evaluations.
 *
 * @category models
 * @since 0.1.0
 */
export interface Metric<I, A, E = never, R = never> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly id: string
  readonly run: (input: I) => Effect.Effect<A, E, R>
}

const Proto = { ...Pipeable.Prototype, [TypeId]: TypeId }

/**
 * Returns `true` when a value is a `Metric`.
 *
 * @category guards
 * @since 0.1.0
 */
export const isMetric = (u: unknown): u is Any => Predicate.hasProperty(u, TypeId)

/**
 * Creates a `Metric` from an identifier and a grading function.
 *
 * **When to use**
 *
 * Use to define a grading computation before composing or combining it.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <I, A, E, R>(
  id: string,
  run: (input: I) => Effect.Effect<A, E, R>
): Metric<I, A, E, R> =>
  Object.assign(Object.create(Proto), { id, run: (input: I) => Effect.suspend(() => run(input)) })

/**
 * Transforms the success value of a `Metric`.
 *
 * **When to use**
 *
 * Use to adapt a metric's graded result without changing how it is computed.
 *
 * @category combinators
 * @since 0.1.0
 */
export const map: {
  <A, B>(f: (value: A) => B): <I, E, R>(self: Metric<I, A, E, R>) => Metric<I, B, E, R>
  <I, A, E, R, B>(self: Metric<I, A, E, R>, f: (value: A) => B): Metric<I, B, E, R>
} = dual(
  2,
  <I, A, E, R, B>(self: Metric<I, A, E, R>, f: (value: A) => B) =>
    make(self.id, (input: I) => Effect.map(self.run(input), f))
)

/**
 * Transforms the input of a `Metric`.
 *
 * **When to use**
 *
 * Use to grade a different input type with an existing metric.
 *
 * @category combinators
 * @since 0.1.0
 */
export const mapInput: {
  <I, J>(f: (input: J) => I): <A, E, R>(self: Metric<I, A, E, R>) => Metric<J, A, E, R>
  <I, A, E, R, J>(self: Metric<I, A, E, R>, f: (input: J) => I): Metric<J, A, E, R>
} = dual(
  2,
  <I, A, E, R, J>(self: Metric<I, A, E, R>, f: (input: J) => I) =>
    make(self.id, (input: J) => self.run(f(input)))
)

/**
 * Provides a layer to the effect run by a `Metric`.
 *
 * **When to use**
 *
 * Use to satisfy a metric's requirements before running it.
 *
 * **Details**
 *
 * The layer's output is removed from the requirement channel and its input
 * added, mirroring `Layer.provide`. Partial provision is expressed with a
 * narrower layer rather than a separate combinator.
 *
 * @category providing services
 * @since 0.1.0
 */
export const provide: {
  <ROut, E2, RIn>(
    layer: Layer.Layer<ROut, E2, RIn>
  ): <I, A, E, R>(self: Metric<I, A, E, R>) => Metric<I, A, E | E2, Exclude<R, ROut> | RIn>
  <I, A, E, R, ROut, E2, RIn>(
    self: Metric<I, A, E, R>,
    layer: Layer.Layer<ROut, E2, RIn>
  ): Metric<I, A, E | E2, Exclude<R, ROut> | RIn>
} = dual(
  2,
  <I, A, E, R, ROut, E2, RIn>(self: Metric<I, A, E, R>, layer: Layer.Layer<ROut, E2, RIn>) =>
    make(self.id, (input: I) => Effect.provide(self.run(input), layer))
)

/**
 * A `Metric` with all type parameters erased.
 *
 * @category utility types
 * @since 0.1.0
 */
export type Any = Metric<any, any, any, any>

type Input<M> = M extends Metric<infer I, any, any, any> ? I : never

type Success<M> = M extends Metric<any, infer A, any, any> ? A : never

type Error<M> = M extends Metric<any, any, infer E, any> ? E : never

type Context<M> = M extends Metric<any, any, any, infer R> ? R : never

type SharedInput<M extends Readonly<Record<string, Any>>> =
  { [K in keyof M]: (input: Input<M[K]>) => void }[keyof M] extends (input: infer I) => void ? I
    : never

/**
 * Runs a record of metrics over one shared input.
 *
 * **Details**
 *
 * Results are keyed like the record; errors and requirements are unioned.
 *
 * @category combining
 * @since 0.1.0
 */
export const all = <const M extends Readonly<Record<string, Any>>>(metrics: M): Metric<
  SharedInput<M>,
  { readonly [K in keyof M]: Success<M[K]> },
  Error<M[keyof M]>,
  Context<M[keyof M]>
> =>
  make(
    `all(${Object.entries(metrics).map(([key, metric]) => `${key}:${metric.id}`).join(",")})`,
    (input: SharedInput<M>) =>
      // SAFETY: Effect.all over the mapped record keeps each key's success; the union of the
      // members' errors and requirements is exactly Error/Context of M[keyof M].
      Effect.all(Record.map(
        metrics,
        (metric: Metric<SharedInput<M>, unknown, Error<M[keyof M]>, Context<M[keyof M]>>) =>
          metric.run(input)
      )) as Effect.Effect<
        { readonly [K in keyof M]: Success<M[K]> },
        Error<M[keyof M]>,
        Context<M[keyof M]>
      >
  )
