# @console-one/segment

Multi-format composite path grammar. The substrate addressing primitive.

## What this is

A path is not a string. It's a walk across a multi-dimensional lattice
where each dimension has its own syntactic rules. This package makes that
walk a first-class citizen:

- **Segment grammar** — declarative, composable, compile-time-verified
  path patterns built from `from / after / upto / before / between / across
  / either / path / match / any`. Same vocabulary as stream parsers.
- **PathFormat** — a named delimiter convention (`.` for JSON, `/` for
  files, `:` for resources). Formats are data, serialisable, round-trippable.
- **Composite keys** — strings like
  `[format=resource][type=Workspace]acme[type=File][format=json]@.docs.overview`
  that span multiple formats in one address. `buildCompositeKey` /
  `parseCompositeKey` round-trip.
- **Regime** — a format plus the rules that apply inside it. Extensible
  payload: consumers attach whatever rules they need (parser grammars,
  admission laws, visibility gates, resolution policies). Cross-format
  transitions in a composite key dispatch regime changes at the boundary.
- **ScopeVisitor** — a tree visitor with `enter / inside / exit / outside`
  lifecycle, walks a `ResourceMapScope` along declared dimensions,
  emitting `MASK / ENFORCE / SHARD` commands at each entry.

## Why this exists

In a substrate where cells live at coordinates in a multi-dimensional
lattice — structural path, temporal block, cross-sequence identity,
partition, stage/version, type refinement — you need ONE addressing
primitive. The alternative is a different addressing convention per
dimension, which is what happens when you split your kernel by feature
instead of by abstraction.

Segment collapses that. Every dimension is a `PathFormat`. Every rule set
is a `Regime`. Crossing from one dimension to another is a format
transition in a composite key — same syntax, different rules. New
dimensions arrive as new formats, zero kernel changes.

## Quick tour

### Build and match a segment

```ts
import { $ } from '@console-one/segment'

const braced = $.between('{', '}').any().as('field').build()

braced.match('{hello}')
// => { path: 'hello',           // exclusive bounds: match span is inner only
//      query: WrappedSegment,
//      value: [...],
//      links: { field: [...] } } // named capture via .as('field')

braced.toJSON()
// => { type: 'Segment#Wrapped',
//      value: { config: { prefix: '{', suffix: '}', excludes: true },
//               inner: { type: 'Segment#Wildcard', value: {} },
//               name: 'field' } }
```

The builder's TypeScript type narrows with each method call. Calling
`.from()` twice, or `.build()` without an inner segment, is a compile
error.

### Composite keys across formats

```ts
import {
  buildCompositeKey, parseCompositeKey,
  JSONFormat, ResourceFormat
} from '@console-one/segment'

const routes = [
  { type: 'Workspace', route: ['acme'] },
  { type: 'File',      route: ['docs', 'overview'], format: JSONFormat },
]
const key = buildCompositeKey(routes, ResourceFormat)
// '[format=resource][type=Workspace]acme[type=File][format=json]@.docs.overview'

const { routes: parsed } = parseCompositeKey(key)
// deep-equal to the input routes
```

### Regime — same address, different rules

```ts
import {
  regime, RegimeRegistry, trace,
  JSONFormat, ResourceFormat,
  buildCompositeKey
} from '@console-one/segment'

type Rules = { policy: string }

const devRegistry = new RegimeRegistry()
  .register(regime(ResourceFormat, { policy: 'read-only' }))
  .register(regime(JSONFormat,     { policy: 'mutable' }))

const prodRegistry = new RegimeRegistry()
  .register(regime(ResourceFormat, { policy: 'admin-only' }))
  .register(regime(JSONFormat,     { policy: 'public' }))

const key = buildCompositeKey(
  [{ type: 'Workspace', route: ['acme'] },
   { type: 'File',      route: ['doc'], format: JSONFormat }],
  ResourceFormat
)

trace<Rules>(key, devRegistry).map(t => t.regime.rules.policy)
// => ['read-only', 'mutable']

trace<Rules>(key, prodRegistry).map(t => t.regime.rules.policy)
// => ['admin-only', 'public']
```

The same address, under two regime registrations, yields different rules.
That is the substrate claim made testable: format tags are a real
dispatch mechanism.

### ScopeVisitor — walking a resource tree

```ts
import {
  ResourceMapScope, ScopeVisitor,
  ScopeUpdateCommandType, EmitCommand
} from '@console-one/segment'

class MaskAdminDims extends ScopeVisitor<void> {
  constructor() { super(() => {}) }
  enter(scope, diff, emit: EmitCommand) {
    if ('role' in scope && scope.role === 'admin') {
      emit({ command: ScopeUpdateCommandType.MASK, args: ['role', 'adminTools'] })
    }
  }
  inside(scope, emit) {}
  outside(scope, emit) {}
  exit(scope, diff, emit) {}
}

const map = new ResourceMapScope(
  { workspace: ['acme', 'globex'], role: ['admin', 'user'] },
  ['workspace', 'role']
)
const commands = map.start(new MaskAdminDims())
// two MASK commands, one per workspace's admin role entry
```

## Mapping to substrate concerns

| Substrate concern | Segment primitive |
|---|---|
| Path addressing | `Segment` grammar tree |
| Cross-sequence reference | Format transition to a peer-sequence regime |
| Partition (state / proc / id / req / chan / proj) | One `PathFormat` per partition, each with its own `Regime` rules |
| Stage / version addressing | `StageFormat`, `VersionFormat`; `Cell.resolve(path)` dispatches on format tag |
| Admission laws | `Regime.rules` — a consumer attaches its admission shape |
| Read-head masking | `Regime.rules.visibility` — consumer-defined |
| Walking a scope | `ScopeVisitor` + `ResourceMapScope.start(visitor)` |
| Multi-regime typed composite key | `buildCompositeKey` / `parseCompositeKey` |

None of these are hard-coded. The package ships the shape; consumers
attach their semantics via the `Rules` generic on `Regime`.

## Install

```bash
npm install @console-one/segment
```

## Public surface

```
from '@console-one/segment'

// Segment grammar
Segment, PathSegment, WildcardSegment, GroupSegment, WrappedSegment
$                           // DSL entrypoint
SegmentKind, SegmentJSON, SegmentMatch, WrappedSegmentOptions

// Builder states (for type annotations)
BuildState, WrappedSegmentBuildState, PrefixOnlyState, SuffixOnlyState,
StateOnlyState, NeedsStateState, NeedsPrefixState, NeedsSuffixState,
TerminalState

// Path format
PathFormat, toPathFormat, toRootedPathFormat
JSONFormat, ResourceFormat, FileFormat, StageFormat, VersionFormat
defaultFormats
segmentFromString
buildCompositeKey, parseCompositeKey, Route
FormatRegistryLike

// Regime
Regime, regime, RegimeRegistry
walk, trace, WalkEvent, RegimeWalker, RegimeTrace

// Visitor
ScopeVisitor, ResourceMapScope, TracingVisitor
ScopeUpdateCommand, ScopeUpdateCommandType,
MaskCommand, EnforceCommand, ShardCommand, EmitCommand, ScopeDiff,
ShardAllocationStrategy, AllocationDiff, LifecycleEvent
```

## Bugs fixed from the legacy pathformat

This package is a rehab of `console-one-workspace/transpilationNation`'s
`server/src/core/pathformat/segment.ts` plus the scope-visitor design
from `20240802_parser_state`'s `resources/scopedruleapplicator.ts`. Four
specific defects are fixed:

1. `WrappedSegment.toString()` used to emit the boolean
   `${this.prefix !== undefined}`. Now emits the actual prefix/suffix.
   (Case 6 in smoke test.)
2. `WrappedSegment.match()` used to require BOTH prefix and suffix to be
   defined, so `$.from('(')` with no suffix could never match. Now each
   side is independently optional. (Case 4.)
3. `excludes` arithmetic used to collapse `'suffix'` to truthy when
   computing the prefix activation, inverting the exclusion semantics.
   Now two independent booleans per side. (Case 5.)
4. `Segment.fromString` used to be a `// TODO: Implement` stub, blocking
   composite-key round-trips. Now implemented as `segmentFromString` for
   single-format paths and `parseCompositeKey` for multi-format composites.
   (Cases 10–11.)

The original file also shipped ambitious TypeScript template-literal type
recursion (`JoinWithDelimiter`, `CompositeKey`, `RKey`, `TypePath`) that
hit TS depth limits and had a double-`[type=]` emit bug. That machinery
is not preserved here — the runtime composite-key round-trip works
without it, and re-introducing it cleanly is its own project.

## Smoke test

```bash
npm install
npm run build
npm run smoke
```

14 cases, each corresponding to one primitive or fix. Exits non-zero on
any failure.

## What this package does NOT do

- Does not implement the concrete MASK / ENFORCE / SHARD semantics. The
  visitor infrastructure ships; downstream consumers attach the policy.
- Does not integrate with `@console-one/parser`, `@console-one/cell`,
  `@console-one/namespace`, or `@console-one/patchkit`. Those consumers
  adopt `Regime` on their own timeline.
- Does not support escaping of delimiter characters inside keys. Keys
  under a format must not contain that format's delimiter. Adding
  escape semantics is a v0.2 concern.
- Does not revive the template-literal-type composite-key synthesis.

## License

MIT
