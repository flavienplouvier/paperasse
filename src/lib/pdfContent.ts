/**
 * Lecture des flux de contenu PDF : découpage en opérateurs (avec leur position
 * dans le flux, pour pouvoir les réécrire) et calcul matriciel.
 */

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a × b (convention PDF : vecteurs ligne, a appliquée d'abord). */
export function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

// ------------------------------------------------------------------ lecture du flux

export type Operand = number | string | Uint8Array | Operand[] | { name: string } | null | boolean;
export interface Op {
  op: string;
  args: Operand[];
  /** Position du premier opérande (ou de l'opérateur) et fin de l'opérateur. */
  start: number;
  end: number;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

class Lexer {
  pos = 0;
  constructor(private b: Uint8Array) {}

  private skipSpace() {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WS.has(c)) this.pos++;
      else if (c === 37) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  private regular(): string {
    const b = this.b;
    const s = this.pos;
    while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) this.pos++;
    return String.fromCharCode(...b.subarray(s, this.pos));
  }

  private literal(): Uint8Array {
    const b = this.b;
    const out: number[] = [];
    let depth = 1;
    this.pos++;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 92) {
        const n = b[this.pos++];
        const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (n in map) out.push(map[n]);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let i = 0; i < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; i++) v = v * 8 + b[this.pos++] - 48;
          out.push(v & 255);
        } else if (n === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (n !== 10) out.push(n);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Uint8Array.from(out);
  }

  private hex(): Uint8Array {
    const b = this.b;
    this.pos++;
    let digits = "";
    while (this.pos < b.length && b[this.pos] !== 62) {
      const c = b[this.pos++];
      if (!WS.has(c)) digits += String.fromCharCode(c);
    }
    this.pos++;
    if (digits.length % 2) digits += "0";
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16) || 0;
    return out;
  }

  /** Prochain élément : valeur, opérateur ({ op }) ou fin de flux (undefined). */
  next(): { value: Operand } | { op: string } | { close: "]" | ">>" } | undefined {
    this.skipSpace();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 40) return { value: this.literal() };
    if (c === 60) {
      if (b[this.pos + 1] === 60) {
        this.pos += 2;
        return { value: this.dict() };
      }
      return { value: this.hex() };
    }
    if (c === 62 && b[this.pos + 1] === 62) {
      this.pos += 2;
      return { close: ">>" };
    }
    if (c === 91) {
      this.pos++;
      const arr: Operand[] = [];
      for (;;) {
        const t = this.next();
        if (!t || ("close" in t && t.close === "]")) break;
        if ("value" in t) arr.push(t.value);
        else if ("op" in t) arr.push(t.op); // mot-clé dans un tableau : conservé tel quel
      }
      return { value: arr };
    }
    if (c === 93) {
      this.pos++;
      return { close: "]" };
    }
    if (c === 47) {
      this.pos++;
      return { value: { name: this.regular() } };
    }
    if (c === 123 || c === 125 || c === 41 || c === 62) {
      this.pos++;
      return this.next();
    }
    const word = this.regular();
    if (NUMBER.test(word)) return { value: parseFloat(word) };
    if (word === "true" || word === "false") return { value: word === "true" };
    if (word === "null") return { value: null };
    return { op: word };
  }

  private dict(): Operand {
    const items: Operand[] = [];
    for (;;) {
      const t = this.next();
      if (!t || ("close" in t && t.close === ">>")) break;
      if ("value" in t) items.push(t.value);
    }
    return items;
  }

  /** Saute les données binaires d'une image en ligne (après ID, jusqu'à EI). */
  skipInlineImage() {
    const b = this.b;
    this.pos++; // espace unique après ID
    while (this.pos < b.length) {
      if (
        b[this.pos] === 69 &&
        b[this.pos + 1] === 73 &&
        WS.has(b[this.pos - 1]) &&
        (this.pos + 2 >= b.length || WS.has(b[this.pos + 2]) || DELIM.has(b[this.pos + 2]))
      ) {
        this.pos += 2;
        return;
      }
      this.pos++;
    }
  }
}

export function parseOps(bytes: Uint8Array): Op[] {
  const lex = new Lexer(bytes);
  const ops: Op[] = [];
  let args: Operand[] = [];
  let start = -1;
  for (;;) {
    const before = lex.pos;
    const t = lex.next();
    if (!t) break;
    if ("close" in t) continue;
    if ("value" in t) {
      if (start < 0) start = firstNonSpace(bytes, before);
      args.push(t.value);
      continue;
    }
    const opStart = start < 0 ? firstNonSpace(bytes, before) : start;
    if (t.op === "BI") {
      // Image en ligne : dictionnaire jusqu'à ID puis données binaires jusqu'à EI.
      for (;;) {
        const u = lex.next();
        if (!u || ("op" in u && u.op === "ID")) break;
      }
      lex.skipInlineImage();
    }
    ops.push({ op: t.op, args, start: opStart, end: lex.pos });
    args = [];
    start = -1;
  }
  return ops;
}

function firstNonSpace(b: Uint8Array, from: number): number {
  let i = from;
  for (;;) {
    while (i < b.length && WS.has(b[i])) i++;
    if (b[i] === 37) while (i < b.length && b[i] !== 10 && b[i] !== 13) i++;
    else return i;
  }
}
