// ─────────────────────────────────────────────────────────────────────────
// ScopeVisitor lifecycle: enter/inside/exit/outside fire in the correct
// order over a ResourceMapScope. The TracingVisitor records every event.
// ─────────────────────────────────────────────────────────────────────────

import {
  ResourceMapScope,
  TracingVisitor,
  type LifecycleEvent,
} from '../index.js';

export default async (test: (name: string, body: (validator: any) => any) => any) => {
  await test('two-dim scope fires 4 enters, 4 exits, and 16 inside/outside events total', async (validator: any) => {
    const scope = new ResourceMapScope(
      { workspace: ['a', 'b'], region: ['us', 'eu'] },
      ['workspace', 'region'],
    );
    const visitor = new TracingVisitor();
    scope.start(visitor);
    const events: LifecycleEvent[] = visitor.state;
    return validator.expect({
      enters: events.filter((e) => e.kind === 'enter').length,
      exits: events.filter((e) => e.kind === 'exit').length,
      insides: events.filter((e) => e.kind === 'inside').length,
      outsides: events.filter((e) => e.kind === 'outside').length,
    }).toLookLike({ enters: 4, exits: 4, insides: 8, outsides: 8 });
  });

  await test('inside/outside events always fire while bracketed by an enter/exit pair', async (validator: any) => {
    const scope = new ResourceMapScope(
      { workspace: ['a', 'b'], region: ['us', 'eu'] },
      ['workspace', 'region'],
    );
    const visitor = new TracingVisitor();
    scope.start(visitor);
    const events: LifecycleEvent[] = visitor.state;
    let depth = 0;
    let allInsideAtDepth1 = true;
    for (const e of events) {
      if (e.kind === 'enter') depth++;
      else if (e.kind === 'exit') depth--;
      else if (depth !== 1) allInsideAtDepth1 = false;
    }
    return validator.expect({
      balanced: depth === 0,
      bracketed: allInsideAtDepth1,
    }).toLookLike({ balanced: true, bracketed: true });
  });

  await test('scope.start returns an array of update commands', async (validator: any) => {
    const scope = new ResourceMapScope(
      { workspace: ['a'] },
      ['workspace'],
    );
    const visitor = new TracingVisitor();
    const commands = scope.start(visitor);
    return validator.expect(Array.isArray(commands)).toLookLike(true);
  });
};
