import { Context, Effect, Layer } from 'effect';

/**
 * Id — the single source of stable identifiers (UUID v4). Domain programs
 * generate ids here so tests can inject deterministic sequences.
 */
export interface IdService {
  readonly newId: () => string;
}

export class Id extends Context.Tag('aoi/Id')<IdService, IdService>() {}

export const LiveId = Layer.succeed(Id, {
  newId: () => crypto.randomUUID(),
});

export const newId = Effect.map(Id, (s) => s.newId());

/**
 * A deterministic id source for tests. Seeds a counter; ids take the form
 * `00000000-0000-4000-8000-<counter padded to 12 hex>` so they stay
 * valid-looking UUIDs while remaining predictable.
 */
export function makeTestId(seed = 1) {
  let counter = seed;
  return {
    layer: Layer.succeed(Id, {
      newId: () => {
        const hex = counter.toString(16).padStart(12, '0');
        counter += 1;
        return `00000000-0000-4000-8000-${hex}`;
      },
    }),
    next: () => {
      const hex = counter.toString(16).padStart(12, '0');
      counter += 1;
      return `00000000-0000-4000-8000-${hex}`;
    },
  };
}
