# effect-dspy

An experiment: typed LLM calls you can evaluate and optimize, built on Effect 4. It borrows DSPy's core idea (separate program structure from the demonstrations a model learns) but is not a port of the Python API.

**Status: work in progress.** The API changes without notice, nothing is published to npm, and parts are half-formed. Opinions and issues welcome.

## What I'm poking at

- Nodes and optimizers as open protocols, not closed unions ([`test/extensibility.test.ts`](./test/extensibility.test.ts)).
- Compiled artifacts as plain JSON that links back to source safely.
- How far bootstrap few-shot gets before you'd need instruction optimization (not built).

## Try it

Needs Node `^22.12.0 || >=24.0.0` and a `DEEPSEEK_API_KEY` in your environment.

```sh
npm ci
npm run example:predict    # one model request
npm run example:bootstrap  # compile, serialize, link; 6-8 requests
```

The core of [`examples/predict.ts`](./examples/predict.ts):

```ts
const signature = Signature.make(
  Schema.Struct({ question: Schema.String }),
  Schema.Struct({ answer: Schema.String })
)
const answer = Predict.make("qa/answer", signature).pipe(
  Predict.withInstructions("Answer briefly.")
)
const qa = Program.fromPredict(answer)

const result = yield * qa.run({ question: "What is 2 + 2?" })
// needs a LanguageModel layer, e.g. DeepSeek.layerFromEnv
```

The full define, evaluate, compile, link loop is in [`examples/bootstrap.ts`](./examples/bootstrap.ts); cost, timeouts, and key handling are in [`examples/README.md`](./examples/README.md).

## Known gaps

- Bootstrap few-shot may not beat the baseline. I haven't shown a real improvement yet.
- Evaluation and compilation re-run your application, so use test or sandboxed services.
- Artifacts embed training data; treat them as sensitive.
- No cost cap, cache, streaming, or agent support. The DeepSeek provider is text-only.
- Linking checks declared revision and schemas, not closures. Bump the revision when behavior changes.

Design details and fine print: [`SPEC.md`](./SPEC.md). Contributing and tooling: [`TOOLING.md`](./TOOLING.md).
