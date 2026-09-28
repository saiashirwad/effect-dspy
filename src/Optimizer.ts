/**
 * Search strategies for learned parameters.
 *
 * An `Optimizer` receives a {@link Context} from `Compiler.compile` (the
 * program's nodes, the validation set, the baseline report, and a way to
 * evaluate candidate parameters) and returns the {@link Candidate} it selects.
 * {@link bootstrapFewShot} is one implementation; others implement the same
 * interface without changes to the compiler.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Dataset from "./Dataset.ts"
import type { Demonstration } from "./Demonstration.ts"
import { ConfigurationError } from "./Errors.ts"
import type * as Evaluation from "./Evaluation.ts"
import { Score, seeded, shuffle } from "./internal/util.ts"
import type * as Node from "./Node.ts"

/**
 * Runtime identifier for `Optimizer` values.
 *
 * @category type IDs
 * @since 0.1.0
 */
export const TypeId = "~effect-dspy/Optimizer"

/**
 * What the compiler gives an optimizer.
 *
 * @category models
 * @since 0.1.0
 */
export interface Context<I, X, E, R> {
  readonly nodes: ReadonlyArray<Node.Any>
  readonly validation: Dataset.Dataset<I, X>
  readonly baseline: Evaluation.Report
  /** Runs the program over `dataset` with `parameters` in scope. */
  readonly evaluate: (
    dataset: Dataset.Dataset<I, X>,
    parameters: Node.Parameters
  ) => Effect.Effect<Evaluation.Report, E, R>
}

/**
 * Parameters and the validation report that justified choosing them.
 *
 * @category models
 * @since 0.1.0
 */
export interface Candidate {
  readonly parameters: Node.Parameters
  readonly report: Evaluation.Report
}

/**
 * A search strategy over learned parameters.
 *
 * **Details**
 *
 * `name` and `settings` are recorded in artifact provenance.
 *
 * @category models
 * @since 0.1.0
 */
export interface Optimizer<I, X, E = never, R = never> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly name: string
  readonly settings: Schema.Json
  readonly search: <E2, R2>(
    context: Context<I, X, E2, R2>
  ) => Effect.Effect<Candidate, E | E2, R | R2>
}

const Proto = { ...Pipeable.Prototype, [TypeId]: TypeId }

/**
 * Returns `true` when a value is an `Optimizer`.
 *
 * @category guards
 * @since 0.1.0
 */
export const isOptimizer = (u: unknown): u is Optimizer<unknown, unknown, unknown, unknown> =>
  Predicate.hasProperty(u, TypeId)

/**
 * Creates an `Optimizer` from a name, provenance settings, and a search.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <I, X, E, R>(
  name: string,
  settings: Schema.Json,
  search: <E2, R2>(context: Context<I, X, E2, R2>) => Effect.Effect<Candidate, E | E2, R | R2>
): Optimizer<I, X, E, R> => Object.assign(Object.create(Proto), { name, settings, search })

const BootstrapOptions = Schema.Struct({
  maxDemos: Schema.Int.check(Schema.isGreaterThan(0)),
  maxCandidates: Schema.Int.check(Schema.isGreaterThan(0)),
  acceptScore: Score,
  seed: Schema.String
})

/**
 * Settings for {@link bootstrapFewShot}.
 *
 * @category models
 * @since 0.1.0
 */
export type BootstrapOptions = typeof BootstrapOptions.Type

const demonstrationCount = (parameters: Node.Parameters): number =>
  Object.values(parameters).reduce((sum, demonstrations) => sum + demonstrations.length, 0)

/**
 * Bootstrap few-shot search over demonstrations.
 *
 * **Details**
 *
 * Runs the source program once over `train` and keeps the traces of examples
 * scoring at least `acceptScore`. Each candidate then samples up to `maxDemos`
 * of those traces per tunable node. `maxCandidates` counts the baseline;
 * candidates are evaluated sequentially. A candidate replaces the current
 * choice only with a higher mean, or an equal mean and fewer demonstrations, so
 * the baseline wins ties.
 *
 * @category constructors
 * @since 0.1.0
 */
export const bootstrapFewShot = <I, X>(
  train: Dataset.Dataset<I, X>,
  options: BootstrapOptions
): Optimizer<I, X, ConfigurationError> =>
  make(
    "bootstrapFewShot",
    { ...options, train: Dataset.provenance(train) },
    (context) =>
      Effect.gen(function*() {
        const { maxDemos, maxCandidates, acceptScore, seed } = yield* Schema.decodeEffect(
          BootstrapOptions
        )(options)
          .pipe(
            Effect.mapError((cause) =>
              new ConfigurationError({
                message: `Invalid bootstrap options: ${cause.message}`,
                cause
              })
            )
          )

        const validationIds = new Set(context.validation.examples.map((example) => example.id))

        if (train.split?.role === "test") {
          return yield* new ConfigurationError({
            message: "Test datasets must not be used for training"
          })
        }

        if (train.examples.some((example) => validationIds.has(example.id))) {
          return yield* new ConfigurationError({
            message: "Training and validation example IDs must not overlap"
          })
        }

        const tunable = new Set(
          context.nodes.filter((node) => node.tuning.demonstrations).map((node) => node.id)
        )

        const training = yield* context.evaluate(train, {})
        const pools = new Map<string, Array<Demonstration<unknown, unknown>>>()

        for (const { score, observations } of training.scores) {
          if (score < acceptScore) continue

          for (const { nodeId, input, exit } of observations) {
            if (!tunable.has(nodeId) || Exit.isFailure(exit)) continue

            const pool = pools.get(nodeId) ?? []
            pool.push({ input, output: exit.value })
            pools.set(nodeId, pool)
          }
        }

        const random = seeded(seed)
        let selected: Candidate = { parameters: {}, report: context.baseline }

        for (let candidate = 1; candidate < maxCandidates; candidate++) {
          const parameters: Record<string, ReadonlyArray<Demonstration<unknown, unknown>>> = {}

          for (const [nodeId, pool] of pools) {
            const size = 1 + Math.floor(random() * Math.min(maxDemos, pool.length))
            parameters[nodeId] = shuffle([...pool], random).slice(0, size)
          }

          if (demonstrationCount(parameters) === 0) break

          const report = yield* context.evaluate(context.validation, parameters)

          if (
            report.meanScore > selected.report.meanScore
            || (report.meanScore === selected.report.meanScore
              && demonstrationCount(parameters) < demonstrationCount(selected.parameters))
          ) {
            selected = { parameters, report }
          }
        }

        return selected
      })
  )
