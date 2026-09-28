/**
 * Scoring a program over a dataset.
 *
 * An `Evaluator` pairs a `Dataset` with a `Metric` over {@link Case}s. Running
 * it executes the program once per example, grades each result, and returns a
 * {@link Report} with the observations each run recorded.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Dataset from "./Dataset.ts"
import type { ConfigurationError, MetricValidationError } from "./Errors.ts"
import { evaluate } from "./internal/evaluation.ts"
import type * as Metric from "./Metric.ts"
import type { Observation } from "./Observation.ts"
import type * as Program from "./Program.ts"

/**
 * What a metric grades: an example, the program's output, and its trace.
 *
 * @category models
 * @since 0.1.0
 */
export interface Case<I, O, X> extends Dataset.Example<I, X> {
  readonly actual: O
  readonly observations: ReadonlyArray<Observation>
}

/**
 * The per-example scores of one evaluation and their mean.
 *
 * @category models
 * @since 0.1.0
 */
export interface Report {
  readonly scores: ReadonlyArray<{
    readonly id: string
    readonly score: number
    readonly observations: ReadonlyArray<Observation>
  }>
  readonly meanScore: number
}

/**
 * Runtime identifier for `Evaluator` values.
 *
 * @category type IDs
 * @since 0.1.0
 */
export const TypeId = "~effect-dspy/Evaluation/Evaluator"

/**
 * A dataset and the metric that scores each of its examples.
 *
 * @category models
 * @since 0.1.0
 */
export interface Evaluator<I, O, X, E = never, R = never> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly dataset: Dataset.Dataset<I, X>
  readonly metric: Metric.Metric<Case<I, O, X>, number, E, R>
  readonly concurrency: number
}

const Proto = { ...Pipeable.Prototype, [TypeId]: TypeId }

/**
 * Returns `true` when a value is an `Evaluator`.
 *
 * @category guards
 * @since 0.1.0
 */
export const isEvaluator = (
  u: unknown
): u is Evaluator<unknown, unknown, unknown, unknown, unknown> => Predicate.hasProperty(u, TypeId)

/**
 * Creates an `Evaluator` that grades examples one at a time.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <I, O, X, E, R>(
  dataset: Dataset.Dataset<I, X>,
  metric: Metric.Metric<Case<I, O, X>, number, E, R>
): Evaluator<I, O, X, E, R> =>
  Object.assign(Object.create(Proto), { dataset, metric, concurrency: 1 })

/**
 * Returns a copy of an `Evaluator` that grades up to `concurrency` examples at once.
 *
 * @category combinators
 * @since 0.1.0
 */
export const withConcurrency: {
  (concurrency: number): <I, O, X, E, R>(self: Evaluator<I, O, X, E, R>) => Evaluator<I, O, X, E, R>
  <I, O, X, E, R>(self: Evaluator<I, O, X, E, R>, concurrency: number): Evaluator<I, O, X, E, R>
} = dual(
  2,
  <I, O, X, E, R>(self: Evaluator<I, O, X, E, R>, concurrency: number): Evaluator<I, O, X, E, R> =>
    Object.assign(Object.create(Proto), { dataset: self.dataset, metric: self.metric, concurrency })
)

/**
 * Runs a program over the evaluator's dataset and scores every example.
 *
 * **Details**
 *
 * Program and metric failures fail the evaluation. Scores must be finite and
 * within `[0, 1]`.
 *
 * @category running
 * @since 0.1.0
 */
export const run: {
  <I, O, X, ME, MR>(
    evaluator: Evaluator<I, O, X, ME, MR>
  ): <PE, PR>(
    program: Program.Program<I, O, PE, PR>
  ) => Effect.Effect<Report, PE | ME | ConfigurationError | MetricValidationError, PR | MR>
  <I, O, PE, PR, X, ME, MR>(
    program: Program.Program<I, O, PE, PR>,
    evaluator: Evaluator<I, O, X, ME, MR>
  ): Effect.Effect<Report, PE | ME | ConfigurationError | MetricValidationError, PR | MR>
} = dual(
  2,
  <I, O, PE, PR, X, ME, MR>(
    program: Program.Program<I, O, PE, PR>,
    evaluator: Evaluator<I, O, X, ME, MR>
  ) => evaluate(program, evaluator)
)
