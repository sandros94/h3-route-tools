/**
 * `Serialize<T>` — the type a value becomes after a JSON round-trip (`JSON.stringify` on the server,
 * `JSON.parse`/`Response.json()` on the client). Used to type a fetch response from a route's response
 * schema: a handler validates the pre-serialization value (e.g. a `Date`), but the client receives the
 * wire shape (a `string`), so the typed client must report the wire shape.
 *
 * Mirrors `JSON.stringify` semantics: `Date`/any `toJSON()` → its return, `undefined`/function/symbol
 * properties dropped, `Map`/`Set` → `{}`, tuples keep their arity (non-JSON members → `null`). Idempotent
 * (`Serialize<Serialize<T>> = Serialize<T>`), so it's safe to apply to already-wire-shaped types too.
 *
 * @see https://github.com/remix-run/remix — the original serialize type this is adapted from.
 */
export type Serialize<T> =
  IsAny<T> extends true
    ? any
    : IsUnknown<T> extends true
      ? unknown
      : T extends JsonPrimitive | undefined
        ? T
        : T extends Map<unknown, unknown> | Set<unknown>
          ? Record<string, never>
          : T extends NonJsonPrimitive
            ? never
            : T extends { toJSON(): infer U }
              ? U
              : T extends []
                ? []
                : T extends [unknown, ...unknown[]]
                  ? SerializeTuple<T>
                  : T extends ReadonlyArray<infer U>
                    ? (U extends NonJsonPrimitive ? null : Serialize<U>)[]
                    : T extends object
                      ? SerializeObject<T>
                      : never;

type JsonPrimitive = string | number | boolean | null;
type NonJsonPrimitive = undefined | ((...args: never[]) => unknown) | symbol;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false;

/** Keys of `T` whose value is a non-JSON primitive (dropped by `JSON.stringify`). */
type FilterKeys<T extends object, Filter> = {
  [K in keyof T]: T[K] extends Filter ? K : never;
}[keyof T];

type SerializeTuple<T extends [unknown, ...unknown[]]> = {
  [K in keyof T]: T[K] extends NonJsonPrimitive ? null : Serialize<T[K]>;
};

type SerializeObject<T extends object> = {
  [K in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[K]>;
};
