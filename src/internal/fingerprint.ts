import * as Array from "effect/Array"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import type { Signature } from "../Signature.ts"
import { hash } from "./util.ts"

const isUnchangedAnnotation = Predicate.or(
  Predicate.isNull,
  Predicate.or(Predicate.isString, Predicate.isBoolean)
)

const propertyKey = (name: PropertyKey): string =>
  Predicate.isSymbol(name) ? `@${Symbol.keyFor(name) ?? name.description ?? ""}` : String(name)

// Annotations are the AST's open metadata boundary; walk them without invoking accessors,
// hashing closures, or losing cycles. The result is validated as lossless JSON.
const annotations = (root: Schema.Annotations.Annotations | undefined): Schema.Json => {
  const active = new Map<object, string>()

  const coerce = <A>(value: A, path: string): Schema.Json => {
    if (Predicate.isFunction(value)) return "[Function]"

    if (Predicate.isSymbol(value)) {
      return `[Symbol:${Symbol.keyFor(value) ?? value.description ?? ""}]`
    }

    if (Predicate.isBigInt(value)) return `[BigInt:${value}]`

    if (Predicate.isUndefined(value)) return "[Undefined]"

    if (Predicate.isNumber(value)) return Number.isFinite(value) ? value : `[Number:${value}]`

    if (isUnchangedAnnotation(value)) return value

    if (Predicate.isDate(value)) return { date: value.toISOString() }

    if (Predicate.isRegExp(value)) return { regexp: value.source, flags: value.flags }

    if (!Predicate.isObject(value)) throw new Error("Unsupported structural value")

    const reference = active.get(value)

    if (reference !== undefined) return { $ref: reference }
    active.set(value, path)

    let result: Schema.Json

    if (Array.isArray(value)) {
      result = value.map((entry, index) => coerce(entry, `${path}/${index}`))
    } else {
      // Record/Struct entries omit symbols; fromEntries also preserves own __proto__ data.
      const keys = Reflect.ownKeys(value).map((key) => ({ key, label: propertyKey(key) }))
        .sort((a, b) => a.label.localeCompare(b.label))

      if (new Set(keys.map(({ label }) => label)).size !== keys.length) {
        throw new Error("Ambiguous schema annotation property-key labels")
      }

      result = Object.fromEntries(keys.map(({ key, label }) => [
        label,
        coerce(Predicate.hasProperty(value, key) ? value[key] : undefined, `${path}/${label}`)
      ]))
    }

    active.delete(value)

    return result
  }

  return Schema.decodeSync(Schema.Json)(coerce(root, "$"))
}

// The typed AST retains both codec directions plus a non-empty encoding chain. The walker
// hashes structure (tags, annotations, check metadata, link targets, context) and never
// implementation closures: the application revision is authoritative for refinements,
// transforms, and suspend thunks beyond the AST they resolve to.
/** @internal */
export const schemaFingerprint = (schema: Schema.Constraint): string => {
  const active = new Map<SchemaAST.AST, string>()

  const child = (
    ast: SchemaAST.AST,
    path: ReadonlyArray<PropertyKey>,
    label: string
  ): Schema.Json => visit(ast, [...path, label])

  const link = (value: SchemaAST.Link, path: ReadonlyArray<PropertyKey>): Schema.Json => ({
    to: visit(value.to, [...path, "to"]),
    transformation: { _tag: value.transformation._tag }
  })

  const encoding = (value: SchemaAST.Encoding, path: ReadonlyArray<PropertyKey>): Schema.Json =>
    value.map((entry, index) => link(entry, [...path, index]))

  const check = (value: SchemaAST.Check<unknown>): Schema.Json =>
    Match.value(value).pipe(
      Match.tag("Filter", (filter) => ({
        _tag: filter._tag,
        aborted: filter.aborted,
        annotations: annotations(filter.annotations)
      })),
      Match.tag("FilterGroup", (group) => ({
        _tag: group._tag,
        annotations: annotations(group.annotations),
        checks: group.checks.map(check)
      })),
      Match.exhaustive
    )

  const context = (value: SchemaAST.Context, path: ReadonlyArray<PropertyKey>): Schema.Json =>
    Object.assign(
      {
        isOptional: value.isOptional,
        isMutable: value.isMutable
      },
      value.constructorDefault === undefined
        ? {}
        : { constructorDefault: link(value.constructorDefault, [...path, "constructorDefault"]) },
      value.annotations === undefined ? {} : { annotations: annotations(value.annotations) }
    )

  const fields = (ast: SchemaAST.AST, path: ReadonlyArray<PropertyKey>): Schema.Json =>
    Match.value(ast).pipe(
      Match.tag("Declaration", (ast) => ({
        typeParameters: ast.typeParameters.map((node, index) =>
          child(node, path, `typeParameters/${index}`)
        )
      })),
      Match.tag("Enum", (ast) => ({ enums: ast.enums })),
      Match.tag("TemplateLiteral", (ast) => ({
        parts: ast.parts.map((node, index) => child(node, path, `parts/${index}`))
      })),
      Match.tag("Literal", (ast) => ({
        literal: Predicate.isBigInt(ast.literal) ? `[BigInt:${ast.literal}]` : ast.literal
      })),
      Match.tag("UniqueSymbol", (ast) => ({ symbol: propertyKey(ast.symbol) })),
      Match.tag("Arrays", (ast) => ({
        isMutable: ast.isMutable,
        elements: ast.elements.map((node, index) => child(node, path, `elements/${index}`)),
        rest: ast.rest.map((node, index) => child(node, path, `rest/${index}`))
      })),
      Match.tag("Objects", (ast) => ({
        propertySignatures: ast.propertySignatures.map((property, index) => ({
          name: propertyKey(property.name),
          type: child(property.type, path, `propertySignatures/${index}/type`)
        })),
        indexSignatures: ast.indexSignatures.map((index, position) => ({
          parameter: child(index.parameter, path, `indexSignatures/${position}/parameter`),
          type: child(index.type, path, `indexSignatures/${position}/type`)
        }))
      })),
      Match.tag("Union", (ast) => ({
        types: ast.types.map((node, index) => child(node, path, `types/${index}`))
      })),
      Match.tag("Suspend", (ast) => ({ thunk: child(ast.thunk(), path, "thunk") })),
      Match.tag(
        "Null",
        "Undefined",
        "Void",
        "Never",
        "Unknown",
        "Any",
        "String",
        "Number",
        "Boolean",
        "BigInt",
        "Symbol",
        "ObjectKeyword",
        () => ({})
      ),
      Match.exhaustive
    )

  const visit = (ast: SchemaAST.AST, path: ReadonlyArray<PropertyKey>): Schema.Json => {
    const reference = active.get(ast)

    if (reference !== undefined) return { $ref: reference }
    active.set(ast, path.join("/"))

    const result = Object.assign(
      {
        _tag: ast._tag,
        annotations: annotations(ast.annotations)
      },
      ast.checks === undefined
        ? {}
        : { checks: ast.checks.map(check) },
      ast.encoding === undefined ? {} : { encoding: encoding(ast.encoding, [...path, "encoding"]) },
      ast.context === undefined ? {} : { context: context(ast.context, [...path, "context"]) },
      fields(ast, path)
    )

    active.delete(ast)

    return result
  }

  return hash(visit(schema.ast, ["$"]))
}

/** @internal */
export const signatureFingerprint = (
  signature: Signature<any, any, any, any, any, any, any, any>
): string =>
  hash({
    input: schemaFingerprint(signature.input),
    output: schemaFingerprint(signature.output)
  })
