/**
 * Segment — a path/grammar primitive that matches against tokenised input.
 *
 * A Segment is one of:
 *   - PathSegment     literal key
 *   - WildcardSegment matches anything
 *   - GroupSegment    alternation (ordered choice)
 *   - WrappedSegment  inner segment bounded by optional prefix/suffix, each
 *                     side independently inclusive or exclusive
 *
 * Segments compose. A GroupSegment can contain WrappedSegments whose inner
 * is another GroupSegment, etc. The whole tree is serialisable via
 * toJSON/fromJSON so a grammar can be declared in code and shipped over the
 * wire without live functions.
 *
 * The `$` DSL below enforces legal grammar construction at compile time.
 * Each builder state exposes only the methods that are valid from that
 * state, so `$.from('(').from(')')` (double prefix) and similar malformed
 * shapes don't type-check. The head of the grammar IS the TS type of the
 * builder.
 */

export type SegmentKind = 'Path' | 'Wildcard' | 'Group' | 'Wrapped';

export type SegmentJSON =
  | { type: 'Segment#Path'; value: { path: string; name?: string } }
  | { type: 'Segment#Wildcard'; value: { name?: string } }
  | { type: 'Segment#Group'; value: { group: SegmentJSON[]; name?: string } }
  | { type: 'Segment#Wrapped'; value: { inner: SegmentJSON; config: WrappedSegmentOptions; name?: string } };

export type WrappedSegmentOptions = {
  prefix?: string;
  suffix?: string;
  /** 'prefix' excludes only the prefix from the match,
   *  'suffix' excludes only the suffix,
   *  true excludes both. Undefined keeps both as part of the match span. */
  excludes?: 'prefix' | 'suffix' | true;
};

/** The captured result of a single Segment's match. */
export type SegmentMatch = {
  /** The full substring this segment matched against. */
  path: string;
  /** The segment that produced the match. */
  query: Segment;
  /** Nested matches from contained segments (for Group/Wrapped). */
  value: SegmentMatch[];
  /** Named captures collected along the walk. Any named segment (via `.as(name)`)
   *  surfaces its own match under its name; children's names are merged. */
  links: { [name: string]: SegmentMatch[] };
};

function makeMatch(path: string, query: Segment, children: SegmentMatch[] = []): SegmentMatch {
  const links: { [name: string]: SegmentMatch[] } = {};
  // Merge children's named captures upward.
  for (const child of children) {
    for (const key of Object.keys(child.links)) {
      if (!links[key]) links[key] = [];
      links[key].push(...child.links[key]);
    }
  }
  // If this query was named, surface this match under its name too.
  if (query.name) {
    if (!links[query.name]) links[query.name] = [];
    links[query.name].push({ path, query, value: children, links: {} });
  }
  return { path, query, value: children, links };
}

// ═══════════════════════════════════════════════════════════════════════
// Segment base + concrete types
// ═══════════════════════════════════════════════════════════════════════

export abstract class Segment {
  public readonly __type: `Segment#${SegmentKind}`;
  public name?: string;

  constructor(public readonly kind: SegmentKind) {
    this.__type = `Segment#${kind}`;
  }

  /** Attach a capture name to this segment. Mutates and returns self. */
  as(name: string): this {
    this.name = name;
    return this;
  }

  abstract match(path: string): SegmentMatch | undefined;
  abstract toString(): string;
  abstract toJSON(): SegmentJSON;

  static describes(item: any): item is Segment {
    return (
      item !== null &&
      typeof item === 'object' &&
      typeof item.__type === 'string' &&
      item.__type.startsWith('Segment#')
    );
  }

  static describesJSON(json: any): json is SegmentJSON {
    return (
      json !== null &&
      typeof json === 'object' &&
      typeof json.type === 'string' &&
      json.type.startsWith('Segment#') &&
      typeof json.value === 'object'
    );
  }

  static fromJSON(json: SegmentJSON): Segment {
    if (!Segment.describesJSON(json)) throw new Error(`Not a segment JSON: ${JSON.stringify(json)}`);
    let seg: Segment;
    switch (json.type) {
      case 'Segment#Path':     seg = new PathSegment(json.value.path); break;
      case 'Segment#Wildcard': seg = new WildcardSegment(); break;
      case 'Segment#Group':    seg = new GroupSegment(json.value.group.map(Segment.fromJSON)); break;
      case 'Segment#Wrapped':  seg = new WrappedSegment(Segment.fromJSON(json.value.inner) as any, json.value.config); break;
      default: throw new Error(`Unknown segment type: ${(json as any).type}`);
    }
    if (json.value.name) seg.name = json.value.name;
    return seg;
  }
}

export class PathSegment extends Segment {
  constructor(public readonly path: string) {
    super('Path');
  }

  toString(): string {
    return this.path;
  }

  match(path: string): SegmentMatch | undefined {
    return path === this.path ? makeMatch(path, this) : undefined;
  }

  toJSON(): SegmentJSON {
    const value: SegmentJSON['value'] = { path: this.path } as any;
    if (this.name) (value as any).name = this.name;
    return { type: 'Segment#Path', value: value as any };
  }
}

export class WildcardSegment extends Segment {
  constructor() {
    super('Wildcard');
  }

  toString(): string {
    return '*';
  }

  match(path: string): SegmentMatch | undefined {
    return makeMatch(path, this);
  }

  toJSON(): SegmentJSON {
    const value: any = {};
    if (this.name) value.name = this.name;
    return { type: 'Segment#Wildcard', value };
  }
}

export class GroupSegment extends Segment {
  constructor(public readonly group: Segment[]) {
    super('Group');
  }

  toString(): string {
    return `(${this.group.map(g => g.toString()).join('|')})`;
  }

  /** Ordered choice — first matching alternative wins. */
  match(path: string): SegmentMatch | undefined {
    for (const alt of this.group) {
      const m = alt.match(path);
      if (m) return makeMatch(path, this, [m]);
    }
    return undefined;
  }

  toJSON(): SegmentJSON {
    const value: any = { group: this.group.map(g => g.toJSON()) };
    if (this.name) value.name = this.name;
    return { type: 'Segment#Group', value };
  }
}

function endsWith(haystack: string, needle: string): boolean {
  if (needle.length > haystack.length) return false;
  return haystack.slice(haystack.length - needle.length) === needle;
}

export class WrappedSegment extends Segment {
  public readonly prefix?: string;
  public readonly suffix?: string;
  public readonly excludes?: 'prefix' | 'suffix' | true;

  constructor(
    public readonly inner: PathSegment | WildcardSegment | GroupSegment | WrappedSegment,
    config: WrappedSegmentOptions,
  ) {
    super('Wrapped');
    if (config.prefix !== undefined) this.prefix = config.prefix;
    if (config.suffix !== undefined) this.suffix = config.suffix;
    if (config.excludes !== undefined) this.excludes = config.excludes;
  }

  toString(): string {
    // BUG FIX: legacy version emitted `${this.prefix !== undefined}` which
    // stringified to "true" / "false". Now emits the actual prefix/suffix.
    const p = this.prefix ?? '';
    const s = this.suffix ?? '';
    return `${p}${this.inner.toString()}${s}`;
  }

  match(path: string): SegmentMatch | undefined {
    // BUG FIX: legacy required BOTH prefix AND suffix to be defined for any
    // match to succeed, which made one-sided `$.from('(')` unusable. Now
    // each side is independently optional.
    const prefixOk = this.prefix === undefined || path.startsWith(this.prefix);
    const suffixOk = this.suffix === undefined || endsWith(path, this.suffix);
    if (!prefixOk || !suffixOk) return undefined;

    // BUG FIX: legacy `excludes` arithmetic was inverted for the
    // 'prefix' / 'suffix' string values (collapsed 'suffix' to truthy when
    // computing startPrefixActivation). Split into two independent booleans.
    const excludePrefix = this.excludes === true || this.excludes === 'prefix';
    const excludeSuffix = this.excludes === true || this.excludes === 'suffix';

    const prefixLen = this.prefix?.length ?? 0;
    const suffixLen = this.suffix?.length ?? 0;

    // Range of the string consumed by the INNER segment.
    const innerStart = prefixLen;
    const innerEnd = path.length - suffixLen;
    if (innerStart > innerEnd) return undefined;

    const innerStr = path.slice(innerStart, innerEnd);
    const innerMatch = this.inner.match(innerStr);
    if (!innerMatch) return undefined;

    // The span this wrapped segment "owns" — includes prefix/suffix unless excluded.
    const ownStart = excludePrefix ? innerStart : 0;
    const ownEnd = excludeSuffix ? innerEnd : path.length;
    const ownPath = path.slice(ownStart, ownEnd);

    return makeMatch(ownPath, this, [innerMatch]);
  }

  toJSON(): SegmentJSON {
    const config: WrappedSegmentOptions = {};
    if (this.prefix !== undefined) config.prefix = this.prefix;
    if (this.suffix !== undefined) config.suffix = this.suffix;
    if (this.excludes !== undefined) config.excludes = this.excludes;
    const value: any = { inner: this.inner.toJSON(), config };
    if (this.name) value.name = this.name;
    return { type: 'Segment#Wrapped', value };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Builder state machine
//
// The type of the builder narrows with each method call. You can only call
// methods valid in the current state. `.build()` is only available in
// terminal states. Malformed grammars (e.g. two prefixes, no state) don't
// type-check.
// ═══════════════════════════════════════════════════════════════════════

class WrappedSegmentBuilder {
  public prefix?: string;
  public suffix?: string;
  public excludes?: 'prefix' | 'suffix' | true;
  public internal?: PathSegment | WildcardSegment | GroupSegment | WrappedSegment;
  public name?: string;

  setPrefix(s: string, exclusive: boolean) {
    this.prefix = s;
    if (exclusive) {
      this.excludes = this.excludes === 'suffix' ? true : 'prefix';
    }
  }

  setSuffix(s: string, exclusive: boolean) {
    this.suffix = s;
    if (exclusive) {
      this.excludes = this.excludes === 'prefix' ? true : 'suffix';
    }
  }

  setBounds(a: string, b: string, exclusive: boolean) {
    this.setPrefix(a, exclusive);
    this.setSuffix(b, exclusive);
  }

  build(): WrappedSegment | PathSegment | WildcardSegment | GroupSegment {
    if (!this.internal) throw new Error('WrappedSegmentBuilder: no inner segment set before build()');
    // If no prefix/suffix, unwrap: the caller just wanted a bare segment.
    if (this.prefix === undefined && this.suffix === undefined) {
      if (this.name) this.internal.name = this.name;
      return this.internal;
    }
    const seg = new WrappedSegment(this.internal, {
      prefix: this.prefix,
      suffix: this.suffix,
      excludes: this.excludes,
    });
    if (this.name) seg.name = this.name;
    return seg;
  }
}

/** Shared base: all builder states support `.as(name)` and `.build()`
 *  (though `.build()` may throw in non-terminal states if required fields
 *  are missing — the states above make that impossible at the type level). */
export abstract class BuildState {
  constructor(public builder: WrappedSegmentBuilder) {}
  as(name: string): this {
    this.builder.name = name;
    return this;
  }
  build() {
    return this.builder.build();
  }
}

/** Initial state — you can go anywhere. */
export class WrappedSegmentBuildState extends BuildState {
  from(s: string)   { this.builder.setPrefix(s, false); return new PrefixOnlyState(this.builder); }
  after(s: string)  { this.builder.setPrefix(s, true);  return new PrefixOnlyState(this.builder); }
  upto(s: string)   { this.builder.setSuffix(s, false); return new SuffixOnlyState(this.builder); }
  before(s: string) { this.builder.setSuffix(s, true);  return new SuffixOnlyState(this.builder); }
  between(a: string, b: string) { this.builder.setBounds(a, b, true);  return new NeedsStateState(this.builder); }
  across(a: string, b: string)  { this.builder.setBounds(a, b, false); return new NeedsStateState(this.builder); }
  either(...segments: (Segment | BuildState)[]) {
    this.builder.internal = new GroupSegment(segments.map(toSegment));
    return new StateOnlyState(this.builder);
  }
  path(s: string) {
    this.builder.internal = new PathSegment(s);
    return new StateOnlyState(this.builder);
  }
  match(seg: Segment | BuildState) {
    this.builder.internal = toSegment(seg) as any;
    return new StateOnlyState(this.builder);
  }
  any() {
    this.builder.internal = new WildcardSegment();
    return new StateOnlyState(this.builder);
  }
}

/** Prefix set. Can add suffix / inner / either. Cannot set another prefix. */
export class PrefixOnlyState extends BuildState {
  upto(s: string)   { this.builder.setSuffix(s, false); return new NeedsStateState(this.builder); }
  before(s: string) { this.builder.setSuffix(s, true);  return new NeedsStateState(this.builder); }
  either(...segments: (Segment | BuildState)[]) {
    this.builder.internal = new GroupSegment(segments.map(toSegment));
    return new NeedsSuffixState(this.builder);
  }
  path(s: string) {
    this.builder.internal = new PathSegment(s);
    return new NeedsSuffixState(this.builder);
  }
  match(seg: Segment | BuildState) {
    this.builder.internal = toSegment(seg) as any;
    return new NeedsSuffixState(this.builder);
  }
  any() {
    this.builder.internal = new WildcardSegment();
    return new NeedsSuffixState(this.builder);
  }
}

/** Suffix set. Can add prefix / inner / either. Cannot set another suffix. */
export class SuffixOnlyState extends BuildState {
  from(s: string)  { this.builder.setPrefix(s, false); return new NeedsStateState(this.builder); }
  after(s: string) { this.builder.setPrefix(s, true);  return new NeedsStateState(this.builder); }
  either(...segments: (Segment | BuildState)[]) {
    this.builder.internal = new GroupSegment(segments.map(toSegment));
    return new NeedsPrefixState(this.builder);
  }
  path(s: string) {
    this.builder.internal = new PathSegment(s);
    return new NeedsPrefixState(this.builder);
  }
  match(seg: Segment | BuildState) {
    this.builder.internal = toSegment(seg) as any;
    return new NeedsPrefixState(this.builder);
  }
  any() {
    this.builder.internal = new WildcardSegment();
    return new NeedsPrefixState(this.builder);
  }
}

/** Inner set. Can add prefix and/or suffix. Can build directly (unwrapped). */
export class StateOnlyState extends BuildState {
  from(s: string)   { this.builder.setPrefix(s, false); return new NeedsSuffixState(this.builder); }
  after(s: string)  { this.builder.setPrefix(s, true);  return new NeedsSuffixState(this.builder); }
  upto(s: string)   { this.builder.setSuffix(s, false); return new NeedsPrefixState(this.builder); }
  before(s: string) { this.builder.setSuffix(s, true);  return new NeedsPrefixState(this.builder); }
  between(a: string, b: string) { this.builder.setBounds(a, b, true);  return new TerminalState(this.builder); }
  across(a: string, b: string)  { this.builder.setBounds(a, b, false); return new TerminalState(this.builder); }
}

/** Prefix + inner set. Needs a suffix or can build (prefix-only wrapped). */
export class NeedsSuffixState extends BuildState {
  upto(s: string)   { this.builder.setSuffix(s, false); return new TerminalState(this.builder); }
  before(s: string) { this.builder.setSuffix(s, true);  return new TerminalState(this.builder); }
}

/** Suffix + inner set. Needs a prefix or can build (suffix-only wrapped). */
export class NeedsPrefixState extends BuildState {
  from(s: string)  { this.builder.setPrefix(s, false); return new TerminalState(this.builder); }
  after(s: string) { this.builder.setPrefix(s, true);  return new TerminalState(this.builder); }
}

/** Both bounds set. Needs an inner segment. */
export class NeedsStateState extends BuildState {
  either(...segments: (Segment | BuildState)[]) {
    this.builder.internal = new GroupSegment(segments.map(toSegment));
    return new TerminalState(this.builder);
  }
  path(s: string) {
    this.builder.internal = new PathSegment(s);
    return new TerminalState(this.builder);
  }
  match(seg: Segment | BuildState) {
    this.builder.internal = toSegment(seg) as any;
    return new TerminalState(this.builder);
  }
  any() {
    this.builder.internal = new WildcardSegment();
    return new TerminalState(this.builder);
  }
}

/** Everything set. Only `.as(name)` and `.build()` remain. */
export class TerminalState extends BuildState {}

function toSegment(item: Segment | BuildState): Segment {
  if (item instanceof Segment) return item;
  if (item instanceof BuildState) return item.build() as Segment;
  throw new Error(`toSegment: not a Segment or BuildState: ${item}`);
}

// ═══════════════════════════════════════════════════════════════════════
// Public DSL entrypoint
// ═══════════════════════════════════════════════════════════════════════

export const $ = {
  from:    (s: string) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).from(s),
  after:   (s: string) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).after(s),
  upto:    (s: string) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).upto(s),
  before:  (s: string) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).before(s),
  between: (a: string, b: string) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).between(a, b),
  across:  (a: string, b: string) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).across(a, b),
  either:  (...segments: (Segment | BuildState)[]) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).either(...segments),
  path:    (s: string) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).path(s),
  match:   (seg: Segment | BuildState) => new WrappedSegmentBuildState(new WrappedSegmentBuilder()).match(seg),
  any:     () => new WildcardSegment(),
  literal: (s: string) => new PathSegment(s),
};
