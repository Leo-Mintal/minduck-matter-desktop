import { ARTWORK } from './artwork.js';
import { FLOW_TIMING } from './flow-player.js';
import { createFlowBody } from './flow-state.js';

const SCALE = 4.7;
const FLOOR = 51.39;
const HIP_X = [104, 150];
const HIPS = [[16.6, 43.8], [30.95, 43.43]];
const HITS = [[144, 90, 62], [132, 177, 68], [57, 163, 33], [205, 160, 30]];
const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const smooth = (value) => { const k = clamp(value); return k * k * (3 - 2 * k); };
const round = (value) => Math.round(value * 1000) / 1000;
const move = (x, y) => `translate(${round(x)} ${round(y)})`;
const turn = (angle, x, y) => `rotate(${round(angle)} ${x} ${y})`;
const transform = (node, value) => node.setAttribute('transform', value);
const opacity = (node, value) => node.setAttribute('opacity', String(round(value)));

function mount(petGroup) {
  petGroup.innerHTML = `<g data-suit-art transform="translate(${128 - 23.5 * SCALE} ${256 - FLOOR * SCALE})`
    + ` scale(${SCALE})">${ARTWORK}</g>`;
  const part = (name) => petGroup.querySelector(`#suit-${name}`);
  const mouth = petGroup.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  for (const [key, value] of Object.entries({ cx: 29.1, cy: 25.5, rx: 4, ry: 0, fill: '#B43B08' })) {
    mouth.setAttribute(key, String(value));
  }
  part('beak').appendChild(mouth);
  return {
    uppers: [...petGroup.querySelectorAll('[data-upper]')], front: part('wing-front'), back: part('wing-back'),
    feet: [part('foot-front'), part('foot-back')], eyes: [[part('eye-left-glow'), part('eye-left')], [part('eye-right-glow'), part('eye-right')]],
    beak: part('beak'), mouth, laptop: part('laptop'), paper: part('paper'),
    pen: part('pen'), marks: part('marks'),
  };
}

function drawFeet(nodes, frame, work) {
  nodes.feet.forEach((foot, index) => {
    const [x, y] = HIPS[index];
    const leg = frame.legs[index];
    const dx = (leg[2] - HIP_X[index]) / SCALE + (index ? 2 : -2) * work;
    const dy = FLOOR + (leg[3] - 241) / SCALE - y - frame.low / SCALE;
    const angle = -Math.atan2(dx, Math.max(1, dy)) * 180 / Math.PI;
    const stretch = clamp(Math.hypot(dx, dy) / (FLOOR - y), 0.3, 1.5);
    transform(foot, `${move(x, y + frame.low / SCALE)} ${turn(angle, 0, 0)}`
      + ` scale(1 ${round(stretch)}) ${move(-x, -y)}`);
  });
}

function drawFace(nodes, face, frame, work) {
  const centers = [[20.85, 15.02], [33.82, 14.95]];
  nodes.eyes.forEach((eyes, index) => {
    const [x, y] = centers[index];
    const shapes = { up: 0.36, down: 0.12, lid: 0.35, gt: 0.24, lt: 0.24 };
    const open = shapes[face.eyes?.[index]?.shape] ?? 1;
    const height = Math.max(0.055, open * (1 - Math.max(frame.blink ?? 0, frame.eyeClose ?? 0)));
    for (const eye of eyes) transform(eye, `${move(x + frame.look[0] * 0.12, y + frame.look[1] * 0.09 + work * 0.5)}`
      + ` scale(1 ${round(height)}) ${move(-x, -y)}`);
  });
  const talk = clamp(frame.talk ?? 0);
  transform(nodes.beak, `${move(29.1, 24.5)} scale(1 ${round(1 + talk * 0.15)}) ${move(-29.1, -24.5)}`);
  nodes.mouth.setAttribute('ry', String(round(talk * 1.05)));
  opacity(nodes.mouth, talk * 0.8);
}

function wingAngles(frame) {
  let front = Math.sin(frame.t * 2.4) * 2;
  let back = -front;
  if (frame.mode === 'walk' || frame.mode === 'run') {
    const stride = (frame.legs[0][2] - HIP_X[0]) * 0.5;
    front += stride; back -= stride;
  }
  if (frame.mode === 'air') { front += 28; back -= 22; }
  if (frame.mode === 'drag') {
    front += 35 + Math.sin(frame.t * 15) * 15;
    back -= 35 + Math.sin(frame.t * 15 + 0.6) * 15;
  }
  const gesture = frame.gesture;
  if (gesture?.kind === 'wave') front += 52 * Math.sin(gesture.k * Math.PI)
    + 16 * Math.sin(gesture.k * Math.PI * 8);
  if (gesture?.kind === 'flap') {
    const beat = (25 + Math.sin(gesture.k * Math.PI * 10) * 30) * Math.sin(Math.PI * gesture.k);
    front += beat; back -= beat;
  }
  return [front, back];
}

function drawProps(nodes, state) {
  const spec = FLOW_TIMING[state.kind];
  const t = state.sourceTime;
  const k = spec ? Math.min(smooth((t - 0.25) / 1.1), smooth((spec.end - t) / 1.5)) : 0;
  const work = state.kind === 'work' ? k : 0;
  const ask = state.kind === 'ask' ? k : 0;
  const typing = work * Math.sin(Math.max(0, t - 1.35) * Math.PI * 8);
  opacity(nodes.laptop, work);
  transform(nodes.laptop, `${move(12, 30 + (1 - work) * 14)} scale(${round(0.9 * work)})`);
  opacity(nodes.paper, ask);
  transform(nodes.paper, `${move(34, 31 + (1 - ask) * 14)} scale(${round(-0.95 * ask)} ${round(ask)})`);
  opacity(nodes.pen, ask);
  transform(nodes.pen, `${move(0, (1 - ask) * 17)} ${turn(Math.sin(t * 3) * 2 * ask, 41, 32)}`);
  opacity(nodes.marks, smooth((ask - 0.6) / 0.4));
  transform(nodes.marks, move(0, Math.sin(t * 2.4) * 0.5 * ask));
  return { work, ask, typing };
}

export function createSuitFigure(state) {
  let nodes;
  return {
    extent: [16, 12, 232, 259], hits: HITS,
    anchors: { gaze: [145, 86], tear: [177, 102], tears: [[112, 102], [177, 102]],
      z: [180, 15], hearts: [65, 190, 27], bubble: [128, 2] },
    colors: { z: '#E88A00' },
    draw(petGroup, face, frame) {
      nodes ??= mount(petGroup);
      const { work, ask, typing } = drawProps(nodes, state);
      const [front, back] = wingAngles(frame);
      for (const upper of nodes.uppers) transform(upper, `${move(work * 0.8, frame.low / SCALE + typing * 0.08)}`
        + ` ${turn(work * 7, 22, 47)}`);
      // The sleeve and hand share the source shoulder: rotate there instead of translating the arm off it.
      const frontTransform = `${move(ask * 9, -ask * 1.5)}`
        + ` ${turn(front * (1 - Math.max(work, ask)) - work * 70 - ask * 25 + typing * 3, 13.5, 27)}`;
      transform(nodes.front, frontTransform);
      transform(nodes.back, `${move(-work * 1.5, -typing * 0.3)}`
        + ` ${turn(back * (1 - Math.max(work, ask)) + work * 32 - ask * 20 - typing * 3, 35.5, 26)}`);
      drawFeet(nodes, frame, work);
      drawFace(nodes, face, frame, work);
      this.extent = state.kind ? [16, 4, 290, 259] : [16, 12, 232, 259];
      this.hits = state.kind ? [...HITS, [232, 167, 35]] : HITS;
    },
    dispose() { nodes = null; },
  };
}

export function createSuitDuckBody(_base, { kit, host }) {
  const state = { kind: null, elapsed: 0, sourceTime: 0, holdTime: 0 };
  return createFlowBody(kit, host, createSuitFigure(state), state);
}
