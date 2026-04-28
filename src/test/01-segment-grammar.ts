// ─────────────────────────────────────────────────────────────────────────
// Segment grammar primitives: $.path / $.any / $.from / $.upto / $.between
// / $.across / $.either / $.as. Build-then-match for each shape.
// Verifies bug fixes carried into this package: prefix-only wrap, exclusive
// bounds arithmetic, and toString rendering the actual delimiters.
// ─────────────────────────────────────────────────────────────────────────

import {
  $,
  Segment,
  PathSegment,
  WildcardSegment,
  GroupSegment,
  WrappedSegment,
} from '../index.js';

export default async (test: (name: string, body: (validator: any) => any) => any) => {
  await test('$.path("foo") builds a PathSegment that matches itself', async (validator: any) => {
    const s = $.path('foo').build();
    return validator.expect({
      isPathSeg: s instanceof PathSegment,
      matchesSelf: s.match('foo') !== undefined,
      rejectsOther: s.match('bar') === undefined,
    }).toLookLike({ isPathSeg: true, matchesSelf: true, rejectsOther: true });
  });

  await test('$.any() builds a WildcardSegment matching anything (and empty)', async (validator: any) => {
    const w = $.any();
    return validator.expect({
      isWildcard: w instanceof WildcardSegment,
      matchesAny: w.match('anything') !== undefined,
      matchesEmpty: w.match('') !== undefined,
    }).toLookLike({ isWildcard: true, matchesAny: true, matchesEmpty: true });
  });

  await test('$.from(x).upto(y).path(z) wraps both sides inclusively', async (validator: any) => {
    const wseg = $.from('(').upto(')').path('inner').build() as WrappedSegment;
    const m = wseg.match('(inner)');
    return validator.expect({
      isWrapped: wseg instanceof WrappedSegment,
      matched: m !== undefined,
      pathField: m?.path,
    }).toLookLike({ isWrapped: true, matched: true, pathField: '(inner)' });
  });

  await test('prefix-only wrap matches without a suffix (legacy bug fix)', async (validator: any) => {
    const prefOnly = $.from('(').path('rest').build() as WrappedSegment;
    const sufOnly = $.upto(')').path('rest').build() as WrappedSegment;
    return validator.expect({
      pre: prefOnly.match('(rest') !== undefined,
      suf: sufOnly.match('rest)') !== undefined,
    }).toLookLike({ pre: true, suf: true });
  });

  await test('between(a,b) is exclusive of bounds; across(a,b) is inclusive', async (validator: any) => {
    const ex = $.between('<', '>').path('x').build() as WrappedSegment;
    const inc = $.across('(', ')').path('x').build() as WrappedSegment;
    const exM = ex.match('<x>');
    const incM = inc.match('(x)');
    return validator.expect({
      ex: exM?.path,
      inc: incM?.path,
    }).toLookLike({ ex: 'x', inc: '(x)' });
  });

  await test('toString renders the actual prefix/suffix (legacy bug fix)', async (validator: any) => {
    const both = $.from('(').upto(')').path('inner').build();
    const pre = $.from('$').path('x').build();
    return validator.expect({
      both: both.toString(),
      pre: pre.toString(),
    }).toLookLike({ both: '(inner)', pre: '$x' });
  });

  await test('$.either(a,b) builds a GroupSegment matching either alt and rejecting non-members', async (validator: any) => {
    const g = $.either($.path('a'), $.path('b')).build() as GroupSegment;
    return validator.expect({
      isGroup: g instanceof GroupSegment,
      matchA: g.match('a') !== undefined,
      matchB: g.match('b') !== undefined,
      rejectsC: g.match('c') === undefined,
    }).toLookLike({ isGroup: true, matchA: true, matchB: true, rejectsC: true });
  });

  await test('.as("field") names a capture; the match.links carries it', async (validator: any) => {
    const seg = $.from('{').upto('}').any().as('field').build();
    const m = seg.match('{hello}');
    return validator.expect({
      matched: m !== undefined,
      isArr: Array.isArray(m?.links['field']),
      len: m?.links['field'].length,
    }).toLookLike({ matched: true, isArr: true, len: 1 });
  });

  await test('toJSON → fromJSON round-trips and preserves match behavior', async (validator: any) => {
    const seg = $.from('(').upto(')').either($.path('a'), $.path('b')).as('outer').build();
    const json = seg.toJSON();
    const rebuilt = Segment.fromJSON(JSON.parse(JSON.stringify(json)));
    return validator.expect({
      origMatches: seg.match('(a)') !== undefined,
      rebuiltMatches: rebuilt.match('(a)') !== undefined,
      stable: JSON.stringify(seg.toJSON()) === JSON.stringify(rebuilt.toJSON()),
    }).toLookLike({ origMatches: true, rebuiltMatches: true, stable: true });
  });
};
