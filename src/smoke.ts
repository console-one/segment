/**
 * End-to-end smoke test for @console-one/segment.
 *
 * Asserts every primitive across the four concerns of the package:
 *   1. Segment grammar — build + match (including the bugs fixed from legacy)
 *   2. JSON round-trip of segment trees
 *   3. Composite-key round-trip (build → string → parse)
 *   4. Regime walk — format-tag transitions drive rule changes
 *   5. Visitor lifecycle — enter/inside/exit/outside over a ResourceMapScope
 *
 * Exits non-zero on any assertion failure.
 */

import {
  $,
  Segment,
  PathSegment,
  WildcardSegment,
  GroupSegment,
  WrappedSegment,
  JSONFormat,
  ResourceFormat,
  segmentFromString,
  buildCompositeKey,
  parseCompositeKey,
  Route,
  regime,
  RegimeRegistry,
  walk,
  trace,
  RegimeWalker,
  WalkEvent,
  ResourceMapScope,
  TracingVisitor,
  LifecycleEvent,
} from './index.js';

function assert(cond: any, msg: string): void {
  if (!cond) {
    console.error(`[smoke] ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

function log(msg: string): void {
  console.log(`[smoke] ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Segment grammar — build + match
// ═══════════════════════════════════════════════════════════════════════

function caseLiteralMatch() {
  const s = $.path('foo').build() as PathSegment;
  assert(s instanceof PathSegment, 'path() builds PathSegment');
  assert(s.match('foo') !== undefined, 'literal matches itself');
  assert(s.match('bar') === undefined, 'literal rejects mismatch');
  log('1. literal build+match OK');
}

function caseWildcardMatch() {
  const w = $.any();
  assert(w instanceof WildcardSegment, 'any() builds WildcardSegment');
  assert(w.match('anything') !== undefined, 'wildcard matches anything');
  assert(w.match('') !== undefined, 'wildcard matches empty');
  log('2. wildcard build+match OK');
}

function caseWrappedBothSides() {
  // FIX: legacy required both sides defined; here both are and it works.
  const wseg = $.from('(').upto(')').path('inner').build() as WrappedSegment;
  assert(wseg instanceof WrappedSegment, 'from().upto().path() builds WrappedSegment');
  const m = wseg.match('(inner)');
  assert(m !== undefined, '(inner) should match');
  assert(m!.path === '(inner)', 'match path preserves both bounds (inclusive)');
  log('3. wrapped both-sides build+match OK');
}

function caseWrappedOneSided() {
  // BUG FIX ANCHOR #1: legacy required BOTH prefix AND suffix. Here we
  // build prefix-only; must still match.
  const prefOnly = $.from('(').path('rest').build() as WrappedSegment;
  assert(prefOnly instanceof WrappedSegment, 'from().path() builds WrappedSegment');
  const m1 = prefOnly.match('(rest');
  assert(m1 !== undefined, '(rest should match prefix-only wrap (legacy would fail here)');

  const sufOnly = $.upto(')').path('rest').build() as WrappedSegment;
  const m2 = sufOnly.match('rest)');
  assert(m2 !== undefined, 'rest) should match suffix-only wrap');
  log('4. wrapped one-sided build+match OK (fix #1 verified)');
}

function caseExclusiveBounds() {
  // BUG FIX ANCHOR #2: legacy `excludes` arithmetic was inverted.
  // `between(a,b)` is exclusive of both — the match span should NOT
  // include the bounding characters.
  const seg = $.between('<', '>').path('x').build() as WrappedSegment;
  const m = seg.match('<x>');
  assert(m !== undefined, '<x> matches between(<,>)');
  assert(m!.path === 'x', `exclusive bounds should yield inner only, got '${m!.path}'`);

  // `across(a,b)` is inclusive of both.
  const seg2 = $.across('(', ')').path('x').build() as WrappedSegment;
  const m2 = seg2.match('(x)');
  assert(m2 !== undefined, '(x) matches across((,))');
  assert(m2!.path === '(x)', `inclusive bounds should yield full span, got '${m2!.path}'`);
  log('5. exclusive/inclusive bounds OK (fix #2 verified)');
}

function caseToString() {
  // BUG FIX ANCHOR #3: legacy toString() emitted 'true'/'false' in place
  // of the prefix. Here it should emit the actual prefix/suffix.
  const seg = $.from('(').upto(')').path('inner').build();
  const str = seg.toString();
  assert(str === '(inner)', `toString should yield '(inner)', got '${str}'`);

  const pre = ($.from('$').path('x').build()).toString();
  assert(pre === '$x', `prefix-only toString should be '$x', got '${pre}'`);
  log('6. toString yields correct string (fix #3 verified)');
}

function caseGroupAlternation() {
  const g = $.either($.path('a'), $.path('b')).build() as GroupSegment;
  assert(g instanceof GroupSegment, 'either() builds GroupSegment');
  assert(g.match('a') !== undefined, 'group matches first alt');
  assert(g.match('b') !== undefined, 'group matches second alt');
  assert(g.match('c') === undefined, 'group rejects non-member');
  log('7. group alternation OK');
}

function caseNamedCapture() {
  const seg = $.from('{').upto('}').any().as('field').build();
  const m = seg.match('{hello}');
  assert(m !== undefined, 'named wrapped matches {hello}');
  assert(Array.isArray(m!.links['field']), 'named capture appears in links');
  assert(m!.links['field'].length === 1, 'named capture has one entry');
  log('8. named capture via .as() OK');
}

// ═══════════════════════════════════════════════════════════════════════
// 2. JSON round-trip
// ═══════════════════════════════════════════════════════════════════════

function caseJSONRoundTrip() {
  const seg = $.from('(').upto(')').either($.path('a'), $.path('b')).as('outer').build();
  const json = seg.toJSON();
  const json2 = JSON.parse(JSON.stringify(json));
  const rebuilt = Segment.fromJSON(json2);

  const m1 = seg.match('(a)');
  const m2 = rebuilt.match('(a)');
  assert(m1 !== undefined && m2 !== undefined, 'both original and rebuilt match');
  assert(m1!.path === m2!.path, 'paths match on both');
  assert(
    JSON.stringify(seg.toJSON()) === JSON.stringify(rebuilt.toJSON()),
    'toJSON is structurally stable through round-trip',
  );
  log('9. JSON round-trip OK');
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Composite key round-trip (the 'fromString' implementation)
// ═══════════════════════════════════════════════════════════════════════

function caseCompositeRoundTrip() {
  // Note: keys must not contain the active format's delimiter; v0.1 does
  // not escape. Here File's keys live under JSONFormat (delimiter '.'),
  // so we use dot-free keys.
  const routes: Route[] = [
    { type: 'Workspace', route: ['acme'] },
    { type: 'File', route: ['docs', 'overview'], format: JSONFormat },
  ];
  const headFormat = ResourceFormat;
  const str = buildCompositeKey(routes, headFormat);
  assert(
    str.includes('[format=resource]') && str.includes('[type=Workspace]') && str.includes('[format=json]'),
    `composite key has expected tags: ${str}`,
  );

  const parsed = parseCompositeKey(str);
  assert(parsed.headFormat.name === 'resource', 'parsed head format is resource');
  assert(parsed.routes.length === 2, 'parsed routes length matches');
  assert(parsed.routes[0].type === 'Workspace', 'route 0 type round-trips');
  assert(parsed.routes[0].route[0] === 'acme', 'route 0 keys round-trip');
  assert(parsed.routes[1].type === 'File', 'route 1 type round-trips');
  assert(parsed.routes[1].format?.name === 'json', 'route 1 format-override round-trips');
  assert(parsed.routes[1].route.length === 2, `route 1 has two keys, got ${parsed.routes[1].route.length}`);
  assert(parsed.routes[1].route[0] === 'docs' && parsed.routes[1].route[1] === 'overview', 'route 1 keys round-trip');

  // Full round-trip: rebuild from parsed, compare strings.
  const rebuilt = buildCompositeKey(parsed.routes, parsed.headFormat);
  assert(rebuilt === str, `rebuilt composite key matches original:\n  ${str}\n  ${rebuilt}`);
  log('10. composite key round-trip OK (fromString implemented)');
}

function caseSegmentFromString() {
  const seg = segmentFromString(JSONFormat, '@.users.alice.name');
  assert(seg instanceof GroupSegment, 'segmentFromString returns GroupSegment');
  assert(seg.group.length === 3, 'three keys after root strip');
  assert((seg.group[0] as PathSegment).path === 'users', 'first key is users');
  assert((seg.group[2] as PathSegment).path === 'name', 'last key is name');

  const globbed = segmentFromString(JSONFormat, '@.users.*.name');
  assert(globbed.group[1] instanceof WildcardSegment, 'star becomes wildcard');
  log('11. segmentFromString OK');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Regime walk — the load-bearing test
// ═══════════════════════════════════════════════════════════════════════

/**
 * The substrate claim: the SAME address, walked under two different
 * regime registrations, produces different outcomes. This proves that
 * format tags are a real dispatch mechanism, not just syntax.
 */
function caseRegimeSameAddressDifferentRules() {
  type Rules = { policy: string };

  // Registry A: resource regime says 'read-only', json regime says 'mutable'.
  const registryA = new RegimeRegistry()
    .register(regime(ResourceFormat, { policy: 'read-only' }))
    .register(regime(JSONFormat,     { policy: 'mutable' }));

  // Registry B: resource regime says 'admin-only', json regime says 'public'.
  const registryB = new RegimeRegistry()
    .register(regime(ResourceFormat, { policy: 'admin-only' }))
    .register(regime(JSONFormat,     { policy: 'public' }));

  const routes: Route[] = [
    { type: 'Workspace', route: ['acme'] },
    { type: 'File', route: ['doc'], format: JSONFormat },
  ];
  const key = buildCompositeKey(routes, ResourceFormat);

  const policiesInA = trace<Rules>(key, registryA).map(t => t.regime.rules.policy);
  const policiesInB = trace<Rules>(key, registryB).map(t => t.regime.rules.policy);

  assert(policiesInA.length === 2, 'two routes → two traces in A');
  assert(policiesInA[0] === 'read-only', 'route 0 in A is read-only');
  assert(policiesInA[1] === 'mutable',   'route 1 in A is mutable (format transition)');
  assert(policiesInB[0] === 'admin-only', 'route 0 in B is admin-only');
  assert(policiesInB[1] === 'public',     'route 1 in B is public');
  log('12. same address, two regimes, different policies — substrate dispatch proven');
}

function caseRegimeTransitionEvent() {
  type Rules = { name: string };
  const registry = new RegimeRegistry()
    .register(regime(ResourceFormat, { name: 'R' }))
    .register(regime(JSONFormat,     { name: 'J' }));

  const key = buildCompositeKey(
    [{ type: 'Workspace', route: ['w'] }, { type: 'File', route: ['f'], format: JSONFormat }],
    ResourceFormat,
  );

  const events: WalkEvent<Rules>[] = [];
  const walker: RegimeWalker<Rules, WalkEvent<Rules>[]> = {
    initial: () => events,
    handle: (e, s) => { s.push(e); return s; },
  };

  walk<Rules, WalkEvent<Rules>[]>(key, registry, walker);

  const kinds = events.map(e => e.kind);
  assert(kinds.filter(k => k === 'enter').length === 2, 'two enter events');
  assert(kinds.filter(k => k === 'exit').length === 2, 'two exit events');
  assert(kinds.filter(k => k === 'transition').length === 1, 'one transition event');

  const transition = events.find(e => e.kind === 'transition') as any;
  assert(transition.from.rules.name === 'R' && transition.to.rules.name === 'J', 'transition R → J');
  log('13. regime transition events fire at format boundaries');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Visitor lifecycle
// ═══════════════════════════════════════════════════════════════════════

function caseVisitorLifecycle() {
  // Two dimensions, two values each.
  const scope = new ResourceMapScope(
    {
      workspace: ['a', 'b'],
      region: ['us', 'eu'],
    },
    ['workspace', 'region'],
  );

  const visitor = new TracingVisitor();
  const commands = scope.start(visitor);
  const events: LifecycleEvent[] = visitor.state;

  // Outer iteration: workspace=a, workspace=b, region=us, region=eu.
  // Per outer: 1 enter, N inside+outside pairs, 1 exit.
  const enterCount = events.filter(e => e.kind === 'enter').length;
  const exitCount = events.filter(e => e.kind === 'exit').length;
  const insideCount = events.filter(e => e.kind === 'inside').length;
  const outsideCount = events.filter(e => e.kind === 'outside').length;

  assert(enterCount === 4, `4 enters (2 workspaces + 2 regions), got ${enterCount}`);
  assert(exitCount === 4, `4 exits, got ${exitCount}`);
  // For each outer entry (dim D), inside fires once per value of D, outside once per value of OTHER dims.
  // workspace-outer (2 values) × inside-workspace (2) = 4, × outside-region (2) = 4. Total 8 per workspace-outer step? no: per ONE outer value, inside fires 2 (own dim) + outside fires 2 (other dim). So per workspace entry: 4 events. 2 entries × 4 = 8. Same for region. Total inside = 2*2 + 2*2 = 8. Total outside = 2*2 + 2*2 = 8.
  assert(insideCount === 8, `inside count should be 8, got ${insideCount}`);
  assert(outsideCount === 8, `outside count should be 8, got ${outsideCount}`);

  // Ordering invariant: no inside/outside fires between an enter and its matching exit that isn't bracketed by them.
  let depth = 0;
  for (const e of events) {
    if (e.kind === 'enter') depth++;
    else if (e.kind === 'exit') depth--;
    else {
      assert(depth === 1, `inside/outside must fire while depth=1, got depth=${depth}`);
    }
  }
  assert(depth === 0, 'enter/exit balanced at the end');

  assert(Array.isArray(commands), 'start() returns commands array');
  log('14. visitor lifecycle OK (enter/inside/exit/outside fire in the right order)');
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

function main() {
  console.log('[smoke] @console-one/segment');
  caseLiteralMatch();
  caseWildcardMatch();
  caseWrappedBothSides();
  caseWrappedOneSided();
  caseExclusiveBounds();
  caseToString();
  caseGroupAlternation();
  caseNamedCapture();
  caseJSONRoundTrip();
  caseCompositeRoundTrip();
  caseSegmentFromString();
  caseRegimeSameAddressDifferentRules();
  caseRegimeTransitionEvent();
  caseVisitorLifecycle();
  console.log('[smoke] ALL OK');
}

main();
