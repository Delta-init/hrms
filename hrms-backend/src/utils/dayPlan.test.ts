import { describe, expect, test } from "bun:test";
import { schedule, toMin, toHHMM } from "./dayPlan";

const starts = (s: ReturnType<typeof schedule>) => s.map((x) => toHHMM(x.start));

describe("dayPlan.schedule", () => {
  test("the user's example: C added between A and B moves B and D an hour later", () => {
    const before = schedule("13:00", [{ mins: 60 }, { mins: 60 }, { mins: 60 }]);
    expect(starts(before)).toEqual(["13:00", "14:00", "15:00"]);
    const after = schedule("13:00", [{ mins: 60 }, { mins: 60 }, { mins: 60 }, { mins: 60 }]);
    expect(starts(after)).toEqual(["13:00", "14:00", "15:00", "16:00"]);
  });

  test("tasks follow each other by their own lengths", () => {
    expect(starts(schedule("09:00", [{ mins: 10 }, { mins: 30 }, { mins: 20 }]))).toEqual(["09:00", "09:10", "09:40"]);
  });

  test("a fixed time leaves spare minutes free", () => {
    const s = schedule("12:00", [{ mins: 45 }, { mins: 30, fixedAt: "13:00" }, { mins: 20 }]);
    expect(starts(s)).toEqual(["12:00", "13:00", "13:30"]);
    expect(s[1].free).toBe(15);
    expect(s[1].over).toBe(0);
  });

  test("running over a fixed time starts it late and says by how much", () => {
    const s = schedule("12:00", [{ mins: 75 }, { mins: 30, fixedAt: "13:00" }, { mins: 20 }]);
    expect(starts(s)).toEqual(["12:00", "13:15", "13:45"]);
    expect(s[1].over).toBe(15);
  });

  test("an insertion moves later tasks only up to the next fixed time", () => {
    const base = [{ mins: 20 }, { mins: 20 }, { mins: 30, fixedAt: "13:00" }, { mins: 20 }];
    const withNew = [{ mins: 20 }, { mins: 15 }, { mins: 20 }, { mins: 30, fixedAt: "13:00" }, { mins: 20 }];
    expect(starts(schedule("12:00", base))).toEqual(["12:00", "12:20", "13:00", "13:30"]);
    expect(starts(schedule("12:00", withNew))).toEqual(["12:00", "12:20", "12:35", "13:00", "13:30"]);
  });

  test("time helpers", () => {
    expect(toMin("09:05")).toBe(545);
    expect(toHHMM(545)).toBe("09:05");
  });
});
