import { ARTWORK } from './artwork.js';
import { mountFlows, drawFlows, disposeFlows } from './flow-player.js';
import { createFlowBody } from './flow-state.js';

// Source artwork is 99 × 108. The kit draws in a 256-unit square, with feet at y=256.
const ART_SCALE = 2.35;
const ART_FLOOR = 105.1;
const ART_X = 128 - 49.5 * ART_SCALE;
const ART_Y = 256 - ART_FLOOR * ART_SCALE;
const FOOT_REST_Y = 241;
const HIP_X = [104, 150];
const IDLE_HITS = [[129, 101, 61], [131, 176, 69], [44, 161, 25], [209, 161, 23]];
const FLOW_HITS = [...IDLE_HITS, [248, 155, 43]];
const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value) => Math.round(value * 1000) / 1000;
const rotate = (angle, x, y) => `rotate(${round(angle)} ${x} ${y})`;
const slide = (x, y) => `translate(${round(x)} ${round(y)})`;

function eyeTransform(eye, x, y, frame, index) {
  const shape = eye?.shape ?? 'ring';
  const shapes = { up: 0.36, down: 0.12, lid: 0.35, gt: 0.24, lt: 0.24 };
  const openness = shapes[shape] ?? clampValue((eye?.ry ?? 16) / 16, 0.2, 1.2);
  const close = Math.max(frame.blink ?? 0, frame.eyeClose ?? 0);
  const height = Math.max(0.055, openness * (1 - close));
  const angle = shape === 'up' ? (index === 0 ? -12 : 12) : 0;
  const dx = (frame.look?.[0] ?? 0) * 0.24;
  const dy = (frame.look?.[1] ?? 0) * 0.18;
  return `${slide(x + dx, y + dy)} rotate(${angle}) scale(1 ${round(height)}) ${slide(-x, -y)}`;
}

function animateFoot(node, frame, index) {
  const leg = frame.legs[index];
  const hip = index === 0 ? [35.5, 85.5] : [63.2, 90];
  const low = frame.low / ART_SCALE;
  const dx = (leg[2] - HIP_X[index]) / ART_SCALE;
  const dy = ART_FLOOR + (leg[3] - FOOT_REST_Y) / ART_SCALE - hip[1] - low;
  const length = Math.hypot(dx, dy);
  const angle = -Math.atan2(dx, Math.max(2, dy)) * 180 / Math.PI;
  const stretch = clampValue(length / (ART_FLOOR - hip[1]), 0.28, 1.4);
  node.setAttribute('transform', `${slide(hip[0], hip[1] + low)} rotate(${round(angle)})`
    + ` scale(1 ${round(stretch)}) ${slide(-hip[0], -hip[1])}`);
}

function wingPose(frame) {
  let front = Math.sin(frame.t * 2.4) * 2;
  let back = -front;
  if (frame.mode === 'walk' || frame.mode === 'run') {
    const pace = (frame.legs[0][2] - HIP_X[0]) * 0.7;
    front += pace;
    back -= pace;
    if (frame.mode === 'run') { front += 14; back -= 14; }
  }
  if (frame.mode === 'air') { front += 30; back -= 30; }
  if (frame.mode === 'drag') {
    front += 34 + Math.sin(frame.t * 15) * 13;
    back -= 34 + Math.sin(frame.t * 15 + 0.6) * 13;
  }
  const gesture = frame.gesture;
  if (gesture?.kind === 'flap') {
    const beat = Math.sin(gesture.k * Math.PI * 10);
    const strength = Math.sin(Math.PI * gesture.k);
    front += (25 + beat * 30) * strength;
    back -= (25 + beat * 30) * strength;
  }
  if (gesture?.kind === 'wave') {
    front += (44 + Math.sin(gesture.k * Math.PI * 8) * 19) * Math.sin(Math.PI * gesture.k);
  }
  return [front + frame.swing * 0.12, back - frame.swing * 0.12];
}

function mountFigure(petGroup) {
  petGroup.innerHTML = `<g data-duck-art transform="translate(${ART_X} ${ART_Y}) scale(${ART_SCALE})">`
    + '<g id="duck-idle">' + ARTWORK + '</g></g>';
  const part = (name) => petGroup.querySelector(`#duck-${name}`);
  const mouth = petGroup.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  for (const [key, value] of Object.entries({ cx: 59.7, cy: 53, rx: 7.6, ry: 0, fill: '#B43B08' })) {
    mouth.setAttribute(key, String(value));
  }
  part('beak').appendChild(mouth);
  return {
    body: part('body'), frontWing: part('wing-front'), backWing: part('wing-back'),
    frontFoot: part('foot-front'), backFoot: part('foot-back'), beak: part('beak'),
    crest: part('crest'), eyes: [part('eye-left'), part('eye-right')], mouth,
    idle: part('idle'), flows: mountFlows(petGroup),
  };
}

function animateFace(nodes, face, frame, low) {
  const centers = [[43.7, 35.8], [68.8, 35.2]];
  nodes.eyes.forEach((eye, index) => {
    const [x, y] = centers[index];
    eye.setAttribute('transform', `${slide(0, low)} ${eyeTransform(face.eyes?.[index], x, y, frame, index)}`);
  });
  const talk = clampValue(frame.talk ?? 0, 0, 1);
  nodes.beak.setAttribute('transform', `${slide(0, low)} translate(59.7 49.5)`
    + ` scale(${round(1 + talk * 0.035)} ${round(1 + talk * 0.13)}) translate(-59.7 -49.5)`);
  nodes.mouth.setAttribute('ry', String(round(talk * 2.1)));
  nodes.mouth.setAttribute('opacity', String(round(talk * 0.8)));
}

export function createDuckFigure(state = { kind: null, elapsed: 0, sourceTime: 0, holdTime: 0 }) {
  let nodes = null;
  return {
    extent: [16, 14, 244, 259],
    hits: IDLE_HITS,
    anchors: {
      gaze: [143, 93], tear: [178, 110], tears: [[114, 109], [177, 109]],
      z: [190, 30], hearts: [65, 196, 27], bubble: [128, 15],
    },
    colors: { z: '#DA9100' },
    draw(petGroup, face, frame) {
      if (!nodes) nodes = mountFigure(petGroup);
      const blend = drawFlows(nodes.flows, state);
      nodes.idle.setAttribute('opacity', String(1 - blend));
      this.extent = state.kind ? [12, 0, 300, 259] : [16, 14, 244, 259];
      this.hits = state.kind ? FLOW_HITS : IDLE_HITS;
      const low = frame.low / ART_SCALE;
      const [front, back] = wingPose(frame);
      nodes.body.setAttribute('transform', slide(0, low));
      nodes.frontWing.setAttribute('transform', `${slide(0, low)} ${rotate(front, 29, 59)}`);
      nodes.backWing.setAttribute('transform', `${slide(0, low)} ${rotate(back, 69, 58)}`);
      animateFoot(nodes.frontFoot, frame, 0);
      animateFoot(nodes.backFoot, frame, 1);
      animateFace(nodes, face, frame, low);
      const feather = Math.sin(frame.t * 3.1) * 3 + frame.swing * 0.28;
      nodes.crest.setAttribute('transform', `${slide(0, low)} ${rotate(feather, 53, 22)}`);
    },
    dispose() { disposeFlows(nodes?.flows); nodes = null; },
  };
}

export function createDuckBody(_base, { kit, host }) {
  const state = { kind: null, elapsed: 0, sourceTime: 0, holdTime: 0 };
  return createFlowBody(kit, host, createDuckFigure(state), state);
}
