import { Console, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import {
  Artifact,
  Compiler,
  Dataset,
  DeepSeek,
  Evaluation,
  Metric,
  Optimizer,
  Predict,
  Program,
  Signature
} from "../src/index.ts"

const signature = Signature.make(
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ sentiment: Schema.Literals(["positive", "negative"]) })
)

const classify = Predict.make("sentiment/classify", signature).pipe(
  Predict.withInstructions("Classify the sentiment of the text as positive or negative."),
  Predict.withTuning({ demonstrations: true })
)

const program = Program.fromPredict(classify).pipe(Program.withRevision("1"))

const row = Schema.Struct({
  id: Schema.String,
  input: signature.input,
  expected: signature.output
})

type Case = Evaluation.Case<
  typeof signature.input.Type,
  typeof signature.output.Type,
  typeof signature.output.Type
>

const accuracy = Metric.make(
  "sentiment/accuracy",
  (example: Case) => Effect.succeed(example.actual.sentiment === example.expected.sentiment ? 1 : 0)
)

const main = Effect.gen(function*() {
  // Fixed tiny data, seeded membership, disjoint train/validation IDs.
  const dataset = yield* Dataset.fromIterable("sentiment/toy-v1", row, [
    { id: "love", input: { text: "I love this!" }, expected: { sentiment: "positive" } },
    {
      id: "great",
      input: { text: "A wonderful experience." },
      expected: { sentiment: "positive" }
    },
    { id: "hate", input: { text: "I hate this." }, expected: { sentiment: "negative" } },
    { id: "awful", input: { text: "An awful experience." }, expected: { sentiment: "negative" } }
  ])

  const { train, validation } = yield* dataset.pipe(
    Dataset.split({ train: 0.5, validation: 0.5, test: 0, seed: "sentiment/split-v1" })
  )

  const ids = (dataset: Dataset.Dataset<unknown, unknown>) => dataset.examples.map((e) => e.id)
  yield* Console.log({ train: ids(train), validation: ids(validation) })

  const evaluator = Evaluation.make(validation, accuracy)

  const optimizer = Optimizer.bootstrapFewShot(train, {
    maxDemos: 1,
    maxCandidates: 2, // Includes the source baseline: at most one additional candidate.
    acceptScore: 1,
    seed: "sentiment/search-v1"
  })

  // Compilation evaluates the source baseline, runs the teacher on train,
  // then evaluates at most one candidate on validation. All run sequentially.
  const artifact = yield* program.pipe(Compiler.compile(optimizer, evaluator))

  // A real JSON roundtrip; no additional model requests. The string can be
  // persisted, but this example keeps it in memory and never dumps its traces.
  const json = yield* Artifact.encode(artifact)
  const restored = yield* Artifact.decode(json)
  const linked = yield* program.pipe(Program.link(restored))

  // Fresh model calls demonstrate execution of the linked program.
  // This reuses validation to keep costs low; it is NOT a held-out test score.
  const report = yield* linked.pipe(Evaluation.run(evaluator))
  yield* Console.log({
    baselineValidationScore: artifact.results.baseline.meanScore,
    selectedValidationScore: artifact.results.selected.meanScore,
    artifactBytes: Buffer.byteLength(json, "utf8"),
    linkedValidationScore: report.meanScore,
    linkedValidationScores: report.scores.map(({ id, score }) => ({ id, score }))
  })
})

// Missing credentials, HTTP errors, invalid model output, and artifact errors
// remain failures. Never silently replace the provider with a mock.
await Effect.runPromise(main.pipe(
  Effect.provide(
    DeepSeek.layerFromEnv({ maxTokens: 128, temperature: 0 }).pipe(
      Layer.provide(FetchHttpClient.layer)
    )
  ),
  Effect.timeout("3 minutes")
))
