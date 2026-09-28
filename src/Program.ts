/**
 * Composable programs built from nodes.
 *
 * A `Program` is an immutable, runnable definition with an inventory of the
 * `Node`s it may execute. Linking a `Program` against an `Artifact` installs
 * learned parameters into the runtime scope of every run.
 *
 * @since 0.1.0
 */
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as AiError from "effect/unstable/ai/AiError"
import type * as LanguageModel from "effect/unstable/ai/LanguageModel"
import type * as Artifact from "./Artifact.ts"
import * as Demonstration from "./Demonstration.ts"
import { ArtifactError, ConfigurationError } from "./Errors.ts"
import * as Manifest from "./internal/manifest.ts"
import { canonical } from "./internal/util.ts"
import * as Node from "./Node.ts"
import type * as Predict from "./Predict.ts"
import type { Signature } from "./Signature.ts"

/**
 * Runtime identifier for `Program` values.
 *
 * @category type IDs
 * @since 0.1.0
 */
export const TypeId = "~effect-dspy/Program"

/**
 * A runnable definition with an inventory of registered nodes.
 *
 * **Details**
 *
 * The inventory holds exact node definitions, not IDs: a different definition
 * reusing a registered ID is never interchangeable with the registered one.
 *
 * @category models
 * @since 0.1.0
 */
export interface Program<I, O, E = never, R = never> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly id: string
  readonly revision: string
  readonly signature: Signature<I, O, unknown, unknown, R, R, R, R> | undefined
  readonly nodes: ReadonlyArray<Node.Node<any, any, R>>
  readonly linked: boolean
  readonly run: (input: I) => Effect.Effect<O, E, R>
}

/**
 * A `Program` with all type parameters erased.
 *
 * @category utility types
 * @since 0.1.0
 */
export type Any = Program<any, any, any, any>

type Registration = Node.Any | Any

type RegistrationContext<N> = N extends Node.Node<any, any, infer R> ? R
  : N extends Program<any, any, any, infer R> ? R
  : never

const Proto = { ...Pipeable.Prototype, [TypeId]: TypeId }

/**
 * Returns `true` when a value is a `Program`.
 *
 * @category guards
 * @since 0.1.0
 */
export const isProgram = (u: unknown): u is Any => Predicate.hasProperty(u, TypeId)

const build = <I, O, E, R>(
  fields: Omit<Program<I, O, E, R>, "pipe" | typeof TypeId>
): Program<I, O, E, R> => Object.assign(Object.create(Proto), fields)

const fieldsOf = <I, O, E, R>(
  self: Program<I, O, E, R>
): Omit<Program<I, O, E, R>, "pipe" | typeof TypeId> => ({
  id: self.id,
  revision: self.revision,
  signature: self.signature,
  nodes: self.nodes,
  linked: self.linked,
  run: self.run
})

/**
 * Creates a `Program` from an identifier and a run function.
 *
 * **When to use**
 *
 * Use to wrap ordinary Effect code as a program, then add a signature, nodes,
 * and a revision.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <I, O, E, R>(
  id: string,
  run: (input: I) => Effect.Effect<O, E, R>
): Program<I, O, E, R> =>
  build({ id, revision: "", signature: undefined, nodes: [], linked: false, run })

/**
 * Creates a single-node `Program` from a `Predict`.
 *
 * @category constructors
 * @since 0.1.0
 */
export const fromPredict = <I, O, II, OI, IRD, IRE, ORD, ORE>(
  node: Predict.Predict<I, O, II, OI, IRD, IRE, ORD, ORE>
): Program<
  I,
  O,
  AiError.AiError | Schema.SchemaError | ConfigurationError,
  LanguageModel.LanguageModel | IRD | IRE | ORD | ORE
> =>
  build<
    I,
    O,
    AiError.AiError | Schema.SchemaError | ConfigurationError,
    LanguageModel.LanguageModel | IRD | IRE | ORD | ORE
  >({
    id: node.id,
    revision: "",
    signature: node.signature,
    nodes: [node],
    linked: false,
    run: node.run
  })

/**
 * Returns a copy of a `Program` with an application-managed revision.
 *
 * **When to use**
 *
 * Bump the revision whenever behavior-affecting source changes, so stale
 * artifacts refuse to link.
 *
 * @category combinators
 * @since 0.1.0
 */
export const withRevision: {
  (revision: string): <I, O, E, R>(self: Program<I, O, E, R>) => Program<I, O, E, R>
  <I, O, E, R>(self: Program<I, O, E, R>, revision: string): Program<I, O, E, R>
} = dual(
  2,
  <I, O, E, R>(self: Program<I, O, E, R>, revision: string) =>
    build({ ...fieldsOf(self), revision })
)

/**
 * Returns a copy of a `Program` with an input/output signature.
 *
 * @category combinators
 * @since 0.1.0
 */
export const withSignature: {
  <I, O, II, OI, IRD, IRE, ORD, ORE>(
    signature: Signature<I, O, II, OI, IRD, IRE, ORD, ORE>
  ): <E, R>(self: Program<I, O, E, R>) => Program<I, O, E, R | IRD | IRE | ORD | ORE>
  <I, O, E, R, II, OI, IRD, IRE, ORD, ORE>(
    self: Program<I, O, E, R>,
    signature: Signature<NoInfer<I>, NoInfer<O>, II, OI, IRD, IRE, ORD, ORE>
  ): Program<I, O, E, R | IRD | IRE | ORD | ORE>
} = dual(
  2,
  <I, O, E, R, II, OI, IRD, IRE, ORD, ORE>(
    self: Program<I, O, E, R>,
    signature: Signature<I, O, II, OI, IRD, IRE, ORD, ORE>
  ): Program<I, O, E, R | IRD | IRE | ORD | ORE> =>
    build<I, O, E, R | IRD | IRE | ORD | ORE>({ ...fieldsOf(self), signature })
)

/**
 * Returns a copy of a `Program` with additional registered nodes.
 *
 * **Details**
 *
 * Registering a program registers its nodes. A node registered twice is kept
 * once.
 *
 * @category combinators
 * @since 0.1.0
 */
export const withNodes: {
  <const N extends ReadonlyArray<Registration>>(
    ...nodes: N
  ): <I, O, E, R>(self: Program<I, O, E, R>) => Program<I, O, E, R | RegistrationContext<N[number]>>
  <I, O, E, R, const N extends ReadonlyArray<Registration>>(
    self: Program<I, O, E, R>,
    nodes: N
  ): Program<I, O, E, R | RegistrationContext<N[number]>>
} = dual(
  (args) => isProgram(args[0]) && Array.isArray(args[1]),
  <I, O, E, R>(
    self: Program<I, O, E, R>,
    ...registrations: ReadonlyArray<Registration | ReadonlyArray<Registration>>
  ): Program<I, O, E, R> =>
    build({
      ...fieldsOf(self),
      nodes: Array.dedupeWith(
        [
          ...self.nodes,
          ...registrations.flat().flatMap((entry) => isProgram(entry) ? entry.nodes : [entry])
        ],
        (a, b) => a === b
      )
    })
)

/**
 * Checks an artifact against a program and installs its learned parameters.
 *
 * **Details**
 *
 * The artifact must match the program's ID, revision, signature fingerprints,
 * and every node's fixed configuration. Runs of the linked program see only the
 * artifact's parameters and reject nodes outside the inventory.
 *
 * @category combinators
 * @since 0.1.0
 */
export const link: {
  (
    artifact: Artifact.Artifact
  ): <I, O, E, R>(
    self: Program<I, O, E, R>
  ) => Effect.Effect<
    Program<I, O, E | ConfigurationError, R>,
    ArtifactError | ConfigurationError,
    R
  >
  <I, O, E, R>(
    self: Program<I, O, E, R>,
    artifact: Artifact.Artifact
  ): Effect.Effect<Program<I, O, E | ConfigurationError, R>, ArtifactError | ConfigurationError, R>
} = dual(
  2,
  <I, O, E, R>(self: Program<I, O, E, R>, artifact: Artifact.Artifact) =>
    Effect.gen(function*() {
      if (self.linked) {
        return yield* new ConfigurationError({ message: "Cannot link an already linked program" })
      }

      const manifest = yield* Manifest.make(self)
      const inventory = yield* Manifest.inventory(self)

      if (
        artifact.programId !== self.id || artifact.revision !== self.revision
        || canonical(artifact.manifest) !== canonical(manifest)
      ) {
        return yield* new ArtifactError({
          message:
            "Artifact does not match the program ID, revision, signatures, or fixed configuration"
        })
      }

      const parameters: Record<
        string,
        ReadonlyArray<Demonstration.Demonstration<unknown, unknown>>
      > = {}

      for (const [id, encoded] of Object.entries(artifact.parameters)) {
        const node = inventory.get(id)

        if (node === undefined || (!node.tuning.demonstrations && encoded.length > 0)) {
          return yield* new ArtifactError({
            message: `Artifact parameters target an unknown or non-tunable node: ${id}`
          })
        }

        parameters[id] = yield* Schema.decodeEffect(
          Schema.Array(Demonstration.schema(node.signature.input, node.signature.output))
        )(encoded).pipe(
          Effect.mapError((cause) =>
            new ArtifactError({ message: `Invalid demonstrations for ${id}`, cause })
          )
        )
      }

      return build<I, O, E | ConfigurationError, R>({
        ...fieldsOf(self),
        linked: true,
        run: (input) =>
          Effect.provideService(self.run(input), Node.CurrentParameters, { parameters, inventory })
      })
    })
)
