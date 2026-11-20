import { mountShell } from './shared/shell';

mountShell({ page: 'home' });

/**
 * The hero's temple front, painted the way Greek temples actually were: an
 * Egyptian-blue pediment, triglyphs and cinnabar-and-ochre metopes over
 * stone columns. In dark mode the stone turns terracotta on black glaze,
 * like red-figure pottery (see the --temple-* variables in site.css).
 */
function drawTemple(svg: SVGSVGElement): void {
  const parts: string[] = [];
  const rect = (cls: string, x: number, y: number, w: number, h: number) => parts.push(`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`);

  // Pediment: the raking cornice, the blue tympanum and a gilded disc.
  parts.push('<polygon class="t-cornice" points="10,74 160,16 310,74"/>');
  parts.push('<polygon class="t-tympanum" points="34,69 160,25 286,69"/>');
  parts.push('<circle class="t-gilt" cx="160" cy="53" r="7"/><circle class="t-tympanum" cx="160" cy="53" r="3"/>');
  // Acroteria: palmettes on the apex and corners.
  for (const [x, y] of [[160, 16], [14, 72], [306, 72]]) {
    parts.push(`<path class="t-gilt" d="M${x} ${y - 12} q-7 6 -1 12 h2 q6 -6 -1 -12z"/>`);
  }

  // Horizontal cornice with a painted meander strip.
  rect('t-cornice', 10, 74, 300, 7);
  // Frieze: blue triglyphs between alternating cinnabar and ochre metopes.
  const friezeX = 20;
  const friezeW = 280;
  const triglyphs = 8;
  const tw = 12;
  const mw = (friezeW - triglyphs * tw) / (triglyphs - 1);
  rect('t-stone', friezeX, 81, friezeW, 18);
  for (let i = 0; i < triglyphs; i++) {
    const x = friezeX + i * (tw + mw);
    rect('t-triglyph', x, 81, tw, 18);
    parts.push(`<path class="t-line" d="M${x + 4} 83v14M${x + 8} 83v14"/>`);
    if (i < triglyphs - 1) {
      rect(i % 2 ? 't-metope-ochre' : 't-metope', x + tw + 3, 84, mw - 6, 12);
      parts.push(`<circle class="t-stone" cx="${x + tw + mw / 2}" cy="90" r="2.6"/>`);
    }
  }
  // Architrave with regulae.
  rect('t-stone', 20, 99, 280, 10);
  parts.push('<path class="t-line" d="M20 99h280M20 109h280"/>');

  // Six Doric columns: abacus, echinus, fluted shaft.
  const columns = 6;
  const first = 42;
  const step = (278 - first) / (columns - 1);
  for (let i = 0; i < columns; i++) {
    const cx = first + i * step;
    rect('t-stone', cx - 14, 109, 28, 5);
    parts.push(`<path class="t-stone" d="M${cx - 13} 114h26l-4 6h-18z"/>`);
    parts.push(`<rect class="t-band" x="${cx - 9}" y="120" width="18" height="2"/>`);
    parts.push(`<path class="t-stone" d="M${cx - 9} 122h18l1.5 62h-21z"/>`);
    parts.push(`<path class="t-flute" d="M${cx - 4.5} 124l-.6 58M${cx} 124v58M${cx + 4.5} 124l.6 58"/>`);
  }

  // Stylobate: three steps.
  rect('t-stone', 14, 184, 292, 8);
  rect('t-step', 8, 192, 304, 8);
  rect('t-stone', 2, 200, 316, 8);
  parts.push('<path class="t-line" d="M14 184h292M8 192h304M2 200h316M2 208h316"/>');
  svg.innerHTML = parts.join('');
}

const temple = document.querySelector<SVGSVGElement>('#temple');
if (temple) drawTemple(temple);
