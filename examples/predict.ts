import { Console, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { DeepSeek, Predict, Program, Signature } from "../src/index.ts"

const signature = Signature.make(
  Schema.Struct({ question: Schema.String }),
  Schema.Struct({ answer: Schema.String })
)

const answer = Predict.make("quick-answer", signature).pipe(
  Predict.withInstructions("Answer briefly. For arithmetic, return only the number in answer.")
)

const program = Program.fromPredict(answer)

const main = Effect.gen(function*() {
  const result = yield* program.run({ question: "What is 2 + 2?" })
  // result is schema-validated and typed as { readonly answer: string }.
  yield* Console.log({ answer: result.answer })
})

// The provider reads DEEPSEEK_API_KEY; application code never reads or prints it.
// No retries or fallback: a failed request rejects and Node exits unsuccessfully.
await Effect.runPromise(main.pipe(
  Effect.provide(
    DeepSeek.layerFromEnv({ maxTokens: 128, temperature: 0 }).pipe(
      Layer.provide(FetchHttpClient.layer)
    )
  ),
  Effect.timeout("45 seconds")
))
