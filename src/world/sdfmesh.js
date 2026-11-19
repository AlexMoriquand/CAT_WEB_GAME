// Transforme une surface implicite (SDF) en maillage, avec la même méthode « surface nets » que le chaton.
// f(x, y, z) : distance à la surface ; lo, hi : coins de la zone ; h : taille des cellules ;
// occ(x, y, z) : SDF de toute la scène, pour assombrir les creux (occlusion ambiante).

function meshSDF(f, lo, hi, h, occ = f) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const vals = new Float32Array(nx * ny * nz);
  // on ne calcule finement que les blocs proches de la surface ; loin d'elle, un seul calcul par bloc suffit
  const B = 4, margin = (1.5 * 1.7321 * h + 2 * h) * 1.5;
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
    const d = f(lo[0] + (bi + 1.5) * h, lo[1] + (bj + 1.5) * h, lo[2] + (bk + 1.5) * h);
    const far = Math.abs(d) > margin, fill = d > 0 ? 1e3 : -1e3;
    for (let k = bk; k < Math.min(nz, bk + B); k++) for (let j = bj; j < Math.min(ny, bj + B); j++) {
      const o = nx * (j + ny * k);
      for (let i = bi; i < Math.min(nx, bi + B); i++) vals[o + i] = far ? fill : f(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
    }
  }

  const sy = nx, sz = nx * ny, cnx = nx - 1, cny = ny - 1, cnz = nz - 1, csy = cnx, csz = cnx * cny;
  const cell = new Int32Array(cnx * cny * cnz).fill(-1);
  const P = [], I = [];
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) {
    let o = nx * (j + ny * k), c = cnx * (j + cny * k);
    for (let i = 0; i < cnx; i++, o++, c++) {
      const g = [vals[o], vals[o + 1], vals[o + sy], vals[o + sy + 1], vals[o + sz], vals[o + sz + 1], vals[o + sz + sy], vals[o + sz + sy + 1]];
      let inside = 0; for (let q = 0; q < 8; q++) if (g[q] < 0) inside++;
      if (inside === 0 || inside === 8) continue;
      // sommet de la cellule : moyenne des points où la surface coupe ses arêtes
      let ax = 0, ay = 0, az = 0, n = 0;
      const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      for (const [a, b] of E) {
        if ((g[a] < 0) === (g[b] < 0)) continue;
        const t = g[a] / (g[a] - g[b]);
        ax += (a & 1) + ((b & 1) - (a & 1)) * t; ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; az += (a >> 2) + ((b >> 2) - (a >> 2)) * t; n++;
      }
      cell[c] = P.length / 3;
      P.push(lo[0] + (i + ax / n) * h, lo[1] + (j + ay / n) * h, lo[2] + (k + az / n) * h);
      const v = cell[c], b0 = g[0] < 0;
      const quad = (a, b, cc, d) => { if (b0) I.push(a, b, cc, a, cc, d); else I.push(a, cc, b, a, d, cc); };
      if (b0 !== (g[1] < 0) && j > 0 && k > 0) quad(v, cell[c - csy], cell[c - csy - csz], cell[c - csz]);
      if (b0 !== (g[2] < 0) && i > 0 && k > 0) quad(v, cell[c - csz], cell[c - csz - 1], cell[c - 1]);
      if (b0 !== (g[4] < 0) && i > 0 && j > 0) quad(v, cell[c - 1], cell[c - 1 - csy], cell[c - csy]);
    }
  }
  // normales et occlusion ambiante, sommet par sommet
  const nv = P.length / 3, pos = new Float32Array(P), nrm = new Float32Array(nv * 3), ao = new Float32Array(nv), e = h * 0.25;
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1; gx /= l; gy /= l; gz /= l;
    nrm[v * 3] = gx; nrm[v * 3 + 1] = gy; nrm[v * 3 + 2] = gz;
    let o = 0;
    for (const [s, w] of [[1, 0.35], [2.5, 0.3], [5, 0.2], [9, 0.15]]) o += w * Math.max(0, 1 - occ(x + gx * s, y + gy * s, z + gz * s) / s);
    ao[v] = 1 - Math.min(0.8, o * 1.3);
  }
  // sens des triangles : vers l'extérieur
  const idx = new Uint32Array(I);
  let acc = 0;
  for (let t = 0; t < Math.min(idx.length, 6000); t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    acc += (uy * wz - uz * wy) * nrm[a] + (uz * wx - ux * wz) * nrm[a + 1] + (ux * wy - uy * wx) * nrm[a + 2];
  }
  if (acc < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  return { pos, nrm, ao, idx };
}

export { meshSDF };
