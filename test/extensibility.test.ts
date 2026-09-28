import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Schema } from "effect"
import {
  Artifact,
  Compiler,
  ConfigurationError,
  Dataset,
  Evaluation,
  Metric,
  Node,
  Observation,
  Optimizer,
  Program,
  Signature
} from "../src/index.ts"

const signature = Signature.make(Schema.Finite, Schema.Finite)

// A node that is not a Predict: it scales its input by the ratio shown in its first
// learned demonstration, and reports each call like any other node.
const scale: Node.Node<number, number> = {
  [Node.TypeId]: Node.TypeId,
  id: "scale",
  signature,
  tuning: { demonstrations: true },
  fixed: Effect.succeed({ kind: "scale" })
}

const runScale = (n: number) =>
  Effect.gen(function*() {
    const [demo] = yield* Node.learned(scale)
    const output = demo === undefined ? n : n * (demo.output / demo.input)
    yield* Observation.record({ nodeId: scale.id, input: n, exit: Exit.succeed(output) })

    return output
  })

const program = Program.make("pipeline", (n: number) => Effect.map(runScale(n), (x) => x + 1)).pipe(
  Program.withSignature(signature),
  Program.withNodes(scale),
  Program.withRevision("1")
)

// An optimizer that proposes hand-labelled demonstrations and keeps them only if they help.
const labelled = (demonstrations: Node.Parameters) =>
  Optimizer.make<number, number, never, never>(
    "labelled",
    { count: Object.keys(demonstrations).length },
    (context) =>
      Effect.map(
        context.evaluate(context.validation, demonstrations),
        (report): Optimizer.Candidate =>
          report.meanScore > context.baseline.meanScore
            ? { parameters: demonstrations, report }
            : { parameters: {}, report: context.baseline }
      )
  )

const row = Schema.Struct({ id: Schema.String, input: Schema.Finite, expected: Schema.Finite })

const exact = Metric.make(
  "exact",
  (c: Evaluation.Case<number, number, number>) => Effect.succeed(c.actual === c.expected ? 1 : 0)
)

describe("open-world nodes and optimizers", () => {
  it.effect("compiles and links a custom node with a custom optimizer", () =>
    Effect.gen(function*() {
      const validation = yield* Dataset.fromIterable("validation", row, [
        { id: "a", input: 2, expected: 7 },
        { id: "b", input: 5, expected: 16 }
      ])

      const evaluator = Evaluation.make(validation, exact)
      const optimizer = labelled({ scale: [{ input: 1, output: 3 }] })
      const artifact = yield* program.pipe(Compiler.compile(optimizer, evaluator))

      expect(artifact.provenance.optimizer).toEqual({ name: "labelled", settings: { count: 1 } })
      expect(artifact.results.selected.meanScore).toBe(1)

      const linked = yield* Artifact.encode(artifact).pipe(
        Effect.flatMap(Artifact.decode),
        Effect.flatMap((restored) => Program.link(program, restored))
      )

      expect(yield* linked.run(4)).toBe(13)
      expect(yield* program.run(4)).toBe(5)
    }))

  it.effect("rejects nodes that run without being registered", () =>
    Effect.gen(function*() {
      const validation = yield* Dataset.fromIterable("validation", row, [{
        id: "a",
        input: 1,
        expected: 2
      }])

      const unregistered = Program.make("unregistered", runScale).pipe(
        Program.withSignature(signature),
        Program.withNodes({ ...scale, id: "other" }),
        Program.withRevision("1")
      )

      const error = yield* unregistered.pipe(
        Compiler.compile(labelled({}), Evaluation.make(validation, exact)),
        Effect.flip
      )

      expect(error).toBeInstanceOf(ConfigurationError)
      expect(error.message).toBe("Unregistered node definition: scale")
    }))
})
