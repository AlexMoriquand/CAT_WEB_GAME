// Point d'entrée : WebGL, interface, caméra orbitale et boucle d'affichage.
import { nextFrame, clamp, lerp, vnorm, vcross, vdot, vadd, vsub, vscale, rotX, rotY, rotZ, m3mul, m3v, m3t, rotFromTo, m4persp, m4ortho, m4look, m4mul } from './utils/math.js';
import { HEAD_C, HS, RH, HEAD_PIVOT, EYE, TAIL } from './kitten/shape.js';
import { C as CALICO } from './kitten/coat.js';
import { C as RED } from './kitten/coat-red.js';
import { pose, strideLength } from './kitten/gait.js';
import { COURSE } from './world/course.js';
import { FURNITURE, buildSofa } from './world/sofa.js';
const SOLIDS = [...COURSE, ...FURNITURE];                // tout ce sur quoi le chaton peut buter ou se poser
import { buildKitten } from './kitten/mesh.js';
import { buildKitten as buildRedKitten } from './kitten/mesh-red.js';
import { eyeData, buildWhiskers, strandTexture, AO_RECT, groundAO } from './kitten/details.js';
import { FUR_VS, FUR_FS, VOID_FS, GROUND_VS, GROUND_FS, EYE_VS, EYE_FS, WHISK_VS, WHISK_FS } from './render/shaders.js';

const $ = s => document.querySelector(s);
const canvas = $('#gl');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Rendu ---------- */
const loader = $('#loader');
const report = p => { $('#loader-bar').style.width = Math.round(p * 100) + '%'; };
const fail = msg => { loader.hidden = false; loader.classList.add('err'); $('#loader-txt').textContent = msg; };

const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
const NO_WEBGL = "Ce navigateur n'active pas WebGL 2 : le chaton ne peut pas s'afficher ici. Essaie avec Chrome, Edge ou Firefox à jour.";

function program(vs, fs) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}
function vao(attrs, idx) {
  const v = gl.createVertexArray(); gl.bindVertexArray(v);
  attrs.forEach(([data, size, type, norm], loc) => { gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, !!norm, 0, 0); });
  if (idx) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); }
  gl.bindVertexArray(null); return v;
}

const state = {
  cat: 'calico', shells: 32, auto: true,
  furLen: 1, fur: true,
  anim: !reduced, rot: false,
};
const HOME = { az: 150 * Math.PI / 180, el: 9 * Math.PI / 180, dist: 72 };
const cam = { az: HOME.az, el: HOME.el, dist: HOME.dist, vaz: 0, vel: 0 };
const TARGET = [-2.2, 9.2, 0];
const LIGHT = vnorm([0.735, 1.0, -0.272]);
// monde : étendue où le chaton peut aller, réglages des allures et du saut (le parcours est dans world/course.js)
const ARENA = 400;
const WALK = 64, RUN = 140, JUMP = 40, GRAVITY = 88, BODY_R = 6, PREP = 0.055;     // PREP : temps d'élan, ramassé, avant de décoller
const lin = c => c.map(v => Math.pow(v, 2.2));                                  // couleur d'écran -> couleur pour les calculs de lumière
// décor : ciel bleu clair, pelouse verte
const S = { bg: [0.75, 0.89, 0.97], grass: [0.36, 0.62, 0.24], light: [0.86, 0.82, 0.74], sky: [0.46, 0.50, 0.56], ground: [0.30, 0.37, 0.24] };

async function main() {
  report(0.02); await nextFrame();
  const strand = strandTexture();
  report(0.04); await nextFrame();
  const Kcalico = await buildKitten(p => report(0.04 + p * 0.38));
  report(0.44); $('#loader-txt').textContent = 'Modelage du chat roux'; await nextFrame();
  const Kred = await buildRedKitten(p => report(0.44 + p * 0.38));
  let K = Kcalico, C = CALICO;
  const whiskers = buildWhiskers();
  const gao = groundAO();
  report(0.97); $('#loader-txt').textContent = 'Fabrication du canapé'; await nextFrame();
  const sofaParts = buildSofa();
  await nextFrame();

  const pFur = program(FUR_VS, FUR_FS), pShadow = program(FUR_VS, VOID_FS), pGround = program(GROUND_VS, GROUND_FS), pEye = program(EYE_VS, EYE_FS), pWhisk = program(WHISK_VS, WHISK_FS), pBoxShadow = program(GROUND_VS, VOID_FS);
  const makeKittenVAO = mesh => vao([[mesh.pos, 3, gl.FLOAT], [mesh.nrm, 3, gl.FLOAT], [mesh.col, 4, gl.UNSIGNED_BYTE, 1], [mesh.fur, 4, gl.FLOAT], [mesh.wts, 4, gl.UNSIGNED_BYTE, 1], [mesh.leg, 4, gl.UNSIGNED_BYTE, 1]], mesh.idx);
  const vCalico = makeKittenVAO(Kcalico), vRed = makeKittenVAO(Kred);
  let vKitten = vCalico;
  const vWhisk = vao([[whiskers.pos, 3, gl.FLOAT], [whiskers.tan, 3, gl.FLOAT], [whiskers.su, 2, gl.FLOAT]], whiskers.idx);
  // globe oculaire : sphère unité
  const sp = [], si = [], SU = 40, SV = 28;
  for (let j = 0; j <= SV; j++) for (let i = 0; i <= SU; i++) { const th = j / SV * Math.PI, ph = i / SU * 2 * Math.PI; sp.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)); }
  for (let j = 0; j < SV; j++) for (let i = 0; i < SU; i++) { const a = j * (SU + 1) + i, b = a + SU + 1; si.push(a, a + 1, b, a + 1, b + 1, b); }
  const vEye = vao([[new Float32Array(sp), 3, gl.FLOAT]], new Uint16Array(si));
  // pelouse (très grande, elle se fond dans le ciel au loin) et bloc à franchir
  const boxMesh = (x0, x1, y0, y1, z0, z1) => {
    const p = [], n = [], ix = [];
    const face = (a, b, c, d, nn) => { const s = p.length / 3; p.push(...a, ...b, ...c, ...d); n.push(...nn, ...nn, ...nn, ...nn); ix.push(s, s + 1, s + 2, s, s + 2, s + 3); };
    face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
    face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
    face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    return { v: vao([[new Float32Array(p), 3, gl.FLOAT], [new Float32Array(n), 3, gl.FLOAT]], new Uint16Array(ix)), n: ix.length };
  };
  const lawn = boxMesh(-2400, 2400, -2, 0, -2400, 2400);
  gl.vertexAttrib1f(2, 1);                                   // les objets sans occlusion ambiante (boîtes, pelouse) valent 1
  // canapé, pouf, coussin, repose-pieds : un maillage par matière
  const sofa = sofaParts.map(m => ({ v: vao([[m.pos, 3, gl.FLOAT], [m.nrm, 3, gl.FLOAT], [m.ao, 1, gl.FLOAT]], m.idx), n: m.idx.length, col: lin(m.color), fabric: m.name !== 'wood' }));
  // plateformes : unies, sans texture, du gris-bleu en bas vers le terre cuite en haut
  const towers = COURSE.map((t, i) => {
    const k = i / (COURSE.length - 1);
    const col = [lerp(0.58, 0.80, k), lerp(0.62, 0.62, k), lerp(0.70, 0.56, k)];
    return { ...t, mesh: boxMesh(t.x - t.w, t.x + t.w, 0, t.h, t.z - t.d, t.z + t.d), col: lin(col) };
  });

  // textures
  const tStrand = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tStrand);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8, strand.S, strand.S, strand.S, 0, gl.RG, gl.UNSIGNED_BYTE, strand.data);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const SM = 2048, tShadow = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tShadow);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SM, SM, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tShadow, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const tAO = gl.createTexture(); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tAO);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gao.W, gao.H, 0, gl.RED, gl.UNSIGNED_BYTE, gao.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const eyes = [eyeData(1), eyeData(-1)];
  const HEAD_F = m3v(RH, 1, 0, 0);
  let lidCol = C.lid.map(c => Math.pow(c, 2.2)), rimCol = C.rim.map(c => Math.pow(c, 2.2));
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  /* ---- interface ---- */
  const body = document.body, panel = $('#panel');
  const el = { shells: $('#shells'), shellsOut: $('#shells-out'), auto: $('#auto'), len: $('#len'), lenOut: $('#len-out'), fur: $('#fur'), anim: $('#anim'), rot: $('#rot') };
  const syncUI = () => {
    document.querySelectorAll('input[name=cat]').forEach(r => { r.checked = r.value === state.cat; });
    el.shells.value = state.shells; el.shellsOut.textContent = state.shells; el.auto.checked = state.auto;
    el.len.value = Math.round(state.furLen * 100); el.lenOut.textContent = Math.round(state.furLen * 100) + ' %';
    el.fur.checked = state.fur; el.anim.checked = state.anim; el.rot.checked = state.rot;
  };
  document.querySelectorAll('input[name=cat]').forEach(r => r.addEventListener('change', () => {
    state.cat = r.value;
    K = state.cat === 'red' ? Kred : Kcalico;
    C = state.cat === 'red' ? RED : CALICO;
    vKitten = state.cat === 'red' ? vRed : vCalico;
    lidCol = C.lid.map(c => Math.pow(c, 2.2)); rimCol = C.rim.map(c => Math.pow(c, 2.2));
    syncUI(); touch();
  }));
  let dirty = true, lastInput = -1e9;
  const touch = () => { dirty = true; };
  el.shells.addEventListener('input', () => { state.shells = +el.shells.value; state.auto = false; syncUI(); touch(); });
  el.auto.addEventListener('change', () => { state.auto = el.auto.checked; });
  el.len.addEventListener('input', () => { state.furLen = el.len.value / 100; syncUI(); touch(); });
  el.fur.addEventListener('change', () => { state.fur = el.fur.checked; syncUI(); touch(); });
  el.anim.addEventListener('change', () => { state.anim = el.anim.checked; touch(); });
  el.rot.addEventListener('change', () => { state.rot = el.rot.checked; lastInput = -1e9; touch(); });
  $('#reset').addEventListener('click', () => { cam.az = HOME.az; cam.el = HOME.el; cam.dist = HOME.dist; cam.vaz = cam.vel = 0; lastInput = performance.now() / 1000; touch(); });

  /* ---- caméra orbitale : glisser, molette, pincement, clavier ---- */
  const ptrs = new Map(); let pinch = 0;
  const look = { x: 0, y: 0, tx: 0, ty: 0, last: -1e9 };
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0; lastInput = performance.now() / 1000; });
  canvas.addEventListener('pointermove', e => {
    const now = performance.now() / 1000;
    if (!ptrs.has(e.pointerId)) { look.tx = (e.clientX / innerWidth) * 2 - 1; look.ty = 1 - (e.clientY / innerHeight) * 2; look.last = now; return; }
    const p = ptrs.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1]; p[0] = e.clientX; p[1] = e.clientY; lastInput = now;
    if (ptrs.size === 1) { cam.vaz = -dx * 0.0065; cam.vel = dy * 0.0055; cam.az += cam.vaz; cam.el += cam.vel; }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) cam.dist *= pinch / d; pinch = d; }
    touch();
  });
  const up = e => { ptrs.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); lastInput = performance.now() / 1000; touch(); }, { passive: false });
  canvas.addEventListener('dblclick', () => $('#reset').click());
  canvas.addEventListener('keydown', e => {
    if (e.key === '+' || e.key === '=') cam.dist *= 0.92; else if (e.key === '-') cam.dist *= 1.08; else return;
    e.preventDefault(); touch();
  });

  /* ---- déplacements : ZQSD ou flèches pour marcher, Maj pour courir, Espace pour sauter (boutons à l'écran sur mobile) ---- */
  // e.code désigne la position physique de la touche : KeyW est le Z d'un clavier AZERTY, KeyA le Q.
  const KEYS = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'jump', ShiftLeft: 'run', ShiftRight: 'run' };
  const keys = { up: 0, down: 0, left: 0, right: 0, jump: 0, run: 0 };
  let jumpBuf = 0;                                          // une pression sur Saut reste valable un court instant, même si on est encore en l'air
  addEventListener('keydown', e => {
    const k = KEYS[e.code]; if (!k || (e.target.closest && e.target.closest('input,button,summary'))) return;
    if (k === 'jump' && !e.repeat) jumpBuf = 0.15;
    keys[k] = 1; e.preventDefault(); touch();
  });
  addEventListener('keyup', e => { const k = KEYS[e.code]; if (k) keys[k] = 0; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = 0; });
  // après un clic dans les réglages, on rend le clavier au chaton (sinon Espace cocherait la case ou cliquerait le bouton)
  $('#panel').addEventListener('pointerup', () => setTimeout(() => { const a = document.activeElement; if (a && a.closest('#panel') && a.type !== 'range') a.blur(); }, 0));
  document.querySelectorAll('.pad button').forEach(b => {
    if (b.dataset.key === 'run') { b.addEventListener('click', () => { keys.run = keys.run ? 0 : 1; b.setAttribute('aria-pressed', keys.run ? 'true' : 'false'); }); return; }   // « Courir » reste enfoncé
    const set = v => e => { e.preventDefault(); if (v && b.dataset.key === 'jump') jumpBuf = 0.15; keys[b.dataset.key] = v; touch(); };
    b.addEventListener('pointerdown', set(1)); b.addEventListener('pointerup', set(0)); b.addEventListener('pointercancel', set(0)); b.addEventListener('pointerleave', set(0));
  });
  // état du chaton dans le monde : position, cap, hauteur, vitesses
  const kit = { x: 0, y: 0, z: 0, yaw: 0, dx: 1, dz: 0, speed: 0, vy: 0, ground: true, on: -1, phase: 0, air: 0, crouch: 0, crouchV: 0, prep: 0, lean: 0 };

  const tgt = [TARGET[0], TARGET[1], TARGET[2]];
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fail('Le rendu 3D a été interrompu par le navigateur. Recharge la page pour retrouver le chaton.'); });

  /* ---- taille du canevas ---- */
  let pixelRatio = Math.min(devicePixelRatio || 1, 2), cw = 0, ch = 0;
  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * pixelRatio)), h = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
    if (w !== cw || h !== ch) { canvas.width = cw = w; canvas.height = ch = h; dirty = true; }
  };

  /* ---- boucle d'affichage ---- */
  let last = 0, ft = 16, ftClock = 0, blinkAt = 2.5, blink = 0, blinkDur = 0.17, frames = 0, animT = 0;
  syncUI();
  loader.hidden = true;

  function frame(ms) {
    requestAnimationFrame(frame);
    const t = ms / 1000, dt = Math.min(0.05, Math.max(0.001, t - last)); last = t;
    resize();
    const idle = t - lastInput > 3.5;
    if (ptrs.size === 0) {                                  // inertie puis rotation automatique
      if (Math.abs(cam.vaz) + Math.abs(cam.vel) > 1e-4) { cam.az += cam.vaz; cam.el += cam.vel; cam.vaz *= 0.90; cam.vel *= 0.90; dirty = true; }
      if (state.rot && idle) { cam.az += dt * 0.20; dirty = true; }
    }
    cam.el = clamp(cam.el, 0.03, 1.45); cam.dist = clamp(cam.dist, 26, 150);
    // physique du chaton : marche relative à la caméra, saut, gravité, collisions avec les piliers
    const mx = keys.right - keys.left, mz = keys.up - keys.down, fwx = -Math.sin(cam.az), fwz = -Math.cos(cam.az);
    if (mx || mz) {
      const ax = fwx * mz - fwz * mx, az = fwz * mz + fwx * mx, al = Math.hypot(ax, az);
      kit.dx = ax / al; kit.dz = az / al;
      let dy = Math.atan2(-kit.dz, kit.dx) - kit.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const turn = dy * (1 - Math.exp(-dt * 18));
      kit.yaw += turn; kit.lean += (clamp(turn / dt * 0.05, -0.16, 0.16) * kit.speed / RUN - kit.lean) * (1 - Math.exp(-dt * 16));   // il se penche dans les virages
    } else kit.lean *= Math.exp(-dt * 16);
    kit.speed += ((mx || mz ? (keys.run ? RUN : WALK) : 0) - kit.speed) * (1 - Math.exp(-dt * (keys.run ? 10 : 18)));
    // saut : d'abord il se ramasse un court instant, puis il se détend
    if (jumpBuf > 0 && kit.ground && kit.prep <= 0) { kit.prep = PREP; jumpBuf = 0; }
    jumpBuf = Math.max(0, jumpBuf - dt);
    if (kit.prep > 0) { kit.prep -= dt; if (!kit.ground) kit.prep = 0; else if (kit.prep <= 0) { kit.vy = JUMP; kit.ground = false; } }
    kit.x = clamp(kit.x + kit.dx * kit.speed * dt, -ARENA + 8, ARENA - 8); kit.z = clamp(kit.z + kit.dz * kit.speed * dt, -ARENA + 8, ARENA - 8);
    const cy = Math.cos(kit.yaw), sy = Math.sin(kit.yaw);
    {
      // plateformes et meubles : plus bas que leur dessus, on bute contre ; au-dessus, on peut s'y poser
      let floorY = 0, on = -1;
      for (let i = 0; i < SOLIDS.length; i++) {
        const tw = SOLIDS[i], bx = kit.x + 2 * cy, bz = kit.z - 2 * sy;    // centre du corps, un peu en avant de l'origine du modèle
        const nx = clamp(bx, tw.x - tw.w, tw.x + tw.w), nz = clamp(bz, tw.z - tw.d, tw.z + tw.d), ex = bx - nx, ez = bz - nz, d = Math.hypot(ex, ez);
        if (kit.y < tw.h - 0.4 && d < BODY_R) { if (d > 1e-4) { kit.x += ex / d * (BODY_R - d); kit.z += ez / d * (BODY_R - d); } }
        else if (d < 2.5 && kit.y >= tw.h - 0.4 && tw.h > floorY) { floorY = tw.h; on = i; }
      }
      kit.vy -= GRAVITY * dt; kit.y += kit.vy * dt;
      if (kit.y <= floorY) {
        if (!kit.ground) kit.crouchV += 22 * Math.min(1, -kit.vy / JUMP);     // réception : les pattes amortissent
        kit.y = floorY; kit.vy = 0; kit.ground = true; kit.on = on;
      } else kit.ground = false;
    }
    kit.phase += kit.speed * dt / strideLength(kit.speed, WALK, RUN);
    kit.air += ((kit.ground ? 0 : 1) - kit.air) * (1 - Math.exp(-dt * 28));
    // ressort amorti, calculé de façon implicite : il reste stable même quand l'image est saccadée
    const SPRING = 1040, DAMP = 64, goal = kit.prep > 0 ? 1 : 0;
    kit.crouchV = (kit.crouchV + dt * SPRING * (goal - kit.crouch)) / (1 + dt * DAMP + dt * dt * SPRING);
    kit.crouch = clamp(kit.crouch + kit.crouchV * dt, -0.3, 1.3);
    const active = kit.speed > 0.05 || !kit.ground || kit.air > 0.01 || kit.prep > 0 || Math.abs(kit.crouch) > 0.004 || Math.abs(kit.crouchV) > 0.02 || Math.abs(kit.lean) > 0.002;
    for (let i = 0; i < 3; i++) { const g = [kit.x - 2.2 * cy, TARGET[1] + kit.y, kit.z + 2.2 * sy][i]; if (Math.abs(g - tgt[i]) > 1e-3) { tgt[i] += (g - tgt[i]) * (1 - Math.exp(-dt * 12)); dirty = true; } }
    if (!dirty && !state.anim && !active) return;
    dirty = false;
    if (state.anim) animT += dt * 2;

    const asp = cw / ch;
    const fovy = asp > 1.25 ? 35 * Math.PI / 180 : 2 * Math.atan(Math.tan(17.5 * Math.PI / 180) * 1.25 / asp);
    const ce = Math.cos(cam.el), eyeW = [tgt[0] + cam.dist * ce * Math.sin(cam.az), tgt[1] + cam.dist * Math.sin(cam.el), tgt[2] + cam.dist * ce * Math.cos(cam.az)];
    const view = m4look(eyeW, tgt, [0, 1, 0]), VPw = m4mul(m4persp(fovy, asp, 2, 3200), view);
    // Le chaton est dessiné dans son propre repère : on y ramène la caméra et la lumière plutôt que de transformer chaque sommet.
    const gait = pose(kit, animT, WALK, RUN, JUMP);              // allure : angles des pattes, attitude du corps, tenue de la queue
    // matrice du chaton : cap, puis tangage et roulis autour du milieu du corps (pivot à 8,5 de haut)
    const Ry = rotY(kit.yaw + gait.yaw), Rb = m3mul(rotZ(gait.pitch), rotX(gait.roll + kit.lean)), R = m3mul(Ry, Rb), Rt = m3t(R);
    const pv = m3v(Rb, 0, 8.5, 0), off = m3v(Ry, -pv[0], 8.5 - pv[1], -pv[2]), T = [kit.x + off[0], kit.y + gait.bodyY + off[1], kit.z + off[2]];
    const M = new Float32Array([R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, T[0], T[1], T[2], 1]);
    const toL = v => m3v(Rt, v[0], v[1], v[2]);
    // repère « à plat » du chaton (cap seul) : sert à poser son ombre de contact sur le sol
    const kInv = new Float32Array([cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, -(cy * kit.x - sy * kit.z), -kit.y, -(sy * kit.x + cy * kit.z), 1]);
    const lc = [kit.x, kit.y + 8, kit.z], lightVPw = m4mul(m4ortho(-70, 70, -60, 60, 1, 280), m4look(vadd(lc, vscale(LIGHT, 130)), lc, [0, 1, 0]));
    const VP = m4mul(VPw, M), lightVP = m4mul(lightVPw, M), LIGHT_L = toL(LIGHT);
    const eye = toL(vsub(eyeW, T));
    const right = toL([view[0], view[4], view[8]]), upv = toL([view[1], view[5], view[9]]);

    // animation : la tête suit le curseur (ou flâne), la queue ondule, le chaton respire et cligne des yeux
    let Rd = I3, tailA = [0, 0, 0], tailPose = [gait.tail.lift, 0], breath = 0;
    if (state.anim) {
      if (t - look.last > 3) { look.tx = 0.55 * Math.sin(animT * 0.31); look.ty = 0.35 * Math.sin(animT * 0.47 + 1); }
      const k = 1 - Math.exp(-dt * 5); look.x += (look.tx - look.x) * k; look.y += (look.ty - look.y) * k;
      const lookRot = rotFromTo(HEAD_F, vnorm(vadd(HEAD_F, vadd(vscale(right, look.x * 0.36 * gait.look), vscale(upv, look.y * 0.24 * gait.look)))));
      // Le regard reste orienté vers l'avant pendant la marche ; on superpose
      // seulement les micro-ajustements mesurés de tangage/roulis/lacet de la tête.
      const headGait = m3mul(rotY(gait.headYaw || 0), m3mul(rotZ(gait.headPitch || 0), rotX(gait.headRoll || 0)));
      Rd = m3mul(headGait, lookRot);
      tailA = [gait.tail.sway, animT * 1.6, 1.35]; tailPose = [gait.tail.lift, gait.tail.flick]; breath = 0.05 * Math.sin(animT * 2.3) + gait.backFlex;
      if (animT > blinkAt) { blink = 0.0001; blinkDur = Math.random() < 0.2 ? 0.9 : 0.17; blinkAt = animT + 2.2 + 3.5 * Math.random(); }   // parfois un clignement lent, le « bisou de chat »
      if (blink > 0) { blink += dt / blinkDur; if (blink >= 1) blink = 0; }
    } else blink = 0;
    const lidClose = blink > 0 ? Math.sin(Math.PI * blink) : 0;
    const headRot = new Float32Array(m3t(Rd));
    const xf = p => vadd(m3v(Rd, p[0] - HEAD_PIVOT[0], p[1] - HEAD_PIVOT[1], p[2] - HEAD_PIVOT[2]), HEAD_PIVOT);
    const rv = v => m3v(Rd, v[0], v[1], v[2]);

    const common = (P, vp) => {
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uVP, false, vp); gl.uniformMatrix4fv(P.u.uLightVP, false, lightVP);
      gl.uniform3fv(P.u.uCam, eye); gl.uniform3fv(P.u.uLightDir, LIGHT_L); gl.uniform4fv(P.u.uLegs, gait.hips); gl.uniform4fv(P.u.uKnees, gait.knees); gl.uniform2fv(P.u.uTailPose, tailPose); gl.uniform3fv(P.u.uLightCol, S.light); gl.uniform3fv(P.u.uSky, S.sky); gl.uniform3fv(P.u.uGround, S.ground);
      gl.uniformMatrix3fv(P.u.uHeadRot, false, headRot); gl.uniform3fv(P.u.uHeadPivot, HEAD_PIVOT); gl.uniform3fv(P.u.uTailPivot, TAIL.P0); gl.uniform3fv(P.u.uTailAnim, tailA); gl.uniform1f(P.u.uBreath, breath); gl.uniform1f(P.u.uNeckFlex, state.anim ? clamp(0.46 * gait.pitch + 0.12 * gait.backFlex, -0.28, 0.28) : 0.0);
      gl.uniform1f(P.u.uFurLen, state.furLen); gl.uniform1f(P.u.uDroop, 0.24); gl.uniform1f(P.u.uDensity, 16.0);
      gl.uniform1i(P.u.uStrand, 0); gl.uniform1i(P.u.uShadow, 1); gl.uniform1i(P.u.uAO, 2);
    };

    // 1. carte d'ombres vue depuis la lumière
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, SM, SM);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    common(pShadow, lightVP); gl.uniform1f(pShadow.u.uFixedH, state.fur ? 0.7 : 0);
    gl.bindVertexArray(vKitten); gl.drawElements(gl.TRIANGLES, K.idx.length, gl.UNSIGNED_INT, 0);
    gl.useProgram(pBoxShadow.p); gl.uniformMatrix4fv(pBoxShadow.u.uVP, false, lightVPw);
    for (const tw of towers) { gl.bindVertexArray(tw.mesh.v); gl.drawElements(gl.TRIANGLES, tw.mesh.n, gl.UNSIGNED_SHORT, 0); }
    for (const m of sofa) { gl.bindVertexArray(m.v); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0); }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // 2. image
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch);
    gl.clearColor(S.bg[0], S.bg[1], S.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    common(pGround, VPw); gl.uniformMatrix4fv(pGround.u.uLightVP, false, lightVPw); gl.uniform3fv(pGround.u.uCam, eyeW); gl.uniform3fv(pGround.u.uLightDir, LIGHT);
    gl.uniform4fv(pGround.u.uAORect, AO_RECT); gl.uniformMatrix4fv(pGround.u.uKInv, false, kInv); gl.uniform3fv(pGround.u.uFog, lin(S.bg));
    gl.uniform1f(pGround.u.uFabric, 0); gl.uniform1f(pGround.u.uGrass, 1); gl.uniform3fv(pGround.u.uColor, lin(S.grass)); gl.bindVertexArray(lawn.v); gl.drawElements(gl.TRIANGLES, lawn.n, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(pGround.u.uGrass, 0);
    for (const tw of towers) { gl.uniform3fv(pGround.u.uColor, tw.col); gl.bindVertexArray(tw.mesh.v); gl.drawElements(gl.TRIANGLES, tw.mesh.n, gl.UNSIGNED_SHORT, 0); }
    for (const m of sofa) { gl.uniform1f(pGround.u.uFabric, m.fabric ? 1 : 0); gl.uniform3fv(pGround.u.uColor, m.col); gl.bindVertexArray(m.v); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0); }
    gl.uniform1f(pGround.u.uFabric, 0);

    common(pFur, VP); gl.uniform1f(pFur.u.uFixedH, 0); gl.uniform1f(pFur.u.uClay, state.fur ? 0 : 1);
    gl.bindVertexArray(vKitten); gl.drawElements(gl.TRIANGLES, K.idx.length, gl.UNSIGNED_INT, 0);          // peau et sous-poil

    const toCam = vnorm(vsub(eye, xf(HEAD_C))), hf = rv(HEAD_F);
    let gd = vnorm(vadd(vscale(hf, 0.55), vscale(toCam, 0.45)));                                          // le regard est attiré par la caméra
    const cg = vdot(gd, hf); if (cg < 0.914) { const pp = vnorm(vsub(gd, vscale(hf, cg))); gd = vnorm(vadd(vscale(hf, 0.914), vscale(pp, 0.406))); }
    const Rg = rotFromTo(hf, gd);
    const bdir = vnorm(vadd(vadd(vscale(right, -0.40), vscale(upv, 0.40)), vscale(toCam, 0.82))), bx = vnorm(vcross([0, 1, 0], bdir)), by = vcross(bdir, bx);
    common(pEye, VP); gl.uniform3fv(pEye.u.uLidCol, lidCol); gl.uniform3fv(pEye.u.uRimCol, rimCol); gl.uniform3fv(pEye.u.uBoxDir, bdir); gl.uniform3fv(pEye.u.uBoxX, bx); gl.uniform3fv(pEye.u.uBoxY, by);
    gl.bindVertexArray(vEye);
    for (const E of eyes) {
      const c = xf(E.c), f = rv(E.f), u = rv(E.u);
      const g = m3v(Rg, f[0], f[1], f[2]);
      const gr = vnorm(vcross(u, g)), gu = vcross(g, gr);
      const a = lerp(EYE.au, EYE.al + 0.03, lidClose);
      gl.uniform3fv(pEye.u.uCenter, c); gl.uniform3fv(pEye.u.uGaze, g); gl.uniform3fv(pEye.u.uGR, gr); gl.uniform3fv(pEye.u.uGU, gu);
      gl.uniform3fv(pEye.u.uLidU, vsub(vscale(u, Math.cos(a)), vscale(f, Math.sin(a))));
      gl.uniform3fv(pEye.u.uLidU0, vsub(vscale(u, Math.cos(EYE.au)), vscale(f, Math.sin(EYE.au))));
      gl.uniform3fv(pEye.u.uLidL, vscale(vsub(vscale(u, Math.cos(EYE.al)), vscale(f, Math.sin(EYE.al))), -1));
      gl.uniform1f(pEye.u.uLid, 0); gl.uniform1f(pEye.u.uRadius, EYE.r * HS); gl.drawElements(gl.TRIANGLES, si.length, gl.UNSIGNED_SHORT, 0);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.uniform1f(pEye.u.uLid, 1); gl.uniform1f(pEye.u.uRadius, (EYE.rl + 0.035) * HS); gl.drawElements(gl.TRIANGLES, si.length, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    }

    if (state.fur) {                                         // les couches de poils, de la plus extérieure à la plus proche de la peau
      common(pFur, VP); gl.uniform1f(pFur.u.uFixedH, -1); gl.uniform1f(pFur.u.uShells, state.shells); gl.uniform1f(pFur.u.uClay, 0);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(vKitten); gl.drawElementsInstanced(gl.TRIANGLES, K.idx.length, gl.UNSIGNED_INT, 0, state.shells);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    }
    // moustaches
    gl.useProgram(pWhisk.p); gl.uniformMatrix4fv(pWhisk.u.uVP, false, VP); gl.uniform3fv(pWhisk.u.uCam, eye); gl.uniform3fv(pWhisk.u.uHeadPivot, HEAD_PIVOT); gl.uniformMatrix3fv(pWhisk.u.uHeadRot, false, headRot);
    gl.uniform1f(pWhisk.u.uWidth, Math.max(0.022, cam.dist * 0.00062));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(vWhisk); gl.drawElements(gl.TRIANGLES, whiskers.idx.length, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);

    // 3. qualité automatique : on garde une image fluide
    frames++; ft += (dt * 1000 - ft) * 0.1;
    if (state.auto && state.fur && t - ftClock > 0.8 && frames > 20) {
      ftClock = t;
      if (ft > 30 && state.shells > 12) { state.shells = Math.max(12, state.shells - 8); syncUI(); }
      else if (ft > 30 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.5); }
      else if (ft < 17.5 && state.shells < 64) { state.shells += 4; syncUI(); }
    }
  }
  addEventListener('resize', touch);
  requestAnimationFrame(frame);
}
if (!gl) fail(NO_WEBGL);
else main().catch(e => { console.error(e); fail("Le chaton n'a pas pu être construit : " + e.message); });
