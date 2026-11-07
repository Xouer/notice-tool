import { describe, expect, it } from "vitest";
import {
  createTokenBucket,
  decideAggregation,
  tryTakeToken,
} from "../../src/core/anti-flood.js";

/**
 * T029：防轰炸纯函数单元测试（Red 先行）。
 * 渠道级令牌桶（默认 perChannelPerMinute: 20）+ 聚合窗口（默认 30 秒）。
 */
describe("token bucket / 渠道级令牌桶（T029）", () => {
  it("容量内允许，超出拒绝", () => {
    let state = createTokenBucket(3, 60); // 容量 3，每分钟补充 60
    for (let i = 0; i < 3; i += 1) {
      const r = tryTakeToken(state, i * 100);
      expect(r.allowed).toBe(true);
      state = r.nextState;
    }
    expect(tryTakeToken(state, 400).allowed).toBe(false);
  });

  it("随时间补充令牌", () => {
    let state = createTokenBucket(2, 60); // 每秒补充 1 个
    state = tryTakeToken(state, 0).nextState;
    state = tryTakeToken(state, 0).nextState;
    expect(tryTakeToken(state, 0).allowed).toBe(false);
    // 1 秒后补充 1 个
    const refilled = tryTakeToken(state, 1_000);
    expect(refilled.allowed).toBe(true);
  });

  it("补充不超过容量", () => {
    let state = createTokenBucket(2, 60);
    // 长时间流逝也最多补满容量
    state = tryTakeToken(state, 0).nextState;
    state = tryTakeToken(state, 0).nextState;
    expect(tryTakeToken(state, 60 * 60 * 1000).allowed).toBe(true);
    const s = tryTakeToken(state, 60 * 60 * 1000).nextState;
    expect(tryTakeToken(s, 60 * 60 * 1000).allowed).toBe(true); // 容量内第二个
  });
});

describe("aggregation window / 聚合窗口（T029）", () => {
  const WINDOW_SECONDS = 30;

  it("窗口首条 flush 并开窗", () => {
    const d = decideAggregation({ windowStartMs: null, heldCount: 0 }, WINDOW_SECONDS, 0);
    expect(d.action).toBe("flush");
    expect(d.nextState.windowStartMs).toBe(0);
  });

  it("窗口内后续事件 hold 聚合", () => {
    const first = decideAggregation({ windowStartMs: null, heldCount: 0 }, WINDOW_SECONDS, 0);
    const second = decideAggregation(first.nextState, WINDOW_SECONDS, 29_000);
    expect(second.action).toBe("hold");
    expect(second.nextState.heldCount).toBe(1);
  });

  it("窗口过后 flush 并重开窗口", () => {
    const first = decideAggregation({ windowStartMs: null, heldCount: 0 }, WINDOW_SECONDS, 0);
    const after = decideAggregation(first.nextState, WINDOW_SECONDS, 31_000);
    expect(after.action).toBe("flush");
    expect(after.nextState.windowStartMs).toBe(31_000);
    expect(after.nextState.heldCount).toBe(0);
  });
});
