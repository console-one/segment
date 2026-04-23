/**
 * PathFormat — a named delimiter-based addressing convention.
 *
 * Each format has:
 *   - a name (tagged in composite keys as `[format=${name}]`)
 *   - a delimiter between keys (e.g. '.' for JSON, '/' for files, ':' for
 *     resources)
 *   - an optional root marker (e.g. '@' for JSON, '' for files)
 *
 * Formats are pure data. They don't know about cells or parsers or storage.
 * What they KNOW is how to chop a string into keys and how to recognise
 * their own tag in a composite key.
 *
 * A Regime (see regime.ts) is what adds the rules. Format = syntax;
 * Regime = syntax + semantics bundled.
 */

import {
  Segment,
  GroupSegment,
  PathSegment,
  WildcardSegment,
} from './segment.js';

export interface PathFormat<Name extends string = string, Delim extends string = string> {
  readonly name: Name;
  readonly delimiter: Delim;
  readonly root?: string;
}

export function toPathFormat<N extends string, D extends string>(name: N, delimiter: D): PathFormat<N, D> {
  return { name, delimiter };
}

export function toRootedPathFormat<N extends string, D extends string>(
  name: N,
  delimiter: D,
  root: string,
): PathFormat<N, D> {
  return { name, delimiter, root };
}

// Built-in formats.
export const JSONFormat     = toRootedPathFormat('json', '.', '@');
export const ResourceFormat = toPathFormat('resource', ':');
export const FileFormat     = toRootedPathFormat('filepath', '/', '');
export const StageFormat    = toPathFormat('stage', '/');
export const VersionFormat  = toPathFormat('version', '/');

// ═══════════════════════════════════════════════════════════════════════
// Simple fromString — one format, split by delimiter, each piece becomes
// a segment (`*` → wildcard, everything else → literal PathSegment).
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse a path string under a given format into a Segment tree.
 *
 * For a literal path like `@.users.alice.name` under JSONFormat:
 *   → GroupSegment([PathSegment("users"), PathSegment("alice"), PathSegment("name")])
 *
 * `*` in any position becomes a WildcardSegment. The root marker (if any)
 * is stripped before splitting. Empty trailing keys are preserved.
 *
 * Returns a GroupSegment even for a single key, so callers can treat the
 * output uniformly.
 */
export function segmentFromString(format: PathFormat, str: string): GroupSegment {
  let working = str;
  if (format.root && working.startsWith(format.root)) {
    working = working.slice(format.root.length);
  }
  if (working.startsWith(format.delimiter)) {
    working = working.slice(format.delimiter.length);
  }
  const keys = working === '' ? [] : working.split(format.delimiter);
  const segments: Segment[] = keys.map(k => (k === '*' ? new WildcardSegment() : new PathSegment(k)));
  return new GroupSegment(segments);
}

// ═══════════════════════════════════════════════════════════════════════
// Composite key round-trip
//
// A composite key spans multiple formats via `[format=X]` markers.
// Each route segment is `[type=Y]${path}` under the currently active format.
//
// Round-trip target:
//   routes → buildCompositeKey(routes, headFormat) → str
//          ← parseCompositeKey(str, registry)     ← str
//   assert routes equal (format matched by name, not object identity).
// ═══════════════════════════════════════════════════════════════════════

export interface Route {
  /** Name of the route (e.g. `Workspace`, `File`). Tagged as `[type=X]` in the key. */
  type: string;
  /** The key parts under the currently-active format. */
  route: string[];
  /** Optional format override. If set, emits `[format=name]` and changes
   *  the active format for this and subsequent routes. */
  format?: PathFormat;
}

/**
 * Serialise a list of typed routes into a composite key string.
 *
 * Example:
 *   routes = [
 *     { type: 'Workspace', route: ['acme'] },
 *     { type: 'File', route: ['docs', 'index.md'], format: JSONFormat }
 *   ]
 *   headFormat = ResourceFormat
 *
 *   →  '[format=resource][type=Workspace]acme[type=File][format=json]@.docs.index.md'
 */
export function buildCompositeKey(routes: Route[], headFormat: PathFormat): string {
  if (routes.length === 0) return `[format=${headFormat.name}]`;

  const parts: string[] = [`[format=${headFormat.name}]`];
  let activeFormat = headFormat;

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const nextFormat = r.format ?? activeFormat;
    parts.push(`[type=${r.type}]`);
    if (nextFormat.name !== activeFormat.name) {
      parts.push(`[format=${nextFormat.name}]`);
      activeFormat = nextFormat;
    }
    const prefix = activeFormat.root ?? '';
    const joined = r.route.join(activeFormat.delimiter);
    parts.push(`${prefix}${joined}`);
  }
  return parts.join('');
}

export interface FormatRegistryLike {
  get(name: string): PathFormat | undefined;
}

/** Default registry wrapping built-in formats. Exported for convenience. */
export const defaultFormats: FormatRegistryLike = {
  get(name) {
    switch (name) {
      case 'json':     return JSONFormat;
      case 'resource': return ResourceFormat;
      case 'filepath': return FileFormat;
      case 'stage':    return StageFormat;
      case 'version':  return VersionFormat;
      default:         return undefined;
    }
  },
};

/**
 * Parse a composite key string back into routes + head format.
 *
 * Inverse of buildCompositeKey. Fails loudly if a format tag is not in the
 * registry, or if the string doesn't start with a format tag.
 */
export function parseCompositeKey(
  str: string,
  registry: FormatRegistryLike = defaultFormats,
): { routes: Route[]; headFormat: PathFormat } {
  // Tokenise: alternating bracket tags and path-fragments.
  //   '[format=resource][type=Workspace]acme[type=File][format=json]@.docs.index.md'
  //   → tags/frags: [format=resource], [type=Workspace], 'acme', [type=File], [format=json], '@.docs.index.md'
  const tokens = tokeniseBrackets(str);

  // Expect a leading [format=X].
  if (tokens.length === 0 || tokens[0].kind !== 'bracket' || !tokens[0].content.startsWith('format=')) {
    throw new Error(`parseCompositeKey: expected leading [format=...], got: ${str}`);
  }

  let activeFormat = resolveFormat(tokens[0].content.slice('format='.length), registry);
  const headFormat = activeFormat;

  const routes: Route[] = [];
  let pendingType: string | undefined;
  let pendingFormatOverride: PathFormat | undefined;

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.kind === 'bracket') {
      if (tok.content.startsWith('type=')) {
        // Flush any open route (shouldn't happen — types come before frags),
        // then open a new one.
        pendingType = tok.content.slice('type='.length);
      } else if (tok.content.startsWith('format=')) {
        pendingFormatOverride = resolveFormat(tok.content.slice('format='.length), registry);
        activeFormat = pendingFormatOverride;
      } else {
        throw new Error(`parseCompositeKey: unknown bracket tag: [${tok.content}]`);
      }
    } else {
      // A path fragment under activeFormat.
      if (pendingType === undefined) {
        throw new Error(`parseCompositeKey: path fragment without preceding [type=...]: ${tok.content}`);
      }
      const routeParts = splitUnderFormat(tok.content, activeFormat);
      const route: Route = { type: pendingType, route: routeParts };
      if (pendingFormatOverride) route.format = pendingFormatOverride;
      routes.push(route);
      pendingType = undefined;
      pendingFormatOverride = undefined;
    }
  }

  // A trailing [type=X] with no fragment is a valid empty route.
  if (pendingType !== undefined) {
    const route: Route = { type: pendingType, route: [] };
    if (pendingFormatOverride) route.format = pendingFormatOverride;
    routes.push(route);
  }

  return { routes, headFormat };
}

function resolveFormat(name: string, registry: FormatRegistryLike): PathFormat {
  const f = registry.get(name);
  if (!f) throw new Error(`parseCompositeKey: unknown format '${name}' in registry`);
  return f;
}

function splitUnderFormat(raw: string, format: PathFormat): string[] {
  let working = raw;
  if (format.root && working.startsWith(format.root)) working = working.slice(format.root.length);
  if (working.startsWith(format.delimiter)) working = working.slice(format.delimiter.length);
  if (working === '') return [];
  return working.split(format.delimiter);
}

type BracketToken = { kind: 'bracket'; content: string } | { kind: 'frag'; content: string };

function tokeniseBrackets(str: string): BracketToken[] {
  const out: BracketToken[] = [];
  let i = 0;
  let frag = '';
  while (i < str.length) {
    if (str[i] === '[') {
      if (frag) { out.push({ kind: 'frag', content: frag }); frag = ''; }
      const end = str.indexOf(']', i);
      if (end === -1) throw new Error(`tokeniseBrackets: unterminated [ at ${i}`);
      out.push({ kind: 'bracket', content: str.slice(i + 1, end) });
      i = end + 1;
    } else {
      frag += str[i];
      i++;
    }
  }
  if (frag) out.push({ kind: 'frag', content: frag });
  return out;
}
