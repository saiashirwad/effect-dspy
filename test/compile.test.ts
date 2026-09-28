import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Schema, Stream } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import type { Response } from "effect/unstable/ai"
import {
  Artifact,
  Compiler,
  Dataset,
  DatasetError,
  Evaluation,
  Metric,
  Optimizer,
  Predict,
  Program,
  Signature
} from "../src/index.ts"

const signature = Signature.make(
  Schema.Struct({ n: Schema.Finite }),
  Schema.Struct({ doubled: Schema.Finite })
)

const Prompt = Schema.fromJsonString(Schema.Struct({
  instructions: Schema.String,
  demonstrations: Schema.Array(Schema.Struct({ input: signature.input, output: signature.output })),
  input: signature.input
}))

// Doubles small numbers unaided, and any number once it has seen a worked example.
const model = (prompts: Array<typeof Prompt.Type>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: ({ prompt }) =>
        Effect.gen(function*() {
          const text = prompt.content.flatMap((message) =>
            message.role === "user"
              ? message.content.flatMap((part) => part.type === "text" ? [part.text] : [])
              : []
          ).join("")

          const request = yield* Schema.decodeEffect(Prompt)(text)
          prompts.push(request)

          const { n } = request.input
          const doubled = n <= 3 || request.demonstrations.length > 0 ? n * 2 : n

          const part: Response.PartEncoded = { type: "text", text: JSON.stringify({ doubled }) }

          return [part]
        }).pipe(Effect.orDie),
      streamText: () => Stream.empty
    })
  )

const row = Schema.Struct({ id: Schema.String, input: signature.input, expected: Schema.Finite })

const rows = (prefix: string, ns: ReadonlyArray<number>) =>
  ns.map((n) => ({ id: `${prefix}${n}`, input: { n }, expected: n * 2 }))

const accuracy = Metric.make(
  "accuracy",
  (c: Evaluation.Case<{ readonly n: number }, { readonly doubled: number }, number>) =>
    Effect.succeed(c.actual.doubled === c.expected ? 1 : 0)
)

const double = Predict.make("double", signature).pipe(
  Predict.withInstructions("Double n."),
  Predict.withTuning({ demonstrations: true })
)

const program = Program.fromPredict(double).pipe(Program.withRevision("1"))

describe("compile, serialize, link", () => {
  it.effect("learns demonstrations that fix the validation set and replays them after linking", () => {
    const prompts: Array<typeof Prompt.Type> = []

    return Effect.gen(function*() {
      const train = yield* Dataset.fromIterable("train", row, rows("t", [1, 2, 3]))
      const validation = yield* Dataset.fromIterable("validation", row, rows("v", [10, 20]))
      const evaluator = Evaluation.make(validation, accuracy)

      const optimizer = Optimizer.bootstrapFewShot(train, {
        maxDemos: 2,
        maxCandidates: 3,
        acceptScore: 1,
        seed: "search"
      })

      const artifact = yield* program.pipe(Compiler.compile(optimizer, evaluator))

      expect(artifact.results.baseline.meanScore).toBe(0)
      expect(artifact.results.selected.meanScore).toBe(1)
      expect(artifact.provenance.optimizer.name).toBe("bootstrapFewShot")

      // Learned demonstrations are successful training traces, stored in encoded form.
      const traces = [1, 2, 3].map((n) => ({ input: { n }, output: { doubled: n * 2 } }))
      expect(artifact.parameters.double.length).toBeGreaterThan(0)

      for (const demo of artifact.parameters.double) expect(traces).toContainEqual(demo)

      const restored = yield* Artifact.encode(artifact).pipe(Effect.flatMap(Artifact.decode))
      expect(restored).toEqual(artifact)

      const linked = yield* program.pipe(Program.link(restored))
      const report = yield* linked.pipe(Evaluation.run(evaluator))

      expect(report.meanScore).toBe(1)
      expect(report.scores[0].observations.map((o) => o.nodeId)).toEqual(["double"])
      expect(prompts.at(-1)?.demonstrations).toEqual(artifact.parameters.double)

      // The source definition is untouched by compilation and linking.
      expect((yield* program.pipe(Evaluation.run(evaluator))).meanScore).toBe(0)
    }).pipe(Effect.provide(model(prompts)))
  })

  it.effect("refuses to link an artifact against a changed program", () =>
    Effect.gen(function*() {
      const train = yield* Dataset.fromIterable("train", row, rows("t", [1, 2]))
      const validation = yield* Dataset.fromIterable("validation", row, rows("v", [10]))

      const artifact = yield* program.pipe(
        Compiler.compile(
          Optimizer.bootstrapFewShot(train, {
            maxDemos: 1,
            maxCandidates: 2,
            acceptScore: 1,
            seed: "s"
          }),
          Evaluation.make(validation, accuracy)
        )
      )

      const reworded = Program.fromPredict(double.pipe(Predict.withInstructions("Double n!"))).pipe(
        Program.withRevision("1")
      )

      const errors = yield* Effect.all([
        reworded.pipe(Program.link(artifact), Effect.flip),
        program.pipe(Program.withRevision("2"), Program.link(artifact), Effect.flip)
      ])

      expect(errors.map((error) => error._tag)).toEqual(["ArtifactError", "ArtifactError"])
    }).pipe(Effect.provide(model([]))))

  it.effect("splits datasets reproducibly into disjoint, exhaustive partitions", () =>
    Effect.gen(function*() {
      const dataset = yield* Dataset.fromIterable("all", row, rows("x", [1, 2, 3, 4, 5, 6, 7]))
      const options = { train: 0.5, validation: 0.5, test: 0, seed: "split" }
      const first = yield* Dataset.split(dataset, options)
      const second = yield* Dataset.split(dataset, options)
      const ids = (d: Dataset.Dataset<unknown, unknown>) => d.examples.map((example) => example.id)

      expect(ids(first.train)).toEqual(ids(second.train))
      expect(first.test.examples).toHaveLength(0)
      expect([...ids(first.train), ...ids(first.validation)].sort()).toEqual(ids(dataset).sort())
      expect(first.train.hash).not.toBe(first.validation.hash)

      const duplicate = yield* Dataset.fromIterable("dup", row, [
        ...rows("x", [1]),
        ...rows("x", [1])
      ])
        .pipe(Effect.flip)

      expect(duplicate).toBeInstanceOf(DatasetError)
    }))
})
