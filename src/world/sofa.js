// Canapé et ses marches (coussin au sol, pouf, repose-pieds). Les formes sont arrondies et fondues entre elles,
// puis transformées en maillage comme le chaton. Le chaton peut grimper dessus : chaque élément a une boîte de collision.
import { meshSDF } from './sdfmesh.js';

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
// boîte arrondie donnée par ses bornes [x0, x1] [y0, y1] [z0, z1] et son rayon d'arrondi
function rbox(px, py, pz, x0, x1, y0, y1, z0, z1, r) {
  const qx = Math.abs(px - (x0 + x1) / 2) - (x1 - x0) / 2 + r, qy = Math.abs(py - (y0 + y1) / 2) - (y1 - y0) / 2 + r, qz = Math.abs(pz - (z0 + z1) / 2) - (z1 - z0) / 2 + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
// cylindre vertical arrondi : centre (cx, cz), rayon, de y0 à y1
function rcyl(px, py, pz, cx, cz, rad, y0, y1, r) {
  const dx = Math.hypot(px - cx, pz - cz) - rad + r, dy = Math.abs(py - (y0 + y1) / 2) - (y1 - y0) / 2 + r;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
}
// un coussin est plus bombé au milieu qu'aux bords
const puff = (px, pz, cx, cz, hx, hz, k) => -k * Math.max(0, 1 - ((px - cx) / hx) ** 2) * Math.max(0, 1 - ((pz - cz) / hz) ** 2);

/* ---- dimensions (le chaton mesure environ 22 de haut aux oreilles) ----
   Le canapé est derrière le point de départ, face au chaton. Assise à 28, accoudoirs et coussins du dossier à 35, dossier à 42 :
   chaque marche monte de 7, ce qu'un saut permet. */
const SOFA = { x0: -92, x1: -40, z0: -64, z1: 64 };
const SEAT = 28, ARM = 35, BACK = 42;

// matériaux : tissu moutarde, bois foncé, pouf en maille crème, coussin terre cuite
const parts = {
  fabric(px, py, pz) {
    let d = rbox(px, py, pz, -92, -40, 4, 22, -64, 64, 3);                                   // caisse
    d = smin(d, rbox(px, py, pz, -92, -40, 4, ARM, 52, 64, 5), 2);                        // accoudoirs
    d = smin(d, rbox(px, py, pz, -92, -40, 4, ARM, -64, -52, 5), 2);
    d = smin(d, rbox(px, py, pz, -92, -80, 4, BACK, -64, 64, 5), 2);                      // dossier
    for (const [z0, z1] of [[-52, -0.6], [0.6, 52]]) {
      const zc = (z0 + z1) / 2;
      d = Math.min(d, rbox(px, py, pz, -80, -40, 20.5, SEAT, z0, z1, 3.2) + puff(px, pz, -60, zc, 20, 26, 0.9));   // coussins d'assise
      d = Math.min(d, rbox(px, py, pz, -80, -69, 26, ARM + 1, z0, z1, 4) + puff(py, pz, 31, zc, 6, 26, 0.9));      // coussins du dossier
    }
    d = Math.min(d, rbox(px, py, pz, -36, -22, 0, 21, 12, 32, 3) + puff(px, pz, -29, 22, 7, 10, 0.6));             // repose-pieds
    return d;
  },
  wood(px, py, pz) {
    let d = 1e9;
    for (const x of [-88, -44]) for (const z of [-60, 60]) d = Math.min(d, rcyl(px, py, pz, x, z, 2.2 - 0.12 * Math.max(0, 5 - py), 0, 5, 0.4));
    for (const x of [-33, -25]) for (const z of [15, 29]) d = Math.min(d, rcyl(px, py, pz, x, z, 1.6, 0, 2, 0.3));
    return d;
  },
  knit(px, py, pz) {                                                                        // pouf rond tricoté : côtes verticales
    const a = Math.atan2(pz - 34, px + 10), rib = 0.35 * Math.abs(Math.sin(a * 14));
    return rcyl(px, py, pz, -10, 34, 9, 0, 14, 4) - rib * Math.min(1, Math.max(0, py - 1) / 3);
  },
  cushion(px, py, pz) {                                                                     // coussin posé par terre
    return rbox(px, py, pz, -6, 10, 0, 7, 44, 60, 3) + puff(px, pz, 2, 52, 8, 8, 0.8);
  },
};
const COLORS = { fabric: [0.80, 0.59, 0.24], wood: [0.33, 0.21, 0.14], knit: [0.90, 0.86, 0.78], cushion: [0.76, 0.42, 0.30] };
const BOUNDS = { fabric: [-96, -1, -68, -18, 47, 68], wood: [-92, -1, -64, -21, 6, 64], knit: [-21, -1, 23, 1, 16, 45], cushion: [-10, -1, 40, 14, 10, 64] };

// toutes les formes ensemble, plus le sol : sert à l'occlusion ambiante (coins plus sombres)
const all = (x, y, z) => Math.min(parts.fabric(x, y, z), parts.wood(x, y, z), parts.knit(x, y, z), parts.cushion(x, y, z), y);

// boîtes de collision : centre (x, z), demi-largeurs (w, d), hauteur du dessus (h)
const box = (x0, x1, z0, z1, h) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: (x1 - x0) / 2, d: (z1 - z0) / 2, h });
const FURNITURE = [
  box(-6, 10, 44, 60, 7),          // coussin par terre
  box(-18, -2, 26, 42, 14),        // pouf
  box(-36, -22, 12, 32, 21),       // repose-pieds
  box(-80, -40, -52, 52, SEAT),    // assise
  box(-80, -69, -52, 52, ARM),     // coussins du dossier
  box(-92, -40, 52, 64, ARM),      // accoudoirs
  box(-92, -40, -64, -52, ARM),
  box(-92, -80, -64, 64, BACK),    // haut du dossier
];

// maillages, un par matière (construits au chargement de la page)
function buildSofa() {
  return Object.keys(parts).map(k => {
    const b = BOUNDS[k], m = meshSDF(parts[k], [b[0], b[1], b[2]], [b[3], b[4], b[5]], k === 'fabric' ? 0.7 : 0.45, all);
    return { name: k, color: COLORS[k], ...m };
  });
}

export { FURNITURE, buildSofa };
