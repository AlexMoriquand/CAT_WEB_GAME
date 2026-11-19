// Plateformes : 20 piliers disposés en cercle autour du point de départ, de plus en plus hauts.
// Chaque étape : [écart avec la précédente (bord à bord, environ), demi-largeur, montée, rayon du cercle]
const STEPS = [
  [0, 10, 4.0, 140],     // 1  départ
  [16, 9, 5.0, 140],
  [18, 8, 5.5, 144],
  [24, 7, 6.5, 140],
  [26, 6, 5.0, 136],     // 5
  [14, 6, 7.5, 142],
  [30, 6, 3.5, 146],
  [20, 5.5, 7.0, 140],
  [36, 6, 3.0, 134],
  [18, 5, 7.5, 140],     // 10  mi-parcours
  [28, 5.5, 5.5, 146],
  [22, 4.5, 7.0, 140],
  [50, 8, 1.0, 134],     // 13  grand saut : prends de l'élan
  [18, 5, 7.5, 140],
  [24, 4.5, 6.0, 146],   // 15
  [52, 8, 1.5, 138],     // 16  très grand saut
  [20, 4.5, 7.5, 132],
  [26, 4, 6.0, 140],
  [18, 4, 8.0, 146],
  [24, 8, 6.0, 140],     // 20  la plus haute
];

function buildCourse(steps = STEPS) {
  const T = [];
  let ang = 0, h = 0, prevHalf = 0, prevR = 0;
  for (const [gap, w, rise, R] of steps) {
    if (T.length) {
      const d = 1.2 * (prevHalf + w) + gap;                 // distance voulue entre les centres
      ang += 2 * Math.asin(Math.min(1, d / (prevR + R)));   // pas d'angle correspondant sur le cercle
    }
    h += rise; prevHalf = w; prevR = R;
    T.push({ x: R * Math.cos(ang), z: -R * Math.sin(ang), w, d: w, h });
  }
  return T;
}
const COURSE = buildCourse();

export { STEPS, buildCourse, COURSE };
