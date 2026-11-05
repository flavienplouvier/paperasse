import { describe, expect, it } from "vitest";
import { bendControl, curveAt, pointsBox, resizeRotated, rotateAround, scalePoints, translateAnnotation } from "./annotations";
import type { LineAnnotation, Rect } from "./types";

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("courbes", () => {
  it("la courbe passe par le point tiré en son milieu", () => {
    const from: [number, number] = [0, 0];
    const to: [number, number] = [100, 0];
    const c = bendControl(from, to, [50, 40]);
    near(curveAt(from, to, c, 0.5), [50, 40]);
    near(curveAt(from, to, c, 0), from);
    near(curveAt(from, to, c, 1), to);
  });

  it("déplacer une flèche courbe déplace aussi son point de contrôle", () => {
    const a: LineAnnotation = { id: "l", pageId: "p", color: "#000", opacity: 1, kind: "line", from: [0, 0], to: [10, 0], control: [5, 5], width: 1 };
    expect(translateAnnotation(a, 3, 4).control).toEqual([8, 9]);
  });
});

describe("rotation et taille", () => {
  it("tourne un point autour d'un centre", () => {
    near(rotateAround([10, 0], [0, 0], 90), [0, 10]);
  });

  it("sans rotation, le coin tiré suit le pointeur", () => {
    expect(resizeRotated([0, 0, 100, 50], [2, 3], [120, 80], 0)).toEqual([0, 0, 120, 80]);
  });

  it("avec rotation, le coin opposé reste en place", () => {
    const rect: Rect = [0, 0, 100, 50];
    const angle = 30;
    const c: [number, number] = [50, 25];
    // Coin opposé (bas gauche) avant, en coordonnées réelles.
    const anchorBefore = rotateAround([0, 0], c, -angle);
    // On tire le coin haut droit plus loin, le long de la diagonale tournée.
    const pulled = rotateAround([150, 80], c, -angle);
    const next = resizeRotated(rect, [2, 3], pulled, angle);
    const nc: [number, number] = [(next[0] + next[2]) / 2, (next[1] + next[3]) / 2];
    near(rotateAround([next[0], next[1]], nc, -angle), anchorBefore);
    expect(next[2] - next[0]).toBeCloseTo(150, 6);
    expect(next[3] - next[1]).toBeCloseTo(80, 6);
  });

  it("une poignée de bord ne change qu'un sens ; avec rotation, le bord opposé reste en place", () => {
    expect(resizeRotated([0, 0, 100, 50], [2, null], [130, 999], 0)).toEqual([0, 0, 130, 50]);
    expect(resizeRotated([0, 0, 100, 50], [null, 1], [999, -20], 0)).toEqual([0, -20, 100, 50]);
    const rect: Rect = [0, 0, 100, 50];
    const c: [number, number] = [50, 25];
    const leftMid = rotateAround([0, 25], c, -40);
    const next = resizeRotated(rect, [2, null], rotateAround([160, 25], c, -40), 40);
    const nc: [number, number] = [(next[0] + next[2]) / 2, (next[1] + next[3]) / 2];
    near(rotateAround([next[0], (next[1] + next[3]) / 2], nc, -40), leftMid);
    expect(next[3] - next[1]).toBeCloseTo(50, 6);
  });

  it("agrandit un dessin dans un nouveau cadre", () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 5],
    ];
    expect(scalePoints(pts, pointsBox(pts), [0, 0, 20, 10])).toEqual([
      [0, 0],
      [20, 10],
    ]);
  });
});
