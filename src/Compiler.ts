/**
 * Compiling a program into an `Artifact`.
 *
 * `compile` checks the program, evaluates the baseline on validation, hands the
 * search to an `Optimizer`, and encodes the selected parameters with each
 * node's own codecs.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Schema from "effect/Schema"
import type * as Artifact from "./Artifact.ts"
import * as Dataset from "./Dataset.ts"
import * as Demonstration from "./Demonstration.ts"
import { ConfigurationError, type MetricValidationError } from "./Errors.ts"
import * as Evaluation from "./Evaluation.ts"
import { evaluate } from "./internal/evaluation.ts"
import * as Manifest from "./internal/manifest.ts"
import type * as Optimizer from "./Optimizer.ts"
import type * as Program from "./Program.ts"

const summary = (report: Evaluation.Report): Artifact.Artifact["results"]["baseline"] => ({
  meanScore: report.meanScore,
  scores: report.scores.map(({ id, score }) => ({ id, score }))
})

const compileImpl = <I, O, PE, PR, X, OE, OR, ME, MR>(
  program: Program.Program<I, O, PE, PR>,
  optimizer: Optimizer.Optimizer<I, X, OE, OR>,
  evaluator: Evaluation.Evaluator<I, O, X, ME, MR>
) =>
  Effect.gen(function*() {
    if (program.linked) {
      return yield* new ConfigurationError({
        message: "Compile a source program, not a linked one"
      })
    }

    if (program.nodes.length === 0) {
      return yield* new ConfigurationError({
        message: "Compilation requires at least one registered node"
      })
    }

    if (evaluator.dataset.split?.role === "test") {
      return yield* new ConfigurationError({
        message: "Test datasets must not be used for compilation"
      })
    }

    const manifest = yield* Manifest.make(program)
    const inventory = yield* Manifest.inventory(program)

    const evaluateWith = (
      dataset: Dataset.Dataset<I, X>,
      parameters: Optimizer.Candidate["parameters"]
    ) =>
      evaluate(
        program,
        Evaluation.withConcurrency(
          Evaluation.make(dataset, evaluator.metric),
          evaluator.concurrency
        ),
        {
          parameters,
          inventory
        }
      )

    const baseline = yield* evaluateWith(evaluator.dataset, {})

    const selected = yield* optimizer.search<
      PE | ME | ConfigurationError | MetricValidationError,
      PR | MR
    >({ nodes: program.nodes, validation: evaluator.dataset, baseline, evaluate: evaluateWith })

    const parameters: Record<string, Artifact.Artifact["parameters"][string]> = {}

    for (const [id, demonstrations] of Object.entries(selected.parameters)) {
      const node = inventory.get(id)

      if (node === undefined || (!node.tuning.demonstrations && demonstrations.length > 0)) {
        return yield* new ConfigurationError({
          message: `Optimizer selected parameters for an unknown or non-tunable node: ${id}`
        })
      }

      const codec = Schema.Array(Demonstration.schema(node.signature.input, node.signature.output))

      parameters[id] = yield* Schema.encodeEffect(codec)(demonstrations).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ input: Schema.Json, output: Schema.Json }))
          )
        )
      )
    }

    return {
      version: 1,
      programId: program.id,
      revision: program.revision,
      manifest,
      parameters,
      provenance: {
        optimizer: { name: optimizer.name, settings: optimizer.settings },
        validation: Dataset.provenance(evaluator.dataset),
        metric: evaluator.metric.id
      },
      results: { baseline: summary(baseline), selected: summary(selected.report) }
    } satisfies Artifact.Artifact
  })

/**
 * Compiles a program with an optimizer, selecting parameters on the
 * evaluator's validation set.
 *
 * @category running
 * @since 0.1.0
 */
export const compile: {
  <I, O, X, OE, OR, ME, MR>(
    optimizer: Optimizer.Optimizer<I, X, OE, OR>,
    evaluator: Evaluation.Evaluator<I, O, X, ME, MR>
  ): <PE, PR>(
    program: Program.Program<I, O, PE, PR>
  ) => Effect.Effect<
    Artifact.Artifact,
    PE | OE | ME | ConfigurationError | MetricValidationError | Schema.SchemaError,
    PR | OR | MR
  >
  <I, O, PE, PR, X, OE, OR, ME, MR>(
    program: Program.Program<I, O, PE, PR>,
    optimizer: Optimizer.Optimizer<I, X, OE, OR>,
    evaluator: Evaluation.Evaluator<I, O, X, ME, MR>
  ): Effect.Effect<
    Artifact.Artifact,
    PE | OE | ME | ConfigurationError | MetricValidationError | Schema.SchemaError,
    PR | OR | MR
  >
} = dual(3, compileImpl)
