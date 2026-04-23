/**
 * ScopeVisitor — the operational mode of regime addressing.
 *
 * A Regime (regime.ts) tells you what rules apply at a format boundary;
 * a ScopeVisitor walks a concrete state map along declared dimensions,
 * firing lifecycle events per dimension entry, per-element visit inside,
 * and on exit. Commands emitted during the walk capture the visitor's
 * intent to mask/enforce/shard at that scope.
 *
 * This preserves the `scopedruleapplicator.ts` design from
 * console-one/transpilationNation with the core `start(visitor)` traversal
 * implemented. The concrete MASK/ENFORCE/SHARD semantics are a
 * downstream concern — this package ships the infrastructure, not the
 * policies.
 */

// ═══════════════════════════════════════════════════════════════════════
// Commands the visitor can emit during a walk
// ═══════════════════════════════════════════════════════════════════════

export enum ScopeUpdateCommandType {
  MASK = 'MASK',
  ENFORCE = 'ENFORCE',
  SHARD = 'SHARD',
}

export type MaskCommand = {
  command: ScopeUpdateCommandType.MASK;
  args: [dimension: string, toolsetName: string];
};

export type EnforceCommand = {
  command: ScopeUpdateCommandType.ENFORCE;
  args: [toolset: string];
};

export type ShardCommand = {
  command: ScopeUpdateCommandType.SHARD;
  args: [tool: string, strategy: ShardAllocationStrategy];
};

export type ScopeUpdateCommand = MaskCommand | EnforceCommand | ShardCommand;

/** Callback the visitor uses to emit commands. */
export type EmitCommand = (command: ScopeUpdateCommand) => void;

// ═══════════════════════════════════════════════════════════════════════
// Sharding strategy (preserved from legacy; generic shape)
// ═══════════════════════════════════════════════════════════════════════

export type AllocationDiff = Record<string, unknown>;

export class ShardAllocationStrategy {
  constructor(
    public readonly dimension: string,
    public readonly allocate: (allObservations: unknown[], newObservation: unknown) => AllocationDiff,
    public readonly rebalanceThreshold: (
      unbalanced: Array<[diff: AllocationDiff, dimension: string]>,
      totalAllocation: unknown,
    ) => string[],
  ) {}

  static create(
    dimension: string,
    allocate: ShardAllocationStrategy['allocate'],
    rebalanceThreshold: ShardAllocationStrategy['rebalanceThreshold'],
  ): ShardAllocationStrategy {
    return new ShardAllocationStrategy(dimension, allocate, rebalanceThreshold);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// The visitor
// ═══════════════════════════════════════════════════════════════════════

export type ScopeDiff = [prev: Record<string, unknown>, next: Record<string, unknown>];

export abstract class ScopeVisitor<State = unknown> {
  public state: State;

  constructor(initialiseState: () => State) {
    this.state = initialiseState();
  }

  /** Called when a new dimension value is entered. */
  abstract enter(scope: Record<string, unknown>, diff: ScopeDiff, emit: EmitCommand): void;

  /** Called once per element while inside the current dimension. */
  abstract inside(scope: Record<string, unknown>, emit: EmitCommand): void;

  /** Called when leaving a dimension value. */
  abstract exit(scope: Record<string, unknown>, diff: ScopeDiff, emit: EmitCommand): void;

  /** Called for elements of other dimensions during the visit (context). */
  abstract outside(scope: Record<string, unknown>, emit: EmitCommand): void;
}

// ═══════════════════════════════════════════════════════════════════════
// The tree being visited
// ═══════════════════════════════════════════════════════════════════════

/**
 * A ResourceMapScope is a sealed state map with a declared list of
 * navigation dimensions. Calling `start(visitor)` walks the map dimension
 * by dimension, firing the visitor's lifecycle methods in this order:
 *
 *   for each dimension D in rules:
 *     for each value v in state[D]:
 *       enter(scope-with-D-bound-to-v, diff, emit)
 *       for each other dimension D' in rules:
 *         for each value v' in state[D']:
 *           inside(scope-with-both-bound, emit)           if D' == D
 *           outside(scope-with-both-bound, emit)          otherwise
 *       exit(scope-with-D-bound-to-v, diff, emit)
 *
 * This guarantees `enter` → `inside`* → `exit` nesting, and fires
 * `outside` for dimensions that are NOT currently being entered — giving
 * the visitor visibility into the comparative context at each step.
 */
export class ResourceMapScope {
  private readonly _state: Record<string, unknown[]>;
  private readonly _rules: readonly string[];

  constructor(state: Record<string, unknown[]>, rules: readonly string[]) {
    // Sealed so visitors can't mutate what they're visiting.
    this._state = Object.freeze({ ...state }) as Record<string, unknown[]>;
    this._rules = Object.freeze([...rules]);
  }

  get state(): Readonly<Record<string, unknown[]>> {
    return this._state;
  }

  get rules(): readonly string[] {
    return this._rules;
  }

  /**
   * Walk the scope, firing visitor lifecycle methods.
   *
   * Returns the list of commands emitted during the walk, in order. This
   * is the substrate-level equivalent of a cascade: commands describe the
   * intent (mask this, enforce that, shard this), and a downstream
   * executor applies them.
   */
  start(visitor: ScopeVisitor): ScopeUpdateCommand[] {
    const commands: ScopeUpdateCommand[] = [];
    const emit: EmitCommand = (c) => { commands.push(c); };

    for (const dimension of this._rules) {
      const values = this._state[dimension];
      if (!Array.isArray(values)) continue;

      for (const v of values) {
        // Scope at entry: bind the current dimension to its value.
        const enterScope: Record<string, unknown> = { [dimension]: v };
        const prevScope: Record<string, unknown> = {};
        const enterDiff: ScopeDiff = [prevScope, enterScope];

        visitor.enter(enterScope, enterDiff, emit);

        // While inside this dimension value, visit every (dimension', v') pair.
        for (const otherDim of this._rules) {
          const otherValues = this._state[otherDim];
          if (!Array.isArray(otherValues)) continue;
          for (const ov of otherValues) {
            const comparativeScope: Record<string, unknown> = {
              [dimension]: v,
              [otherDim]: ov,
            };
            if (otherDim === dimension) {
              visitor.inside(comparativeScope, emit);
            } else {
              visitor.outside(comparativeScope, emit);
            }
          }
        }

        // Scope at exit: leaving the dimension value.
        const exitDiff: ScopeDiff = [enterScope, {}];
        visitor.exit(enterScope, exitDiff, emit);
      }
    }

    return commands;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// A minimal concrete visitor — captures lifecycle events for inspection.
// Useful as a smoke-test anchor and as a template for real visitors.
// ═══════════════════════════════════════════════════════════════════════

export type LifecycleEvent =
  | { kind: 'enter';   scope: Record<string, unknown>; diff: ScopeDiff }
  | { kind: 'inside';  scope: Record<string, unknown> }
  | { kind: 'outside'; scope: Record<string, unknown> }
  | { kind: 'exit';    scope: Record<string, unknown>; diff: ScopeDiff };

export class TracingVisitor extends ScopeVisitor<LifecycleEvent[]> {
  constructor() {
    super(() => [] as LifecycleEvent[]);
  }

  enter(scope: Record<string, unknown>, diff: ScopeDiff): void {
    this.state.push({ kind: 'enter', scope: { ...scope }, diff: [{ ...diff[0] }, { ...diff[1] }] });
  }

  inside(scope: Record<string, unknown>): void {
    this.state.push({ kind: 'inside', scope: { ...scope } });
  }

  outside(scope: Record<string, unknown>): void {
    this.state.push({ kind: 'outside', scope: { ...scope } });
  }

  exit(scope: Record<string, unknown>, diff: ScopeDiff): void {
    this.state.push({ kind: 'exit', scope: { ...scope }, diff: [{ ...diff[0] }, { ...diff[1] }] });
  }
}
