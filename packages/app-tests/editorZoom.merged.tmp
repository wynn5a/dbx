import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_MAX_FONT_SIZE,
  EDITOR_MIN_FONT_SIZE,
  clampEditorFontSize,
  createEditorZoomCommitScheduler,
  fontSizeFromGestureScale,
  fontSizeFromWheelDelta,
} from "@/lib/editorZoom";

describe("clampEditorFontSize", () => {
  it("clamps below the minimum and above the maximum", () => {
    expect(clampEditorFontSize(2)).toBe(EDITOR_MIN_FONT_SIZE);
    expect(clampEditorFontSize(1000)).toBe(EDITOR_MAX_FONT_SIZE);
  });

  it("passes through in-range values and rounds to 2 decimals", () => {
    expect(clampEditorFontSize(13)).toBe(13);
    expect(clampEditorFontSize(12.3456)).toBe(12.35);
  });
});

describe("fontSizeFromWheelDelta", () => {
  it("zooms in on negative delta and out on positive delta", () => {
    expect(fontSizeFromWheelDelta(13, -100)).toBeGreaterThan(13);
    expect(fontSizeFromWheelDelta(13, 100)).toBeLessThan(13);
  });

  it("clamps extreme deltas to the configured bounds", () => {
    expect(fontSizeFromWheelDelta(13, -100000)).toBe(EDITOR_MAX_FONT_SIZE);
    expect(fontSizeFromWheelDelta(13, 100000)).toBe(EDITOR_MIN_FONT_SIZE);
  });
});

describe("fontSizeFromGestureScale", () => {
  it("scales relative to the gesture start size", () => {
    expect(fontSizeFromGestureScale(13, 1)).toBe(13);
    expect(fontSizeFromGestureScale(12, 1.5)).toBe(18);
  });

  it("clamps scaled values to the configured bounds", () => {
    expect(fontSizeFromGestureScale(13, 10)).toBe(EDITOR_MAX_FONT_SIZE);
    expect(fontSizeFromGestureScale(12, 0.1)).toBe(EDITOR_MIN_FONT_SIZE);
  });
});

describe("createEditorZoomCommitScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits a clamped/rounded value after the delay", () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const scheduler = createEditorZoomCommitScheduler((size) => commits.push(size));

    scheduler.schedule(15.123);
    expect(scheduler.hasPendingCommit()).toBe(true);
    expect(commits).toEqual([]);

    vi.advanceTimersByTime(160);
    expect(commits).toEqual([15.12]);
    expect(scheduler.hasPendingCommit()).toBe(false);
  });

  it("debounces rapid schedules to only the last value", () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const scheduler = createEditorZoomCommitScheduler((size) => commits.push(size));

    scheduler.schedule(14);
    scheduler.schedule(16);
    vi.advanceTimersByTime(160);

    expect(commits).toEqual([16]);
  });

  it("flush commits immediately and cancels the pending timer", () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const scheduler = createEditorZoomCommitScheduler((size) => commits.push(size));

    scheduler.schedule(20);
    scheduler.flush();
    expect(commits).toEqual([20]);
    expect(scheduler.hasPendingCommit()).toBe(false);

    // The cancelled timer must not fire a second commit.
    vi.advanceTimersByTime(160);
    expect(commits).toEqual([20]);
  });

  it("flush(value) prefers the explicit argument", () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const scheduler = createEditorZoomCommitScheduler((size) => commits.push(size));

    scheduler.schedule(20);
    scheduler.flush(18);
    expect(commits).toEqual([18]);
  });

  it("flush with nothing pending and no argument does not commit", () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const scheduler = createEditorZoomCommitScheduler((size) => commits.push(size));

    scheduler.flush();
    expect(commits).toEqual([]);
  });

  it("dispose cancels a pending commit", () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const scheduler = createEditorZoomCommitScheduler((size) => commits.push(size));

    scheduler.schedule(15);
    scheduler.dispose();
    vi.advanceTimersByTime(160);

    expect(commits).toEqual([]);
    expect(scheduler.hasPendingCommit()).toBe(false);
  });

  it("honors a custom delay", () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const scheduler = createEditorZoomCommitScheduler((size) => commits.push(size), 50);

    scheduler.schedule(15);
    vi.advanceTimersByTime(49);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([15]);
  });
});
