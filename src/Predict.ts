/**
 * Typed model-call definitions.
 *
 * A `Predict` binds an identifier, instructions, and fixed demonstrations to a
 * `Signature`, then runs an input through a `LanguageModel`. It implements the
 * `Node` protocol: learned demonstrations are read from the runtime scope at
 * call time and each call is reported to the current `Observer`.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { dual } from "effect/Function"
import * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as AiError from "effect/unstable/ai/AiError"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"
import * as Demonstration from "./Demonstration.ts"
import type { ConfigurationError } from "./Errors.ts"
import * as Node from "./Node.ts"
import * as Observation from "./Observation.ts"
import type { Signature } from "./Signature.ts"

/**
 * Runtime identifier for `Predict` values.
 *
 * @category type IDs
 * @since 0.1.0
 */
export const TypeId = "~effect-dspy/Predict"

/**
 * A typed model-call definition.
 *
 * **Details**
 *
 * `run` requires `IRE | ORD | ORE`: the input and demonstrations are encoded,
 * the generated object is decoded, and the input is never decoded.
 *
 * @category models
 * @since 0.1.0
 */
export interface Predict<I, O, II = I, OI = O, IRD = never, IRE = never, ORD = never, ORE = never>
  extends Node.Node<I, O, IRD | IRE | ORD | ORE>, Pipeable.Pipeable
{
  readonly [TypeId]: typeof TypeId
  readonly signature: Signature<I, O, II, OI, IRD, IRE, ORD, ORE>
  readonly instructions: string
  readonly demonstrations: ReadonlyArray<Demonstration.Demonstration<I, O>>
  readonly run: (input: I) => Effect.Effect<
    O,
    AiError.AiError | Schema.SchemaError | ConfigurationError,
    LanguageModel.LanguageModel | IRE | ORD | ORE
  >
}

/**
 * A `Predict` with all type parameters erased.
 *
 * @category utility types
 * @since 0.1.0
 */
export type Any = Predict<any, any, any, any, any, any, any, any>

type Settings<I, O, II, OI, IRD, IRE, ORD, ORE> = Pick<
  Predict<I, O, II, OI, IRD, IRE, ORD, ORE>,
  "id" | "signature" | "instructions" | "demonstrations" | "tuning"
>

const Proto = { ...Pipeable.Prototype, [TypeId]: TypeId, [Node.TypeId]: Node.TypeId }

/**
 * Returns `true` when a value is a `Predict`.
 *
 * @category guards
 * @since 0.1.0
 */
export const isPredict = (u: unknown): u is Any => Predicate.hasProperty(u, TypeId)

const decodeJson = Schema.decodeUnknownEffect(Schema.Json)

const build = <I, O, II, OI, IRD, IRE, ORD, ORE>(
  settings: Settings<I, O, II, OI, IRD, IRE, ORD, ORE>
): Predict<I, O, II, OI, IRD, IRE, ORD, ORE> => {
  const { input, output } = settings.signature
  const demonstrations = Schema.Array(Demonstration.schema(input, output))

  const encodePrompt = Schema.encodeEffect(Schema.fromJsonString(Schema.Struct({
    instructions: Schema.String,
    demonstrations,
    input
  })))

  // SAFETY: structured generation requires an object encoding; generateObject decodes with the
  // original codec, preserving O and its services. The cast only widens the encoded side.
  const outputSchema = output as Schema.Codec<
    O,
    OI & { readonly [key: string]: Schema.Json },
    ORD,
    ORE
  >

  const self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE> = Object.assign(Object.create(Proto), {
    ...settings,
    fixed: Schema.encodeEffect(demonstrations)(settings.demonstrations).pipe(
      Effect.flatMap(decodeJson),
      Effect.map((encoded): Schema.Json => ({
        instructions: settings.instructions,
        demonstrations: encoded,
        tuning: { ...settings.tuning }
      }))
    ),
    run: Effect.fnUntraced(
      function*(value: I) {
        const learned = yield* Node.learned(self)

        const prompt = yield* encodePrompt({
          instructions: settings.instructions,
          demonstrations: [...settings.demonstrations, ...learned],
          input: value
        })

        return yield* LanguageModel.generateObject({ prompt, schema: outputSchema })
      },
      // Every call is observed, including failures before the model is reached.
      (effect, value) =>
        Effect.onExit(effect, (exit) =>
          Observation.record({
            nodeId: settings.id,
            input: value,
            exit: Exit.map(exit, (response) => response.value),
            usage: Exit.isSuccess(exit) ? exit.value.usage : undefined
          })),
      Effect.map((response) => response.value),
      Effect.withSpan("effect-dspy.predict", { attributes: { "effect-dspy.node.id": settings.id } })
    )
  })

  return self
}

/**
 * Creates a `Predict` from an identifier and a `Signature`.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <I, O, II, OI extends Record<string, unknown>, IRD, IRE, ORD, ORE>(
  id: string,
  signature: Signature<I, O, II, OI, IRD, IRE, ORD, ORE>
): Predict<I, O, II, OI, IRD, IRE, ORD, ORE> =>
  build({ id, signature, instructions: "", demonstrations: [], tuning: { demonstrations: false } })

const settingsOf = <I, O, II, OI, IRD, IRE, ORD, ORE>(
  self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
): Settings<I, O, II, OI, IRD, IRE, ORD, ORE> => ({
  id: self.id,
  signature: self.signature,
  instructions: self.instructions,
  demonstrations: self.demonstrations,
  tuning: self.tuning
})

/**
 * Returns a copy of a `Predict` with new instructions.
 *
 * @category combinators
 * @since 0.1.0
 */
export const withInstructions: {
  (
    instructions: string
  ): <I, O, II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
  ) => Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
  <I, O, II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>,
    instructions: string
  ): Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
} = dual(
  2,
  <I, O, II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>,
    instructions: string
  ) => build({ ...settingsOf(self), instructions })
)

/**
 * Returns a copy of a `Predict` with new fixed demonstrations.
 *
 * **When to use**
 *
 * Use to prepend worked examples that are always sent to the model.
 *
 * @category combinators
 * @since 0.1.0
 */
export const withDemonstrations: {
  <I, O>(
    demonstrations: ReadonlyArray<Demonstration.Demonstration<I, O>>
  ): <II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
  ) => Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
  <I, O, II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>,
    demonstrations: ReadonlyArray<Demonstration.Demonstration<NoInfer<I>, NoInfer<O>>>
  ): Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
} = dual(
  2,
  <I, O, II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>,
    demonstrations: ReadonlyArray<Demonstration.Demonstration<I, O>>
  ) => build({ ...settingsOf(self), demonstrations: [...demonstrations] })
)

/**
 * Returns a copy of a `Predict` with new tuning switches.
 *
 * **Details**
 *
 * Learned demonstrations are rejected unless `demonstrations` is enabled.
 *
 * @category combinators
 * @since 0.1.0
 */
export const withTuning: {
  (
    tuning: Node.Tuning
  ): <I, O, II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
  ) => Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
  <I, O, II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>,
    tuning: Node.Tuning
  ): Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
} = dual(
  2,
  <I, O, II, OI, IRD, IRE, ORD, ORE>(
    self: Predict<I, O, II, OI, IRD, IRE, ORD, ORE>,
    tuning: Node.Tuning
  ) => build({ ...settingsOf(self), tuning: { ...tuning } })
)
