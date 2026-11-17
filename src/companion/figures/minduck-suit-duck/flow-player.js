import { FLOWS } from './flow-artwork.js';

export const FLOW_TIMING = {
  work: { enter: 1.35, sourceExit: 4.5, seconds: 6 },
  ask: { enter: 1.35, sourceExit: 4.5, seconds: 6 },
  happy: { seconds: 3 },
  sad: { seconds: 2.6 },
};
const smooth = value => { const k = Math.max(0, Math.min(1, value)); return k * k * (3 - 2 * k); };

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
  let blend = 0;
  for (const [name, flow] of Object.entries(flows)) {
    const active = name === kind;
    if (active) {
      const t = loop ? time % flow.source.duration : time;
      seekFlow(flow, t);
      blend = loop ? smooth(time / .12)
        : Math.min(smooth(t / .12), smooth((flow.source.duration - t) / .12));
      flow.root.setAttribute('opacity', String(blend));
      flow.root.style.display = '';
    } else if (flow.visible) {
      flow.root.style.display = 'none';
    }
    flow.visible = active;
  }
  return blend;
}

export function disposeFlows(flows) {
  for (const flow of Object.values(flows ?? {})) flow.animations?.forEach(animation => animation.cancel());
}
