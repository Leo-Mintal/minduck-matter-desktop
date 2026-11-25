import { ARTWORK } from './artwork.js';
import { mountFlows, drawFlows, disposeFlows, gaitTime } from './flow-player.js';
import { createFlowBody } from './flow-state.js';

// Semantic base from the new idle drawing; source feet meet y=51.38756.
const SCALE = 4.67;
const FLOOR = 51.38756;
const HIPS = [[11.918, 39.4493], [27.241, 43.4293]];
const HIP_X = [104, 150];
const HITS = [[144, 90, 62], [132, 177, 68], [57, 163, 33], [205, 160, 30]];
const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const round = value => Math.round(value * 1000) / 1000;
const move = (x, y) => `translate(${round(x)} ${round(y)})`;
const turn = (angle, x, y) => `rotate(${round(angle)} ${x} ${y})`;
const transform = (node, value) => node.setAttribute('transform', value);

function mount(petGroup) {
  petGroup.innerHTML = `<g data-suit-art transform="translate(${128 - 23.00825 * SCALE} ${256 - FLOOR * SCALE}) scale(${SCALE})">`
    + `<g data-suit-base>${ARTWORK}</g></g>`;
  const part = name => petGroup.querySelector(`#suit-${name}`);
  return {
    uppers: [...petGroup.querySelectorAll('[data-upper]')], front: part('wing-front'), back: part('wing-back'),
    feet: [part('foot-front'), part('foot-back')],
    eyes: [[part('eye-left-glow'), part('eye-left')], [part('eye-right-glow'), part('eye-right')]],
    beak: part('beak'), crest: part('crest'), base: petGroup.querySelector('[data-suit-base]'),
    flows: mountFlows(petGroup.querySelector('[data-suit-art]')),
  };
}

function drawFeet(nodes, frame) {
  nodes.feet.forEach((foot, index) => {
    const [x, y] = HIPS[index];
    const leg = frame.legs[index];
    const dx = (leg[2] - HIP_X[index]) / SCALE;
    const dy = FLOOR + (leg[3] - 241 - frame.low) / SCALE - y;
    const angle = -Math.atan2(dx, Math.max(1, dy)) * 180 / Math.PI;
    const stretch = clamp(Math.hypot(dx, dy) / (FLOOR - y), .3, 1.5);
    transform(foot, `${move(x, y + frame.low / SCALE)} ${turn(angle, 0, 0)}`
      + ` scale(1 ${round(stretch)}) ${move(-x, -y)}`);
  });
}

function drawFace(nodes, face, frame) {
  const centers = [[5.43, 5.49], [18.4, 5.42]];
  nodes.eyes.forEach((eyes, index) => {
    const [x, y] = centers[index];
    const shapes = { up: .36, down: .12, lid: .35, gt: .24, lt: .24 };
    const open = shapes[face.eyes?.[index]?.shape] ?? 1;
    const height = Math.max(.055, open * (1 - Math.max(frame.blink ?? 0, frame.eyeClose ?? 0)));
    for (const eye of eyes) transform(eye, `${move(x + frame.look[0] * .18, y + frame.look[1] * .13 + frame.low / SCALE)}`
      + ` scale(1 ${round(height)}) ${move(-x, -y)}`);
  });
  transform(nodes.beak, `${move(29.1, 23.16 + frame.low / SCALE)}`
    + ` scale(1 ${round(1 + clamp(frame.talk ?? 0) * .15)}) ${move(-29.1, -23.16)}`);
}

function wingAngles(frame) {
  let front = Math.sin(frame.t * 2.4) * 2;
  let back = -front;
  if (frame.mode === 'walk' || frame.mode === 'run') {
    const stride = (frame.legs[0][2] - HIP_X[0]) * .5;
    front += stride; back -= stride;
  }
  if (frame.mode === 'air') { front += 28; back -= 22; }
  if (frame.mode === 'drag') {
    front += 35 + Math.sin(frame.t * 15) * 15;
    back -= 35 + Math.sin(frame.t * 15 + .6) * 15;
  }
  const gesture = frame.gesture;
  if (gesture?.kind === 'wave') front += 52 * Math.sin(gesture.k * Math.PI)
    + 16 * Math.sin(gesture.k * Math.PI * 8);
  if (gesture?.kind === 'flap') {
    const beat = (25 + Math.sin(gesture.k * Math.PI * 10) * 30) * Math.sin(gesture.k * Math.PI);
    front += beat; back -= beat;
  }
  return [front, back];
}

export function createSuitFigure(state) {
  let nodes;
  let idleStart = null;
  return {
    extent: [16, 12, 232, 259], hits: HITS,
    anchors: { gaze: [145, 86], tear: [177, 102], tears: [[112, 102], [177, 102]],
      z: [180, 15], hearts: [65, 190, 27], bubble: [128, 2] },
    colors: { z: '#E88A00' },
    draw(petGroup, face, frame) {
      nodes ??= mount(petGroup);
      const walking = !state.kind && (frame.mode === 'walk' || frame.mode === 'run');
      const idle = !state.kind && frame.mode === 'idle' && (!frame.face || frame.face === 'neutral')
        && !frame.gesture && !(frame.talk > .01) && !frame.status;
      idleStart = idle ? idleStart ?? frame.t : null;
      const kind = state.kind ?? (walking ? 'gait' : idle ? 'idle' : null);
      const time = state.kind ? state.sourceTime : walking ? gaitTime(frame.modeT, frame.mode === 'run') : frame.t - (idleStart ?? frame.t);
      const blend = drawFlows(nodes.flows, kind, time, idle || walking, frame.facing);
      if (nodes.covered !== Boolean(blend)) {
        nodes.base.style.display = blend ? 'none' : '';
        nodes.covered = Boolean(blend);
      }
      this.extent = state.kind ? [-50, -80, 360, 259] : [16, 12, 232, 259];
      this.hits = state.kind ? [...HITS, [250, 150, 42]] : HITS;
      // Complete source artwork owns this frame, including its original entrance/exit.
      if (blend) return;
      for (const upper of nodes.uppers) transform(upper, move(0, frame.low / SCALE));
      const [front, back] = wingAngles(frame);
      transform(nodes.front, `${move(0, frame.low / SCALE)} ${turn(front, 7, 22.84)}`);
      transform(nodes.back, `${move(0, frame.low / SCALE)} ${turn(back, 28.72, 22.84)}`);
      drawFeet(nodes, frame);
      drawFace(nodes, face, frame);
      transform(nodes.crest, `${move(0, frame.low / SCALE)} ${turn(Math.sin(frame.t * 3.1) * 2, 24, 6)}`);
    },
    dispose() { disposeFlows(nodes?.flows); nodes = null; },
  };
}

export function createSuitDuckBody(_base, { kit, host }) {
  const state = { kind: null, elapsed: 0, sourceTime: 0 };
  return createFlowBody(kit, host, createSuitFigure(state), state);
}
