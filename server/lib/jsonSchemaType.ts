type Primitive<T> = T extends 'string' ? string : T extends 'integer' | 'number' ? number : T extends 'boolean' ? boolean : T extends 'null' ? null : never

type Required<S> = S extends { required: readonly (infer K)[] } ? K : never

type ObjectOf<S> = S extends { properties: infer P }
  ? { -readonly [K in keyof P as K extends Required<S> ? K : never]: FromSchema<P[K]> } & {
      -readonly [K in keyof P as K extends Required<S> ? never : K]?: FromSchema<P[K]>
    }
  : Record<string, unknown>

type OfType<S, T> = T extends 'object' ? ObjectOf<S> : T extends 'array' ? (S extends { items: infer I } ? FromSchema<I>[] : unknown[]) : Primitive<T>

/** Type TypeScript décrit par un schéma JSON (`as const`), pour le sous-ensemble utilisé par server/schemas.ts. */
export type FromSchema<S> = S extends { enum: readonly (infer E)[] }
  ? E
  : S extends { type: readonly (infer T)[] }
    ? OfType<S, T>
    : S extends { type: infer T }
      ? OfType<S, T>
      : unknown
