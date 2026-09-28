/**
 * The typed input/output contract for a model call.
 *
 * A `Signature` pairs an input codec with an output codec. Both codecs carry
 * their decoded and encoded types together with the services required to
 * decode and encode them, so the requirements propagate into the Effect
 * requirement channel of a run.
 *
 * @since 0.1.0
 */
import * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Schema from "effect/Schema"

/**
 * Runtime identifier for `Signature` values.
 *
 * @category type IDs
 * @since 0.1.0
 */
export const TypeId = "~effect-dspy/Signature"

/**
 * An input codec and an output codec describing a model call.
 *
 * **Details**
 *
 * `IRD` and `IRE` are the input codec's decoding and encoding services; `ORD`
 * and `ORE` are the output codec's. The slots stay separate so a run requires
 * only the directions it performs.
 *
 * @category models
 * @since 0.1.0
 */
export interface Signature<I, O, II = I, OI = O, IRD = never, IRE = never, ORD = never, ORE = never>
  extends Pipeable.Pipeable
{
  readonly [TypeId]: typeof TypeId
  readonly input: Schema.Codec<I, II, IRD, IRE>
  readonly output: Schema.Codec<O, OI, ORD, ORE>
}

/**
 * A `Signature` with all type parameters erased.
 *
 * @category utility types
 * @since 0.1.0
 */
export type Any = Signature<any, any, any, any, any, any, any, any>

const Proto = { ...Pipeable.Prototype, [TypeId]: TypeId }

/**
 * Returns `true` when a value is a `Signature`.
 *
 * @category guards
 * @since 0.1.0
 */
export const isSignature = (u: unknown): u is Any => Predicate.hasProperty(u, TypeId)

/**
 * Creates a `Signature` from an input and output codec.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <I, O, II, OI, IRD, IRE, ORD, ORE>(
  input: Schema.Codec<I, II, IRD, IRE>,
  output: Schema.Codec<O, OI, ORD, ORE>
): Signature<I, O, II, OI, IRD, IRE, ORD, ORE> =>
  Object.assign(Object.create(Proto), { input, output })
