// ─────────────────────────────────────────────────────────────────────────
// buildCompositeKey + parseCompositeKey round-trip; segmentFromString
// builds a GroupSegment from a JSON-format-style address string.
// ─────────────────────────────────────────────────────────────────────────

import {
  buildCompositeKey,
  parseCompositeKey,
  segmentFromString,
  JSONFormat,
  ResourceFormat,
  GroupSegment,
  PathSegment,
  WildcardSegment,
  type Route,
} from '../index.js';

export default async (test: (name: string, body: (validator: any) => any) => any) => {
  await test('buildCompositeKey emits format and type tags', async (validator: any) => {
    const routes: Route[] = [
      { type: 'Workspace', route: ['acme'] },
      { type: 'File', route: ['docs', 'overview'], format: JSONFormat },
    ];
    const str = buildCompositeKey(routes, ResourceFormat);
    return validator.expect({
      hasResourceFormat: str.includes('[format=resource]'),
      hasWorkspaceType: str.includes('[type=Workspace]'),
      hasJsonFormat: str.includes('[format=json]'),
    }).toLookLike({ hasResourceFormat: true, hasWorkspaceType: true, hasJsonFormat: true });
  });

  await test('parseCompositeKey recovers head format, types, keys, and per-route format overrides', async (validator: any) => {
    const routes: Route[] = [
      { type: 'Workspace', route: ['acme'] },
      { type: 'File', route: ['docs', 'overview'], format: JSONFormat },
    ];
    const str = buildCompositeKey(routes, ResourceFormat);
    const parsed = parseCompositeKey(str);
    return validator.expect({
      headFmt: parsed.headFormat.name,
      routeCount: parsed.routes.length,
      r0Type: parsed.routes[0].type,
      r0Keys: parsed.routes[0].route,
      r1Type: parsed.routes[1].type,
      r1Format: parsed.routes[1].format?.name,
      r1Keys: parsed.routes[1].route,
    }).toLookLike({
      headFmt: 'resource',
      routeCount: 2,
      r0Type: 'Workspace',
      r0Keys: ['acme'],
      r1Type: 'File',
      r1Format: 'json',
      r1Keys: ['docs', 'overview'],
    });
  });

  await test('rebuilt composite key from parsed form equals original string', async (validator: any) => {
    const routes: Route[] = [
      { type: 'Workspace', route: ['acme'] },
      { type: 'File', route: ['docs', 'overview'], format: JSONFormat },
    ];
    const str = buildCompositeKey(routes, ResourceFormat);
    const parsed = parseCompositeKey(str);
    const rebuilt = buildCompositeKey(parsed.routes, parsed.headFormat);
    return validator.expect(rebuilt).toLookLike(str);
  });

  await test('segmentFromString(JSONFormat, "@.users.alice.name") strips the @ root and yields three keys', async (validator: any) => {
    const seg = segmentFromString(JSONFormat, '@.users.alice.name');
    return validator.expect({
      isGroup: seg instanceof GroupSegment,
      groupLen: seg.group.length,
      first: (seg.group[0] as PathSegment).path,
      last: (seg.group[2] as PathSegment).path,
    }).toLookLike({ isGroup: true, groupLen: 3, first: 'users', last: 'name' });
  });

  await test('segmentFromString turns "*" into a WildcardSegment', async (validator: any) => {
    const seg = segmentFromString(JSONFormat, '@.users.*.name');
    return validator.expect(seg.group[1] instanceof WildcardSegment).toLookLike(true);
  });
};
