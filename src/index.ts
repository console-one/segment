// Public surface for @console-one/segment.
//
// Named re-exports only; keeps API explicit.

// Segment grammar primitives
export {
  Segment,
  PathSegment,
  WildcardSegment,
  GroupSegment,
  WrappedSegment,
  $,
} from './segment.js';
export type {
  SegmentKind,
  SegmentJSON,
  SegmentMatch,
  WrappedSegmentOptions,
} from './segment.js';

// Builder state machine (exported so users can type-annotate references)
export {
  BuildState,
  WrappedSegmentBuildState,
  PrefixOnlyState,
  SuffixOnlyState,
  StateOnlyState,
  NeedsStateState,
  NeedsPrefixState,
  NeedsSuffixState,
  TerminalState,
} from './segment.js';

// Path format + composite key round-trip
export {
  toPathFormat,
  toRootedPathFormat,
  JSONFormat,
  ResourceFormat,
  FileFormat,
  StageFormat,
  VersionFormat,
  defaultFormats,
  segmentFromString,
  buildCompositeKey,
  parseCompositeKey,
} from './format.js';
export type {
  PathFormat,
  FormatRegistryLike,
  Route,
} from './format.js';

// Regime — format + rules bundle, the substrate's addressing extension point
export {
  regime,
  RegimeRegistry,
  walk,
  trace,
} from './regime.js';
export type {
  Regime,
  WalkEvent,
  RegimeWalker,
  RegimeTrace,
} from './regime.js';

// Visitor — scope-tree traversal with enter/inside/exit/outside lifecycle
export {
  ScopeVisitor,
  ResourceMapScope,
  TracingVisitor,
  ShardAllocationStrategy,
  ScopeUpdateCommandType,
} from './visitor.js';
export type {
  ScopeUpdateCommand,
  MaskCommand,
  EnforceCommand,
  ShardCommand,
  EmitCommand,
  ScopeDiff,
  AllocationDiff,
  LifecycleEvent,
} from './visitor.js';
