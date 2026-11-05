import { describe, expect, it } from "vitest";
import { rulesFromOps, type OpCodes } from "./rules";

const ops: OpCodes = { constructPath: 1, save: 2, restore: 3, transform: 4, paintFormXObjectBegin: 5, paintFormXObjectEnd: 6, stroke: 10, closeStroke: 11, fill: 12, eoFill: 13, fillStroke: 14, eoFillStroke: 15, closeFillStroke: 16, closeEOFillStroke: 17 };
const rect = (x: number, y: number, w: number, h: number) => new Float32Array([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4]);
const path = (op: number, data: Float32Array) => [ops.constructPath, [op, [data], null]] as const;

function run(list: (readonly [number, unknown])[]) {
  return rulesFromOps(list.map((l) => l[0]), list.map((l) => l[1]), ops);
}

describe("traits de la page", () => {
  it("un rectangle plein très fin est un trait (bordure Word)", () => {
    const rules = run([path(ops.eoFill, rect(476, 280, 0.9, 40)), path(ops.eoFill, rect(19, 200, 500, 300))]);
    expect(rules).toEqual([expect.objectContaining({ vertical: true, x1: 476, y2: 320 })]);
  });

  it("un rectangle tracé donne ses quatre côtés ; un tracé de découpe est ignoré", () => {
    expect(run([path(ops.stroke, rect(10, 10, 100, 50))])).toHaveLength(4);
    expect(run([path(99, rect(10, 10, 0.5, 50))])).toHaveLength(0);
  });

  it("suit la matrice de transformation", () => {
    const rules = run([[ops.save, null], [ops.transform, [1, 0, 0, 1, 100, 0]], path(ops.fill, rect(0, 0, 1, 30)), [ops.restore, null], path(ops.fill, rect(0, 0, 1, 30))]);
    expect(rules.map((r) => r.x1)).toEqual([100, 0]);
  });
});
