import { FLOWS } from './flow-artwork.js';

export const FLOW_TIMING = {
  work: { enter: 1.35, hold: 3, sourceExit: 4.35, end: 5.85, seconds: 5.85 },
  ask: { enter: 1.35, hold: 3.15, sourceExit: 4.5, end: 6, seconds: 6 },
};
const smooth = (value) => {
  const k = Math.max(0, Math.min(1, value));
  return k * k * (3 - 2 * k);
};

function opacityAt(frames, progress) {
  let left = frames[0];
  for (let index = 1; index < frames.length; index++) {
    const right = frames[index];
    if (progress <= right.offset) {
      const k = Math.max(0, (progress - left.offset) / (right.offset - left.offset));
      return left.value + (right.value - left.value) * k;
    }
    left = right;
  }
  return left.value;
}

export function mountFlows(petGroup) {
  const doc = petGroup.ownerDocument;
  return Object.fromEntries(Object.entries(FLOWS).map(([kind, source]) => {
    const root = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    root.setAttribute('opacity', '0');
    root.setAttribute('data-flow', kind);
    root.innerHTML = source.svg;
    petGroup.querySelector('[data-duck-art]').appendChild(root);
    const animations = [];
    const opacityTracks = [];
    for (const { id, keyframes } of source.animations) {
      const element = root.querySelector(`#${id}`);
      // Exported pose layers use linear opacity switches; update only when their value changes.
      if (keyframes.every((frame) => frame.opacity != null && (!frame.easing || frame.easing === 'linear'))) {
        const frames = keyframes.map((frame) => ({ offset: frame.offset, value: Number(frame.opacity) }));
        element.style.opacity = String(frames[0].value);
        opacityTracks.push({ element, frames, value: frames[0].value });
        continue;
      }
      element.style.transformOrigin = '0 0';
      const animation = element.animate(keyframes, { duration: source.duration * 1000, fill: 'both' });
      animation.pause();
      animation.currentTime = 0;
      animations.push(animation);
    }
    return [kind, { root, animations, opacityTracks, duration: source.duration, visible: false }];
  }));
}

export function drawFlows(flows, state) {
  let blend = 0;
  for (const [kind, flow] of Object.entries(flows)) {
    const active = state.kind === kind;
    if (active) {
      const spec = FLOW_TIMING[kind];
      const t = state.sourceTime;
      blend = Math.min(smooth(t / 0.12), smooth((spec.end - t) / 0.12));
      for (const animation of flow.animations) animation.currentTime = t * 1000;
      for (const track of flow.opacityTracks) {
        const value = opacityAt(track.frames, t / flow.duration);
        if (value !== track.value) {
          track.element.style.opacity = String(value);
          track.value = value;
        }
      }
      flow.root.setAttribute('opacity', String(blend));
    } else if (flow.visible) {
      flow.root.setAttribute('opacity', '0');
    }
    flow.visible = active;
  }
  return blend;
}

export function disposeFlows(flows) {
  for (const flow of Object.values(flows ?? {})) {
    flow.animations.forEach((animation) => animation.cancel());
  }
}
