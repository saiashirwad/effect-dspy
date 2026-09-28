import * as Effect from "effect/Effect"
import { sumAll } from "effect/Number"
import * as Schema from "effect/Schema"
import type { Example } from "../Dataset.ts"
import { ConfigurationError, MetricValidationError } from "../Errors.ts"
import type { Evaluator, Report } from "../Evaluation.ts"
import * as Node from "../Node.ts"
import * as Observation from "../Observation.ts"
import type * as Program from "../Program.ts"
import { Score } from "./util.ts"

const isScore = Schema.is(Score)

/** @internal */
export type Scope = typeof Node.CurrentParameters.Service

// Parameters and the observer scope the program run only; the grader runs outside them.
/** @internal */
export const evaluate = <I, O, PE, PR, X, ME, MR>(
  program: Program.Program<I, O, PE, PR>,
  evaluator: Evaluator<I, O, X, ME, MR>,
  scope?: Scope
): Effect.Effect<Report, PE | ME | ConfigurationError | MetricValidationError, PR | MR> =>
  Effect.gen(function*() {
    const { dataset, metric, concurrency } = evaluator

    if (!Number.isInteger(concurrency) || concurrency < 1) {
      return yield* new ConfigurationError({
        message: "Evaluation concurrency must be a positive integer"
      })
    }

    if (dataset.examples.length === 0) {
      return yield* new ConfigurationError({
        message: `Evaluation requires a nonempty dataset: ${dataset.id}`
      })
    }

    const grade = Effect.fnUntraced(function*(example: Example<I, X>) {
      const observations: Array<Observation.Observation> = []

      const observer: Observation.Observer = {
        record: (o) => Effect.sync(() => observations.push(o))
      }

      const run = Effect.provideService(program.run(example.input), Observation.Observer, observer)

      const actual = yield* scope === undefined
        ? run
        : Effect.provideService(run, Node.CurrentParameters, scope)

      const score = yield* metric.run({ ...example, actual, observations })

      if (!isScore(score)) {
        return yield* new MetricValidationError({
          message: `Metric ${metric.id} returned an invalid score for ${example.id}: ${
            String(score)
          }`
        })
      }

      return { id: example.id, score, observations }
    })

    const scores = yield* Effect.forEach(dataset.examples, grade, { concurrency })

    return { scores, meanScore: sumAll(scores.map((s) => s.score)) / scores.length }
  })
