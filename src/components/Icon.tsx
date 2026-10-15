// Jeu d'icônes minimal dessiné pour Paperasse (traits 24×24).
const PATHS: Record<string, string> = {
  open: "M3 7h6l2 2h10v10H3z M3 7V5h6l2 2",
  save: "M5 3h11l3 3v15H5z M8 3v5h8V3 M8 14h8v7H8z",
  share: "M18 8a3 3 0 1 0-3-3 M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 10.5l6.8-4 M8.6 13.5l6.8 4",
  print: "M6 9V3h12v6 M6 18H4v-8h16v8h-2 M7 14h10v7H7z",
  undo: "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-5-5 M8 11h6 M11 8v6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-5-5 M8 11h6",
  fit: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
  select: "M5 3l13 8-6 1.5L9 19z",
  editText: "M4 20h4l10-10-4-4L4 16z M13 7l4 4 M14 20h6",
  text: "M5 5h14 M12 5v14 M9 19h6",
  ink: "M3 17c3-1 4-8 7-8s2 7 5 7 3-5 6-6",
  highlight: "M4 20h8 M14 4l6 6-8 8H6v-6z",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z",
  line: "M5 19L19 5",
  arrow: "M5 19L19 5 M10 5h9v9",
  shapes: "M3 13h8v8H3z M17 3l4 7h-8z M17 14a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  pen: "M4 20l4-1 11-11-3-3L5 16z M14 7l3 3",
  doubleArrow: "M5 19L19 5 M10 5h9v9 M14 19H5v-9",
  stamp: "M9 3h6v5l-1 3h4a2 2 0 0 1 2 2v3H4v-3a2 2 0 0 1 2-2h4L9 8z M4 20h16",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5v.01",
  keyboard: "M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10",
  whiteout: "M4 6h16v12H4z M8 10l8 4 M16 10l-8 4",
  image: "M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15 9h.01",
  sign: "M3 18c2-4 4-12 6-12s0 9 2 9 2-4 4-4 1 3 3 3 2-1 3-1 M3 21h18",
  pages: "M8 3h11v14H8z M5 7v14h11",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-5-5",
  form: "M4 4h16v16H4z M7 8h4 M7 12h10 M7 16h10 M14 7h3v2h-3z",
  props: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M14 4v4 M8 10v4 M16 16v4",
  close: "M6 6l12 12 M18 6L6 18",
  rotateL: "M4 4v6h6 M5 10a8 8 0 1 1 2 6",
  rotateR: "M20 4v6h-6 M19 10a8 8 0 1 0-2 6",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
  copy: "M8 8h12v12H8z M4 16V4h12",
  up: "M12 19V5 M5 12l7-7 7 7",
  down: "M12 5v14 M5 12l7 7 7-7",
  plus: "M12 5v14 M5 12h14",
  merge: "M6 3v6a6 6 0 0 0 6 6h6 M14 11l4 4-4 4 M6 21v-3",
  extract: "M12 3v12 M7 10l5 5 5-5 M4 21h16",
  font: "M4 20L10 4h1l6 16 M6.5 14h8 M17 20h4",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  move: "M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 20h16",
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
