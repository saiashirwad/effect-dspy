# Effect-DSPy — Specification (draft)

**Status:** exploratory draft, checked against the source in September 2026. Sections may lag the code; the source is authoritative. Everything here can change.

## 1. Purpose and scope

**Effect-DSPy makes semantic operations evaluable and optimizable inside ordinary Effect programs.**

A _semantic operation_ is a typed model-backed computation, such as classification, extraction, or answering a question. Users compose these operations in application code, measure their behavior, and optionally optimize selected parameters.

The inspiration is DSPy’s separation of program structure from optimizable instructions and demonstrations. This is an Effect-native design, not a compatibility port of the Python API.

The current version optimizes **few-shot demonstrations**. Instructions are configurable but remain fixed during optimization. Compilation produces a data artifact; it does not rewrite TypeScript or guarantee better out-of-sample performance.

### Ecosystem boundaries

**Effect and Effect AI are the foundations.** Effect supplies execution and composition. `Predict` uses Effect AI’s `LanguageModel.generateObject` for structured generation rather than implementing another provider abstraction.

**Effect Agent is an optional integration, not a dependency.** It already supplies agent execution through Effects and Streams. An application can call it from a program, but optimizing the agent’s internal configuration will require an explicit adapter. That adapter is outside v0.

**Jev and decision models are future backends for additional node types.** Effect AI’s `DecisionModel` handles structured decisions; TypeSafe AI describes Jev as producing typed decisions with probabilities. Neither determines the core program or optimizer abstractions. Decision-node support is outside v0.

The distinction is deliberate: **being callable from an Effect program does not automatically make an operation’s internals optimizable.**

## 2. API conventions

Library definitions are plain, immutable-by-contract objects built on shared prototypes, with `isX` guards and pipeable combinators. They are not deeply frozen or detached from caller-owned data; callers must not mutate definitions or their nested values. Constructors take essential arguments; combinators apply optional configuration. Suitable combinators support both data-first and data-last forms:

```ts
Predict.withInstructions(Answer, instructions)

Answer.pipe(Predict.withInstructions(instructions))
```

Execution uses `.run(input)`. Definitions are not also callable functions.

Ordinary functions and Effect remain the composition language. There are no library-specific branching, looping, concurrency, retry, or dependency-injection primitives.

Definition construction is pure. Dataset ingestion, evaluation, compilation, artifact linking, and serialization return Effects.

---

## 3. Signatures and predictors

### `Signature`

```ts
import { Effect, Schema, Stream } from "effect"

import {
  Artifact,
  Compiler,
  Dataset,
  Evaluation,
  Metric,
  Optimizer,
  Predict,
  Program,
  Signature
} from "effect-dspy"

const AnswerQuestion = Signature.make(
  Schema.Struct({
    question: Schema.String,
    context: Schema.Array(Schema.String)
  }),
  Schema.Struct({
    answer: Schema.String,
    citations: Schema.Array(Schema.Number)
  })
)
```

A signature retains its concrete input and output schemas:

```ts
AnswerQuestion.input
AnswerQuestion.output
```

Use Effect schemas/codecs with JSON-compatible encodings. JSON boundaries use Effect’s `Schema.Json`, not a library-specific JSON module. Preserve their decoded types and encoding/decoding dependencies rather than erasing them. Predictor outputs must encode as objects in v0, matching the underlying structured-generation API.

Field descriptions belong in Schema annotations. Task-level instructions belong on the predictor.

### `Predict`

```ts
const Answer = Predict.make("qa/answer", AnswerQuestion).pipe(
  Predict.withInstructions(
    "Answer using only the supplied context. "
      + "Return zero-based indices of supporting passages."
  ),
  Predict.withTuning({
    demonstrations: true
  })
)
```

Execution returns an Effect with the signature’s output type and the operation’s errors and dependencies:

```ts
const prediction = Answer.run({
  question: "What is the refund window?",
  context: ["Refunds are available within 30 days."]
})
```

Inside an Effect generator:

```ts
const answer = Effect.gen(function*() {
  const result = yield* prediction
  return result
})
```

Predictors work immediately using source defaults. No compiler or parameter service must be configured first.

### Parameters and tuning

V0 exposes three configuration combinators:

```ts
Predict.withInstructions(text)
Predict.withDemonstrations(demonstrations)
Predict.withTuning({ demonstrations: true })
```

A demonstration contains `{ input, output }`, typed against the predictor’s signature. This differs from a dataset example’s `{ input, expected }`: a reference can describe grading criteria without being a complete predictor output.

**Tuning is opt-in.** Source instructions and manually supplied demonstrations remain fixed. Bootstrap search selects learned demonstrations only for opted-in nodes; `Predict` appends them to its fixed demonstrations.

For bootstrap few-shot search, `maxDemos` is a positive integer limiting the number of _added_ demonstrations per node. There is no built-in instruction search, model selection, or temperature tuning in v0.

### `Node`: the open protocol

`Predict` implements `Node.Node<I, O, R>`. Custom nodes implement the same protocol: `[Node.TypeId]`, a stable `id`, a `signature`, `tuning: { demonstrations: boolean }`, and `fixed`, an Effect producing JSON describing fixed configuration. Include every behavior-affecting fixed setting in that value; it is fingerprinted for compatibility.

A node’s execution function reads learned demonstrations with `Node.learned(node)` and reports executions with `Observation.record(...)`. The protocol does not require a `.run` method or constrain custom outputs to objects. Learned parameters are `Node.Parameters`, a record of node IDs to decoded `{ input, output }` demonstrations. `Demonstration.schema(input, output)` derives their codec.

## 4. Programs and node identity

A program wraps an effectful function:

```ts
type QAInput = typeof AnswerQuestion.input.Type

const QA = Program.make(
  "qa",
  Effect.fn(function*(input: QAInput) {
    return yield* Answer.run(input)
  })
).pipe(Program.withSignature(AnswerQuestion), Program.withNodes(Answer), Program.withRevision("1"))
```

The function can contain retrieval, application services, branching, parallel work, or calls to other programs. `Program` adds metadata; it does not interpret control flow.

For a single predictor, provide equivalent shorthand:

```ts
const SimpleQA = Program.fromPredict(Answer).pipe(Program.withRevision("1"))
```

`fromPredict` inherits the predictor’s ID and signature and registers it as the sole node.

### Registration rules

Use **explicit node registration**, not automatic discovery.

`Program.withNodes(...)` accepts nodes and other programs, flattening their registered inventories and deduplicating identical node objects. Reusing the same node intentionally shares parameters. Compilation and linking reject distinct node definitions with the same ID; use qualified IDs such as `"qa/answer"`. IDs must be nonblank; `$program` is not reserved.

Runtime observations discover _invocations_, not definitions. A loop can execute one registered node many times.

Execution without metadata is allowed. Compilation requires a nonblank program ID and revision, a signature, and at least one registered node. During compilation and linked execution, `Node.learned` rejects an unknown ID or a different node object reusing a registered ID. Custom implementations must use this accessor to participate in inventory enforcement.

The revision is application-managed. It must change when behavior-affecting source code or fixed configuration changes. The library does not attempt to hash arbitrary JavaScript closures.

---

## 5. Metrics

A metric is a named, pipeable wrapper around:

```ts
type MetricFunction<Input, Result, E, R> = (input: Input) => Effect.Effect<Result, E, R>
```

Metrics can return intermediate values or records. The final metric passed to evaluation must return a finite score in **`[0, 1]`, where higher is better**.

```ts
const Reference = Schema.Struct({
  answer: Schema.String
})

type QACase = Evaluation.Case<
  typeof AnswerQuestion.input.Type,
  typeof AnswerQuestion.output.Type,
  typeof Reference.Type
>

const ExactMatch = Metric.make(
  "exact-match",
  (pair: { readonly expected: string; readonly actual: string }) =>
    Effect.succeed(pair.expected === pair.actual)
)

const Accuracy = ExactMatch.pipe(
  Metric.mapInput((c: QACase) => ({
    expected: c.expected.answer,
    actual: c.actual.answer
  })),
  Metric.map((matches) => (matches ? 1 : 0))
)
```

Composition preserves normal Effect dependencies:

```ts
const CitationValidity = Metric.make("citation-validity", (c: QACase) =>
  Effect.succeed(
    c.actual.citations.length > 0
      && c.actual.citations.every(
        (index) => Number.isInteger(index) && index >= 0 && index < c.input.context.length
      )
      ? 1
      : 0
  ))

const Quality = Metric.all({
  accuracy: Accuracy,
  citations: CitationValidity
}).pipe(Metric.map(({ accuracy, citations }) => 0.8 * accuracy + 0.2 * citations))
```

These are illustrative metrics: exact matching is not a general answer-quality judge, and index validity does not establish that citations support an answer.

### Metric contract

`Evaluation.Case` contains the example ID, input, reference data, actual output, and execution observations.

`Metric.all` applies its metrics to **the same execution**; it does not rerun the program. Metric errors and dependencies compose rather than becoming `unknown`.

`Metric.provide(layer)` binds dependencies to a metric using Effect Layers. A model-based grader should use its own service or explicitly bound model Layer, separate from the program’s model.

V0 aggregates scores by arithmetic mean. There is no separate `Objective` API, generic aggregation framework, or Pareto optimization. Weighted scalar scores use `Metric.map`; raw results remain available for other analyses.

## 6. Datasets

A dataset is a **finite, validated, replayable collection**, not a live query or a one-shot stream. Its data fields are `{ id, hash, examples, split }`; `split` is undefined for an unsplit dataset.

Each example has a stable ID, input, and reference value:

```ts
const Example = Schema.Struct({
  id: Schema.String,
  input: AnswerQuestion.input,
  expected: Reference
})

const prepareDataset = (rows: Iterable<unknown>) =>
  Stream.fromIterable(rows).pipe(Dataset.collect("qa/examples-v1", Example))
```

The convenience constructor is:

```ts
Dataset.fromIterable("qa/examples-v1", Example, rows)
```

Both constructors return Effects. They decode incoming rows, reject blank or duplicate example IDs, re-encode and validate rows as JSON for a content hash, and retain the decoded examples. Encoded rows are not retained. Treat examples as immutable; the library does not create detached snapshots.

Use ordinary collections and Streams for preparation. Do not add `Dataset.map`, `Dataset.filter`, or a second collection API.

Splitting is explicit:

```ts
const prepareSplits = (rows: Iterable<unknown>) =>
  Effect.gen(function*() {
    const dataset = yield* prepareDataset(rows)
    return yield* dataset.pipe(
      Dataset.split({
        train: 0.6,
        validation: 0.2,
        test: 0.2,
        seed: "qa/split-v1"
      })
    )
  })
```

Splitting uses a seeded shuffle and largest-remainder allocation. Each partition stores its parent hash, role, and split options; its hash derives from the parent hash, role, and example IDs. `Dataset.provenance(dataset)` returns JSON containing the dataset ID, hash, example IDs, and split metadata when present.

Evaluation rejects empty datasets. Compilation rejects test-role validation datasets. The bootstrap optimizer rejects test-role training datasets and overlapping training/validation example IDs; these training checks are not a generic compiler policy.

For reference-free grading, use an explicit `null` reference schema rather than a different example format.

---

## 7. Evaluation and compilation

Evaluation and optimization are separate reusable values.

```ts
const build = (rows: Iterable<unknown>) =>
  Effect.gen(function*() {
    const dataset = yield* prepareDataset(rows)

    const { train, validation, test } = yield* dataset.pipe(
      Dataset.split({
        train: 0.6,
        validation: 0.2,
        test: 0.2,
        seed: "qa/split-v1"
      })
    )

    const evaluator = Evaluation.make(validation, Quality).pipe(Evaluation.withConcurrency(4))

    const optimizer = Optimizer.bootstrapFewShot(train, {
      maxDemos: 4,
      maxCandidates: 8,
      acceptScore: 1,
      seed: "qa/search-v1"
    })

    const artifact = yield* QA.pipe(Compiler.compile(optimizer, evaluator))

    const compiled = yield* QA.pipe(Program.link(artifact))

    const testReport = yield* compiled.pipe(Evaluation.run(Evaluation.make(test, Quality)))

    return { artifact, compiled, testReport }
  })
```

`build` still requires the program’s model and any other application or metric dependencies. The caller supplies them through Layers.

Standalone evaluation uses the same evaluator:

```ts
QA.pipe(Evaluation.run(evaluator))
```

`Evaluation.Report` is `{ scores: [{ id, score, observations }], meanScore }`. It contains no coverage, example count, elapsed time, or aggregate usage fields; usage may be present on individual observations.

Concurrency defaults to **one** and must be a positive integer. Increasing it is explicit. Bootstrap candidates are evaluated sequentially; example-level concurrency is bounded by the evaluator.

### Compiler and optimizer protocol

`Compiler.compile(program, optimizer, evaluator)` (also available pipeably) checks the source program and validation dataset, builds the compatibility manifest, and evaluates a baseline with empty learned parameters. It then calls `optimizer.search` and encodes the selected parameters with each registered node’s codecs.

`Optimizer.make(name, settings, search)` defines a custom optimizer. JSON `settings` and `name` become provenance. `search(context)` receives `{ nodes, validation, baseline, evaluate(dataset, parameters) }` and returns a `Candidate` containing `{ parameters, report }`. `evaluate` uses the evaluator’s metric and concurrency with the registered inventory and supplied parameters. Custom searches own their selection policy and must return the report justifying their selected parameters; the compiler does not rerun or independently verify that report.

### Initial optimizer: bootstrap few-shot search

`Optimizer.bootstrapFewShot(train, options)` validates its options when search runs: `maxDemos` and `maxCandidates` must be positive integers, `acceptScore` must be finite and in `[0, 1]`, and `seed` is a string. After the compiler’s baseline evaluation, it checks training eligibility and follows this procedure:

1. **Start from the compiler’s source baseline** on validation data.
2. **Run the source program once over training examples**, grading with the evaluator’s metric. Collect node input/output pairs from runs meeting `acceptScore`.
3. **Generate seeded candidate demonstration sets** for opted-in nodes and evaluate them on the same validation dataset.
4. **Select the highest-scoring completed candidate**, retaining the baseline on a tie. Among non-baseline ties, prefer fewer added demonstrations.

`maxCandidates` includes the baseline. Source demonstrations remain a fixed prefix. Candidate generation may vary the selection and ordering of added demonstrations.

Nodes without accepted training traces retain their source defaults. If no candidate improves the validation score, compilation returns a baseline artifact rather than treating the search as a failure.

Successful whole-program runs provide _weak supervision_ for intermediate demonstrations; they do not prove every intermediate step was correct. This is the same general bootstrapping idea used by DSPy, not a promise of algorithmic compatibility.

The built-in bootstrap optimizer uses the source program as its own teacher. Separate teacher-model configuration is not built in; the public optimizer protocol supports alternative search strategies.

## 8. Artifacts and deployment

An artifact is a versioned JSON-compatible value containing:

| Field group   | Contents                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Compatibility | Artifact version, program ID/revision, registered node manifest, signature and fixed-configuration fingerprints.                         |
| Parameters    | Learned demonstrations, embedded using their encoded schema representations.                                                             |
| Provenance    | `{ optimizer: { name, settings }, validation: Dataset.provenance(validation), metric }`; bootstrap settings include training provenance. |
| Results       | `{ baseline, selected }`, each `{ meanScore, scores: [{ id, score }] }`; no observations or outcome field.                               |

Artifacts contain data, not Layers or executable closures. They can embed sensitive example and provenance values: callers must exclude credentials and apply appropriate access controls.

Serialization is effectful:

```ts
const roundTrip = (artifact: Artifact.Artifact) =>
  Effect.gen(function*() {
    const json = yield* Artifact.encode(artifact)
    return yield* Artifact.decode(json)
  })
```

`Artifact.Artifact` is the single public schema and its inferred type. It validates version 1, identifiers, score ranges, unique manifest node IDs, and parameter keys targeting manifest nodes. `encode` and `decode` are JSON-string codecs returning `ArtifactError` on schema failure; `decode` rejects excess properties. For caller-constructed unknown data, use Effect Schema with `Artifact.Artifact`. There is no `Artifact.validate` or runtime freezing/cloning boundary.

Linking compares program ID, revision, and the full manifest, then decodes demonstrations with each node’s codecs and rejects unknown parameter targets or nonempty demonstrations for non-tunable nodes. It checks compatibility, not the full artifact schema; decode untrusted serialized artifacts first:

```ts
const runArtifact = (artifact: Artifact.Artifact, input: QAInput) =>
  Effect.gen(function*() {
    const restored = yield* roundTrip(artifact)
    const compiled = yield* QA.pipe(Program.link(restored))
    return yield* compiled.run(input)
  })
```

Linking does not mutate `QA` and adds no optimizer dependency to inference. Compile source programs, not already linked programs.

Signature fingerprints reject duplicate metadata-key labels rather than silently overwriting them. Local-symbol descriptions are not globally unique: fingerprints do not prove arbitrary symbol identity or closure equivalence. Callers must bump the declared revision for behavior-affecting changes, including refinement and transformation implementations. Changing the model or external environment also requires reevaluation, even when the artifact remains structurally compatible.

**Artifacts embed training-derived data and must be handled with the corresponding access controls.**

---

## 9. Runtime design

### Scoped parameters

`Node.CurrentParameters` is a public `Context.Reference` holding `{ parameters, inventory? }`, defaulting to `{ parameters: {} }`. Compilation and linked runs install an inventory of exact registered node definitions alongside their learned parameters.

Each predictor resolves parameters through `Node.learned` **when `.run` executes**. Custom nodes do the same. Do not capture overrides at definition construction or Layer initialization. The accessor rejects nonempty learned demonstrations for nodes with tuning disabled.

Only the program execution receives candidate overrides. Grading runs outside that scope, with independent parameter and observation contexts.

There is no mutable global parameter registry.

### Observations and telemetry

`Observation.Observation` is `{ nodeId, input, exit, usage? }`, where `exit` is an Effect `Exit` carrying the output or failure and `usage` is optional Effect AI usage. There are no invocation IDs, candidate IDs, timings, or effective parameters on observations.

`Observation.record` reports to `Observation.Observer`, a `Context.Reference` whose default discards records. Evaluation installs a collecting observer for each example’s program execution; the grader runs outside that observer scope. Applications may install their own observer for export or logging. `Predict` records every call, including failures before the model is reached (such as an unregistered definition or prompt encoding).

Library-owned operational spans omit full prompts, examples, and outputs by default. Detailed records remain in evaluation memory unless the caller explicitly persists them. This is not an end-to-end privacy guarantee: upstream HTTP tracing can include endpoint URLs, and failures decoding the original output schema can include generated content. DeepSeek sanitizes provider HTTP errors, but callers must still treat logs and diagnostics as sensitive and configure tracing and logging accordingly.

### Errors and effects

Preserve upstream typed errors and dependencies. `ConfigurationError`, `DatasetError`, `MetricValidationError`, and `ArtifactError` are tagged library errors with a `message` and optional `cause`, exported directly from the package. Codec failures may also remain `Schema.SchemaError`, depending on the operation.

V0 is **fail-fast** on unhandled program or grader errors. Wrong but valid outputs receive low scores; infrastructure failures are not silently converted to zero. Defects and interruption retain their Effect semantics.

Retries belong in the supplied model/service execution policy. The compiler does not automatically retry an entire application program.

Evaluation must use deliberate test, read-only, or sandboxed services. The library cannot make arbitrary production side effects safe to repeat.

## 10. Deliberate limits (for now)

| Concern                  | Decision                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search budget            | Bootstrap bounds training to one pass and enforces `maxCandidates`; custom optimizers own their budgets. Use Effect timeouts for elapsed-time limits. |
| Monetary/model-call caps | No claim of a complete global cap: arbitrary application and grader services may make opaque calls.                                                   |
| Caching                  | No library-managed prediction cache during optimization. Do not silently reuse samples across changed parameters.                                     |
| Reproducibility          | Seed splitting and candidate selection; record memberships and parameters. Do not promise deterministic remote inference.                             |
| Cost accounting          | Record available usage. Missing usage is unknown, not zero; no automatic pricing database.                                                            |
| Extension protocols      | Public `Node` and `Optimizer` protocols support custom implementations without compiler changes.                                                      |
| Advanced infrastructure  | No durable workflows, distributed evaluation, or persistent cache layer.                                                                              |
| Additional AI features   | No agent harness, decision-node API, streaming predictor API, fine-tuning, or control-flow synthesis.                                                 |

Use Effect’s existing execution primitives internally—Schema, Context, Layers, Streams, tracing, and bounded concurrency—without exposing a wrapper for every module. Splitting and candidate generation use a local, isolated deterministic seeded random stream; this does not make remote inference deterministic.

## 11. Public API inventory

These are the v0 entry points. Configuration combinators are immutable and dual where applicable.

| Namespace       | Public surface                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Signature`     | `make(input, output)`, `isSignature`; `.input`, `.output`                                                        |
| `Node`          | `Node`, `Tuning`, `Parameters`, `TypeId`, `isNode`, `CurrentParameters`, `learned`                               |
| `Predict`       | `make(id, signature)`, `isPredict`, `withInstructions`, `withDemonstrations`, `withTuning`; `.run(input)`        |
| `Demonstration` | `Demonstration<I, O>`, `schema(input, output)`                                                                   |
| `Program`       | `make(id, run)`, `isProgram`, `fromPredict`, `withSignature`, `withNodes`, `withRevision`, `link`; `.run(input)` |
| `Metric`        | `make`, `isMetric`, `mapInput`, `map`, `all`, `provide`                                                          |
| `Dataset`       | `fromIterable`, `collect`, `isDataset`, `split`, `provenance`; metadata and examples                             |
| `Evaluation`    | `make`, `isEvaluator`, `withConcurrency`, `run`; `Case`, `Report`, and `Evaluator` types                         |
| `Observation`   | `Observation`, `Observer` reference/interface, `record`                                                          |
| `Optimizer`     | `make(name, settings, search)`, `isOptimizer`, `bootstrapFewShot`; `Context`, `Candidate`, `BootstrapOptions`    |
| `Compiler`      | `compile(program, optimizer, evaluator)` and pipeable `compile(optimizer, evaluator)`                            |
| `Artifact`      | `Artifact` schema/type, `encode`, `decode`                                                                       |

Definition modules expose runtime `TypeId` markers and guards where applicable. Typed error classes are exported directly. `Node` is an implementable protocol rather than a universal builder; its runtime parameter reference is public. There is no separate `Objective` namespace.

### Supplementary provider API

| Namespace  | Public surface                                             |
| ---------- | ---------------------------------------------------------- |
| `DeepSeek` | `layer(options)`, `layerFromEnv(options?)`; `Options` type |

`DeepSeek.layer` supplies Effect AI's `LanguageModel` and requires an `HttpClient`. `Options` accepts a redacted `apiKey` plus optional `model`, `baseUrl`, `maxTokens`, and `temperature`. `layerFromEnv` reads `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, and `DEEPSEEK_BASE_URL` via Effect Config and accepts token/temperature overrides. Defaults are `deepseek-flash`, `https://api.deepseek.com`, and 1,024 maximum output tokens.

The provider is text-only and non-streaming; tools and multimodal prompts are unsupported. Chat Completions JSON mode guides generation, while Effect AI validates the original Effect Schema. No automatic retry or timeout is installed. Custom base URLs must use HTTP(S) and contain no credentials, query, or fragment; path bases are supported, with `/chat/completions` appended. Use only trusted endpoints: they receive the API key and prompts. Prefer HTTPS outside local testing. See [examples/README.md](./examples/README.md) for execution budgets and diagnostic privacy caveats.

## 12. Working goal

The first milestone is reached when an ordinary Effect program can run unoptimized, be evaluated against a fixed dataset, have demonstrations selected from execution traces, and run with a validated artifact after serialization.

Tests should establish parameter isolation between concurrent evaluations, unchanged source definitions, grading outside candidate scope, rejection of incompatible artifacts, correct baseline selection, and preservation of errors and cancellation.

**Build the full loop before adding more abstractions: define → execute → observe → evaluate → optimize → link → execute.**
