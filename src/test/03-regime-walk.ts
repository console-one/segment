// ─────────────────────────────────────────────────────────────────────────
// Regime walk — format-tagged transitions drive rule changes. The
// substrate claim: same composite key under different RegimeRegistries
// produces different rule sequences. Walk events fire enter/exit per
// route plus a transition event at format boundaries.
// ─────────────────────────────────────────────────────────────────────────

import {
  buildCompositeKey,
  ResourceFormat,
  JSONFormat,
  RegimeRegistry,
  regime,
  trace,
  walk,
  type Route,
  type WalkEvent,
  type RegimeWalker,
} from '../index.js';

export default async (test: (name: string, body: (validator: any) => any) => any) => {
  await test('same address under two registries yields different policies', async (validator: any) => {
    type Rules = { policy: string };
    const A = new RegimeRegistry()
      .register(regime(ResourceFormat, { policy: 'read-only' }))
      .register(regime(JSONFormat, { policy: 'mutable' }));
    const B = new RegimeRegistry()
      .register(regime(ResourceFormat, { policy: 'admin-only' }))
      .register(regime(JSONFormat, { policy: 'public' }));
    const routes: Route[] = [
      { type: 'Workspace', route: ['acme'] },
      { type: 'File', route: ['doc'], format: JSONFormat },
    ];
    const key = buildCompositeKey(routes, ResourceFormat);
    const a = trace<Rules>(key, A).map((t) => t.regime.rules.policy);
    const b = trace<Rules>(key, B).map((t) => t.regime.rules.policy);
    return validator.expect({ a, b }).toLookLike({
      a: ['read-only', 'mutable'],
      b: ['admin-only', 'public'],
    });
  });

  await test('walk emits enter/exit per route and transition at format boundaries', async (validator: any) => {
    type Rules = { name: string };
    const registry = new RegimeRegistry()
      .register(regime(ResourceFormat, { name: 'R' }))
      .register(regime(JSONFormat, { name: 'J' }));
    const key = buildCompositeKey(
      [
        { type: 'Workspace', route: ['w'] },
        { type: 'File', route: ['f'], format: JSONFormat },
      ],
      ResourceFormat,
    );
    const events: WalkEvent<Rules>[] = [];
    const walker: RegimeWalker<Rules, WalkEvent<Rules>[]> = {
      initial: () => events,
      handle: (e, s) => {
        s.push(e);
        return s;
      },
    };
    walk<Rules, WalkEvent<Rules>[]>(key, registry, walker);
    const kinds = events.map((e) => e.kind);
    const transition = events.find((e) => e.kind === 'transition') as any;
    return validator.expect({
      enters: kinds.filter((k) => k === 'enter').length,
      exits: kinds.filter((k) => k === 'exit').length,
      transitions: kinds.filter((k) => k === 'transition').length,
      from: transition.from.rules.name,
      to: transition.to.rules.name,
    }).toLookLike({ enters: 2, exits: 2, transitions: 1, from: 'R', to: 'J' });
  });
};
