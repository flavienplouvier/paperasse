import { describe, expect, it } from "vitest";
import { alongLine, frameCenter, rotateText, unrotateText, withAngle } from "./textFrame";
import type { TextAnnotation } from "./types";

const text = (patch: Partial<TextAnnotation> = {}): TextAnnotation => ({
  id: "t",
  kind: "text",
  pageId: "p",
  color: "#000",
  opacity: 1,
  origin: [100, 500],
  text: "Bonjour",
  fontKey: "std:Helvetica",
  fontSize: 10,
  rotation: 0,
  ...patch,
});

const close = (p: number[], q: number[]) => p.forEach((v, i) => expect(v).toBeCloseTo(q[i], 6));

describe("cadre et rotation d'un texte", () => {
  it("centre du cadre sous l'origine (ligne de base)", () => {
    close(frameCenter(text(), 60, 25), [130, 500 - (12.5 - 8)]);
  });

  it("le premier pivotement se fait autour du centre, ensuite le pivot reste fixe", () => {
    const a = withAngle(text(), 90, [130, 495]);
    expect(a).toMatchObject({ angle: 90, pivot: [130, 495] });
    expect(withAngle(a, 180, [0, 0]).pivot).toEqual([130, 495]);
    expect(withAngle(a, 360, [0, 0]).angle).toBeUndefined();
    expect(withAngle(a, 270, [0, 0]).angle).toBe(-90);
  });

  it("90° à l'écran (sens horaire) : le texte descend le long de la page", () => {
    const a = withAngle(text(), 90, [100, 500]);
    // Un point 10 pt à droite de l'origine se retrouve 10 pt plus bas sur la page.
    close(rotateText(a, [110, 500]), [100, 490]);
    close(unrotateText(a, [100, 490]), [110, 500]);
    expect(alongLine(a, [100, 470])).toBeCloseTo(30);
  });
});
