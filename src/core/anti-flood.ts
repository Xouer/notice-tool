/**
 * 防轰炸纯函数（T037，research.md R8）：时间 + 计数输入 → 决策输出。
 * - 渠道级令牌桶（默认 perChannelPerMinute: 20）
 * - 事件聚合窗口（同渠道短时间多条待发合并为一条汇总，窗口默认 30 秒）
 */
export interface TokenBucketState {
  capacity: number;
  refillPerMinute: number;
  tokens: number;
  lastRefillMs: number;
}

export interface TokenTakeResult {
  allowed: boolean;
  nextState: TokenBucketState;
}

/** 创建满容量令牌桶。 */
export function createTokenBucket(capacity: number, refillPerMinute: number): TokenBucketState {
  return { capacity, refillPerMinute, tokens: capacity, lastRefillMs: 0 };
}

/** 尝试取一个令牌（先按流逝时间补充，补充不超过容量）。 */
export function tryTakeToken(state: TokenBucketState, nowMs: number): TokenTakeResult {
  const elapsedMinutes = Math.max(0, nowMs - state.lastRefillMs) / 60_000;
  const tokens = Math.min(
    state.capacity,
    state.tokens + elapsedMinutes * state.refillPerMinute,
  );
  const nextState: TokenBucketState = { ...state, tokens, lastRefillMs: nowMs };
  if (tokens >= 1) {
    return { allowed: true, nextState: { ...nextState, tokens: tokens - 1 } };
  }
  return { allowed: false, nextState };
}

export interface AggregationWindowState {
  /** 当前窗口起点；null = 未开窗。 */
  windowStartMs: number | null;
  heldCount: number;
}

export type AggregationDecision = {
  action: "flush" | "hold";
  nextState: AggregationWindowState;
};

/**
 * 聚合窗口决策：
 * - 未开窗或窗口已过 → flush 并重开窗口
 * - 窗口内 → hold（后续事件合并进汇总）
 */
export function decideAggregation(
  state: AggregationWindowState,
  windowSeconds: number,
  nowMs: number,
): AggregationDecision {
  if (state.windowStartMs === null || nowMs - state.windowStartMs >= windowSeconds * 1000) {
    return { action: "flush", nextState: { windowStartMs: nowMs, heldCount: 0 } };
  }
  return {
    action: "hold",
    nextState: { windowStartMs: state.windowStartMs, heldCount: state.heldCount + 1 },
  };
}
