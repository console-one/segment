/**
 * Regime — a format + the rules that apply inside it.
 *
 * This is the load-bearing abstraction. A Segment grammar tells you
 * SYNTAX (how to tokenise, what sequences match). A Regime adds RULES
 * (what parser grammar is active, what scopes are visible, what
 * admission laws apply, what storage maps to, …).
 *
 * Every cross-regime transition in a multi-format composite path is a
 * regime switch — and every dimensional distinction in a substrate
 * lattice (cross-sequence, partition, stage/version, identity scope)
 * collapses to "a format, with its own regime's rules."
 *
 * Critically, Regime is open. Consumers supply their own Rules type —
 * this package doesn't pre-commit to what rules means. A parser might
 * attach grammar tables. An admission layer might attach writer-authority
 * lists. A cell-resolver might attach dispatch policy. All of them hang
 * off the same Regime record for the format.
 */

import { PathFormat, Route, parseCompositeKey, FormatRegistryLike } from './format.js';

/**
 * A Regime bundles a format with an arbitrary rules payload. Rules is a
 * parameter so each consumer can define its own shape.
 */
export interface Regime<Rules = Record<string, unknown>> {
  readonly format: PathFormat;
  readonly rules: Rules;
}

/**
 * Create a Regime. Sugar over the interface literal so consumers read
 * `regime(JSONFormat, { parser: ... })` instead of
 * `{ format: JSONFormat, rules: { parser: ... } }`.
 */
export function regime<R>(format: PathFormat, rules: R): Regime<R> {
  return { format, rules };
}

/**
 * Registry of regimes, indexed by format name. This is the piece that
 * makes the substrate substitutable — consumers register their regimes
 * and the walker dispatches by format tag at transition points.
 *
 * Register is additive; later registrations at the same format name
 * replace earlier ones (explicit override). `formats()` exposes a
 * FormatRegistryLike view so the composite-key parser can consume the
 * same registry.
 */
export class RegimeRegistry {
  private readonly regimes = new Map<string, Regime<any>>();

  register<R>(r: Regime<R>): this {
    this.regimes.set(r.format.name, r);
    return this;
  }

  get(formatName: string): Regime | undefined {
    return this.regimes.get(formatName);
  }

  has(formatName: string): boolean {
    return this.regimes.has(formatName);
  }

  names(): string[] {
    return Array.from(this.regimes.keys());
  }

  /** View of this registry as a FormatRegistryLike, for composite-key parsing. */
  formats(): FormatRegistryLike {
    const regimes = this.regimes;
    return {
      get(name: string) {
        return regimes.get(name)?.format;
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Walking a composite path across regimes
// ═══════════════════════════════════════════════════════════════════════

/**
 * Event emitted by the walker. A consumer implements handlers for the
 * events that matter to it; others are ignored.
 *
 *   enter       — entered a route; activeRegime is in scope for its path
 *   transition  — regime is about to change (format override on this route)
 *   exit        — leaving a route
 */
export type WalkEvent<Rules = any> =
  | { kind: 'enter'; route: Route; index: number; regime: Regime<Rules> }
  | { kind: 'transition'; from: Regime<Rules>; to: Regime<Rules>; at: number }
  | { kind: 'exit'; route: Route; index: number; regime: Regime<Rules> };

export interface RegimeWalker<Rules = any, State = unknown> {
  /** Initial walker state; mutated or replaced as events fire. */
  initial(): State;
  /** Handle an event; return (possibly new) state. */
  handle(event: WalkEvent<Rules>, state: State): State;
  /** Called at the end. Return a finalised result or void. */
  finalise?(state: State): unknown;
}

/**
 * Walk a composite key under a registry, firing events per route and per
 * regime transition. This is the canonical traversal — every substrate
 * consumer (admission, routing, visibility, resolution) is structurally
 * a RegimeWalker.
 *
 *   str: the composite key, e.g.
 *     '[format=resource][type=Workspace]acme[type=File][format=json]@.docs'
 *   registry: regimes for each format the string references
 *   walker: the consumer's handler
 *
 * Returns walker.finalise(state) or the final state.
 */
export function walk<Rules, State>(
  str: string,
  registry: RegimeRegistry,
  walker: RegimeWalker<Rules, State>,
): unknown {
  const { routes, headFormat } = parseCompositeKey(str, registry.formats());
  let active = registry.get(headFormat.name) as Regime<Rules> | undefined;
  if (!active) throw new Error(`walk: no regime registered for head format '${headFormat.name}'`);

  let state = walker.initial();

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const nextFormatName = r.format?.name ?? active.format.name;
    if (nextFormatName !== active.format.name) {
      const next = registry.get(nextFormatName) as Regime<Rules> | undefined;
      if (!next) throw new Error(`walk: no regime registered for format '${nextFormatName}' at route index ${i}`);
      state = walker.handle({ kind: 'transition', from: active, to: next, at: i }, state);
      active = next;
    }
    state = walker.handle({ kind: 'enter', route: r, index: i, regime: active }, state);
    state = walker.handle({ kind: 'exit',  route: r, index: i, regime: active }, state);
  }

  return walker.finalise ? walker.finalise(state) : state;
}

// ═══════════════════════════════════════════════════════════════════════
// Convenience: collect routes + regimes along a walk
// ═══════════════════════════════════════════════════════════════════════

/** A trace of what regime was active at each route during a walk. */
export type RegimeTrace<Rules = any> = Array<{
  route: Route;
  regime: Regime<Rules>;
}>;

export function trace<Rules = any>(
  str: string,
  registry: RegimeRegistry,
): RegimeTrace<Rules> {
  const result: RegimeTrace<Rules> = [];
  walk<Rules, RegimeTrace<Rules>>(str, registry, {
    initial: () => result,
    handle: (event, state) => {
      if (event.kind === 'enter') state.push({ route: event.route, regime: event.regime });
      return state;
    },
  });
  return result;
}
