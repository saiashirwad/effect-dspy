/**
 * The protocol for optimizable model-call nodes.
 *
 * A `Node` is anything a `Program` registers and an optimizer tunes: it has a
 * stable identifier, a `Signature`, a fingerprint of its fixed configuration,
 * and switches saying which parameters it accepts. `Predict` is one
 * implementation; other node types implement the same interface and read
 * their learned parameters with {@link learned}.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Schema from "effect/Schema"
import type { Demonstration } from "./Demonstration.ts"
import { ConfigurationError } from "./Errors.ts"
import type { Signature } from "./Signature.ts"

/**
 * Runtime identifier shared by every `Node` implementation.
 *
 * @category type IDs
 * @since 0.1.0
 */
export const TypeId = "~effect-dspy/Node"

/**
 * Which learned parameters a node accepts.
 *
 * @category models
 * @since 0.1.0
 */
export interface Tuning {
  readonly demonstrations: boolean
}

/**
 * An optimizable unit registered on a `Program`.
 *
 * **Details**
 *
 * `R` is the union of the signature's codec services. `fixed` describes every
 * behavior-affecting setting that is not learned (for example instructions and
 * hand-written demonstrations); it is fingerprinted into artifact manifests so
 * a changed node cannot silently link against stale parameters.
 *
 * @category models
 * @since 0.1.0
 */
export interface Node<I, O, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly id: string
  readonly signature: Signature<I, O, unknown, unknown, R, R, R, R>
  readonly tuning: Tuning
  readonly fixed: Effect.Effect<Schema.Json, Schema.SchemaError, R>
}

/**
 * A `Node` with all type parameters erased.
 *
 * @category utility types
 * @since 0.1.0
 */
export type Any = Node<any, any, any>

/**
 * Returns `true` when a value implements the `Node` protocol.
 *
 * @category guards
 * @since 0.1.0
 */
export const isNode = (u: unknown): u is Any => Predicate.hasProperty(u, TypeId)

/**
 * Learned demonstrations keyed by node ID.
 *
 * @category models
 * @since 0.1.0
 */
export type Parameters = Readonly<Record<string, ReadonlyArray<Demonstration<unknown, unknown>>>>

/**
 * The learned parameters in scope for the running program.
 *
 * **Details**
 *
 * When `inventory` is present, only the exact registered node definitions may
 * run: an unknown ID, or a different definition reusing a registered ID, fails
 * with a `ConfigurationError`.
 *
 * @category references
 * @since 0.1.0
 */
export const CurrentParameters: Context.Reference<{
  readonly parameters: Parameters
  readonly inventory?: ReadonlyMap<string, Any> | undefined
}> = Context.Reference("effect-dspy/Node/CurrentParameters", {
  defaultValue: () => ({ parameters: {} })
})

/**
 * Reads the demonstrations learned for a node in the current scope.
 *
 * **When to use**
 *
 * Call from a node implementation's run to apply learned parameters.
 *
 * @category accessors
 * @since 0.1.0
 */
export const learned = <I, O, R>(
  node: Node<I, O, R>
): Effect.Effect<ReadonlyArray<Demonstration<I, O>>, ConfigurationError> =>
  Effect.gen(function*() {
    const { parameters, inventory } = yield* CurrentParameters

    if (inventory !== undefined && inventory.get(node.id) !== node) {
      return yield* new ConfigurationError({ message: `Unregistered node definition: ${node.id}` })
    }

    const demonstrations = Object.hasOwn(parameters, node.id) ? parameters[node.id] : []

    if (demonstrations.length > 0 && !node.tuning.demonstrations) {
      return yield* new ConfigurationError({
        message: `Demonstration tuning is disabled: ${node.id}`
      })
    }

    // SAFETY: parameters are decoded with this exact registered node's signature.
    return demonstrations as ReadonlyArray<Demonstration<I, O>>
  })
