import { FLOWS } from './flow-artwork.js';

export const FLOW_TIMING = {
  work: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  write: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  ask: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  happy: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  sad: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  think: { seconds: 8 },
  flag: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  carry: { enter: 1.9, sourceExit: 6.1, exitEnd: 7, seconds: 8 },
};
// Three complete measured strides, excluding the source's lead-in and final stop.
export const gaitTime = (seconds, run = false) => 1.35 + (seconds * (run ? 1.65 : 1)) % 3.3;

export function opacityAt(frames, progress) {
  let left = frames[0];
  for (let index = 1; index < frames.length; index++) {
    const right = frames[index];
    if (progress <= right.offset) {
      const k = Math.max(0, (progress - left.offset) / (right.offset - left.offset));
      return Number(left.opacity) + (Number(right.opacity) - Number(left.opacity)) * k;
    }
    left = right;
  }
  return Number(left.opacity);
}

export function mountFlows(art) {
  return Object.fromEntries(Object.entries(FLOWS).map(([kind, source]) => {
    const root = art.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    root.setAttribute('data-flow', kind);
    root.setAttribute('transform', source.transform);
    root.setAttribute('opacity', '0');
    root.style.display = 'none';
    art.appendChild(root);
    return [kind, { root, source, animations: null, opacityTracks: [], visible: false }];
  }));
}

function prepare(flow) {
  if (flow.animations) return;
  flow.root.innerHTML = flow.source.svg;
  flow.animations = [];
  for (const track of flow.source.animations) {
    const element = flow.root.querySelector(`#${track.id}`);
    if (!element) throw new Error(`Missing Suit Duck animation target: ${track.id}`);
    // Pose switches need no browser animation object or per-frame write at rest.
    if (track.keyframes.every(frame => frame.opacity != null && (!frame.easing || frame.easing === 'linear'))) {
      flow.opacityTracks.push({ element, frames: track.keyframes, value: null });
    } else {
      const animation = element.animate(track.keyframes, { duration: flow.source.duration * 1000, fill: 'both' });
      animation.pause();
      animation.currentTime = 0;
      flow.animations.push(animation);
    }
  }
}

export function seekFlow(flow, seconds) {
  prepare(flow);
  const time = Math.max(0, Math.min(flow.source.duration, seconds));
  for (const animation of flow.animations) animation.currentTime = time * 1000;
  for (const track of flow.opacityTracks) {
    const value = opacityAt(track.frames, time / flow.source.duration);
    if (value !== track.value) {
      track.element.style.opacity = String(value);
      track.value = value;
    }
  }
  flow.root.setAttribute('data-source-time', String(time));
}

export function drawFlows(flows, kind, time, loop = false) {
  let visible = false;
  for (const [name, flow] of Object.entries(flows)) {
    const active = name === kind;
    if (active) {
      const t = loop ? time % flow.source.duration : time;
      seekFlow(flow, t);
      visible = true;
    }
    if (flow.visible !== active) {
      flow.root.setAttribute('opacity', active ? '1' : '0');
      flow.root.style.display = active ? '' : 'none';
    }
    flow.visible = active;
  }
  return visible ? 1 : 0;
}

export function disposeFlows(flows) {
  for (const flow of Object.values(flows ?? {})) flow.animations?.forEach(animation => animation.cancel());
}
