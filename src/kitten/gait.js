// Allures quadrupèdes : marche féline à quatre temps et galop bondissant.
// Les angles sont appliqués dans le repère du corps (avant = +X, haut = +Y).
import { clamp, lerp } from '../utils/math.js';

const TAU = Math.PI * 2;
const sat = x => clamp(x, 0, 1);
const smooth = x => x * x * (3 - 2 * x);
const smoother = x => x * x * x * (x * (x * 6 - 15) + 10);

// Ordre : avant +z, avant -z, arrière +z, arrière -z.
// En marche, chaque patte se pose séparément : arrière gauche, avant gauche,
// arrière droite, avant droite. En course, les pattes arrière poussent ensemble,
// puis les pattes avant se réceptionnent ensemble (galop/bond).
const WALK_GAIT = {
  off: [0.25, 0.75, 0.00, 0.50],
  duty: 0.64, swing: 0.48,
  lift: [1.18, 1.18, 0.92, 0.92],
  stride: 28
};
const RUN_GAIT = {
  off: [0.54, 0.64, 0.00, 0.10],
  duty: 0.30, swing: 0.78,
  lift: [1.72, 1.72, 1.34, 1.34],
  stride: 42
};

// Trajectoire de patte avec un appui stable (pied presque immobile dans le monde)
// et un retour aérien arrondi. Le genou se replie surtout pendant le retour.
function legCycle(phase, duty, swing, lift, kneeScale = 1) {
  const p = phase - Math.floor(phase);
  if (p < duty) {
    const u = p / duty;
    // Déroulé régulier de l'appui, sans cassure à la transition.
    const x = swing * (1 - 2 * smoother(u));
    return [x, -0.06 * Math.sin(Math.PI * u) * kneeScale];
  }
  const u = (p - duty) / (1 - duty);
  const eased = smoother(u);
  const x = lerp(-swing, swing, eased);
  // Flexion maximale au milieu du balancement, patte qui se dégage du sol.
  const knee = -lift * Math.pow(Math.sin(Math.PI * u), 0.82) * kneeScale;
  return [x, knee];
}

const runBlend = (speed, walk, run) =>
  smoother(sat((speed - walk * 0.88) / (run * 0.92 - walk * 0.88)));
const strideLength = (speed, walk, run) =>
  lerp(WALK_GAIT.stride, RUN_GAIT.stride, runBlend(speed, walk, run));

/*
 * kit : speed, phase, vy, air (0 au sol, 1 en l'air), crouch.
 * Renvoie les angles de hanche/genou et les mouvements secondaires du corps.
 */
function pose(kit, time, walk, run, jump) {
  const g = runBlend(kit.speed, walk, run);
  const moving = sat(kit.speed / (walk * 0.42));
  const ph = kit.phase;
  const hips = [0, 0, 0, 0], knees = [0, 0, 0, 0];

  for (let i = 0; i < 4; i++) {
    const w = legCycle(ph + WALK_GAIT.off[i], WALK_GAIT.duty,
      WALK_GAIT.swing, WALK_GAIT.lift[i], i < 2 ? 0.92 : 1.08);
    const r = legCycle(ph + RUN_GAIT.off[i], RUN_GAIT.duty,
      RUN_GAIT.swing, RUN_GAIT.lift[i], i < 2 ? 1.05 : 0.92);
    hips[i] = lerp(w[0], r[0], g) * moving;
    knees[i] = lerp(w[1], r[1], g) * moving;
  }

  // Marche : léger transfert d'appui diagonal, bassin et épaules en opposition.
  // Course : compression puis extension de toute la colonne à chaque bond.
  const walkWave = Math.sin(TAU * ph);
  const runWave = Math.sin(TAU * ph - 0.85);
  const runDouble = Math.cos(2 * TAU * ph - 0.35);
  const bodyY = moving * lerp(
    0.075 + 0.11 * (0.5 + 0.5 * Math.sin(2 * TAU * ph - 0.6)),
    0.18 + 0.58 * (0.5 + 0.5 * runWave) + 0.10 * runDouble,
    g
  );
  let pitch = moving * lerp(0.035 * walkWave, 0.15 * runWave, g);
  let roll = moving * lerp(0.045 * Math.sin(TAU * ph + 0.4), 0.018 * Math.sin(TAU * ph), g);
  const yaw = moving * lerp(0.022 * Math.sin(TAU * ph + 1.1), 0.012 * Math.sin(TAU * ph), g);

  // La tête reste reliée cinématiquement au tronc : elle reprend une partie
  // du tangage/roulis global, avec une légère stabilisation et une impulsion
  // synchronisée au galop. Évite l'effet de tête animée indépendamment du corps.
  // La tête est davantage « portée » par le torse : moins de contre-rotation
  // stabilisatrice, et une impulsion de galop à la même phase que le tangage
  // du tronc. Cela évite qu'elle paraisse flotter ou battre un rythme séparé.
  const headPitch = moving * (
    -0.08 * pitch + lerp(0.018 * Math.sin(2 * TAU * ph - 1.05),
      0.105 * runWave + 0.035 * runDouble, g)
  );
  const headRoll = moving * (-0.06 * roll + lerp(
    0.006 * Math.sin(TAU * ph + 0.35), 0.010 * Math.sin(TAU * ph + 0.2), g));
  const headYaw = moving * (1 - g) * 0.004 * Math.sin(TAU * ph - 0.4)
    + moving * g * 0.002 * Math.sin(TAU * ph + 0.15);

  // Petit mouvement de bassin : les hanches suivent les appuis, sans effet mécanique.
  const pelvis = moving * (0.075 * Math.sin(TAU * ph + 0.7) * (1 - g)
    + 0.11 * Math.sin(TAU * ph - 1.0) * g);
  // Flexion lombaire visible : extension à la poussée, arrondissement à la réception.
  const backFlex = moving * lerp(0.22 * walkWave, 0.78 * runWave + 0.30 * runDouble, g);
  hips[2] += pelvis;
  hips[3] += pelvis;

  // Préparation au saut et amorti de réception : le corps se tasse,
  // les postérieurs fléchissent et les antérieurs se préparent à l'appui.
  const c = kit.crouch;
  hips[0] -= 0.28 * c; hips[1] -= 0.28 * c;
  hips[2] += 0.40 * c; hips[3] += 0.40 * c;
  knees[0] -= 0.10 * c; knees[1] -= 0.10 * c;
  knees[2] -= 0.30 * c; knees[3] -= 0.30 * c;
  const crouchDip = 0.72 * c;
  pitch += 0.075 * c;

  // En vol : regroupement des pattes à la montée, extension des antérieures
  // avant le contact au sol.
  const a = kit.air;
  const f = smoother(sat(0.5 - 0.9 * kit.vy / jump));
  const airHips = [
    lerp(0.82, 0.48, f), lerp(0.82, 0.48, f),
    lerp(-0.92, 0.38, f), lerp(-0.92, 0.38, f)
  ];
  const airKnees = [
    lerp(-1.38, -0.12, f), lerp(-1.38, -0.12, f),
    lerp(0.12, -0.78, f), lerp(0.12, -0.78, f)
  ];
  for (let i = 0; i < 4; i++) {
    hips[i] = lerp(hips[i], airHips[i], a);
    knees[i] = lerp(knees[i], airKnees[i], a);
  }
  pitch = lerp(pitch, lerp(0.34, -0.24, f), a);
  roll *= 1 - a;

  // Queue : haute et souple à la marche, alignée au galop, avec inertie en vol.
  const idle = 1 - moving;
  const flickT = (time * 0.19) % 1;
  const flick = idle * (1 - a) * 0.9 * Math.sin(TAU * 3 * flickT) * sat(1 - flickT * 6);
  const tail = {
    lift: lerp(
      lerp(0.27 + 0.07 * Math.sin(time * 0.7), lerp(0.96, 1.12, g), moving),
      0.82, a
    ),
    sway: lerp(0.18, lerp(0.20, 0.13, g), moving),
    flick
  };

  return {
    hips, knees,
    bodyY: bodyY - crouchDip,
    backFlex: backFlex * (1 - a) + 0.18 * a,
    pitch, roll, yaw, tail,
    headPitch, headRoll, headYaw,
    look: 1 - 0.72 * moving
  };
}

export { pose, strideLength };
