/**
 * A single input/output example used to steer a model call.
 *
 * A `Demonstration` carries one worked example that a `Predict` can include in
 * its prompt. The interface is hand-written rather than derived from a schema
 * because it is generic over the input and output codecs of a `Signature`; the
 * {@link schema} constructor derives the corresponding codec when a value needs
 * to be validated, encoded, or decoded.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * One worked input/output example for a model call.
 *
 * **When to use**
 *
 * Use to provide few-shot examples to a `Predict`.
 *
 * @category models
 * @since 0.1.0
 */
export interface Demonstration<I, O> {
  readonly input: I
  readonly output: O
}

/**
 * Derives the codec for a `Demonstration` from an input and output codec.
 *
 * **When to use**
 *
 * Use to validate, encode, or decode demonstrations alongside a `Signature`.
 *
 * **Details**
 *
 * The decoded type is `{ readonly input: I; readonly output: O }` and the
 * encoded type is `{ readonly input: II; readonly output: OI }`. Decoding
 * requires `IRD | ORD`; encoding requires `IRE | ORE`.
 *
 * @category schemas
 * @since 0.1.0
 */
export const schema = <I, O, II, OI, IRD, IRE, ORD, ORE>(
  input: Schema.Codec<I, II, IRD, IRE>,
  output: Schema.Codec<O, OI, ORD, ORE>
): Schema.Codec<
  { readonly input: I; readonly output: O },
  { readonly input: II; readonly output: OI },
  IRD | ORD,
  IRE | ORE
> => Schema.Struct({ input, output })
