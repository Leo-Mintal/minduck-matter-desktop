import { FLOWS } from './flow-artwork.js';

export const FLOW_TIMING = {
  work: { enter: 1.35, hold: 3, sourceExit: 4.35, end: 5.85, seconds: 5.85 },
  ask: { enter: 1.35, hold: 3.15, sourceExit: 4.5, end: 6, seconds: 6 },
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
    root.style.display = 'none';
    petGroup.querySelector('[data-duck-art]').appendChild(root);
    return [kind, { root, source, animations: null, opacityTracks: [], duration: source.duration, visible: false }];
  }));
}

function prepare(flow) {
  if (flow.animations) return;
  const { root, source } = flow;
  // The old work export has 188 non-finite filter regions. This finite region
  // encloses every measured owner plus 4-sigma blur; preserve paths/primitives.
  root.innerHTML = source.svg.replace(/<filter\b[^>]*>/gi, filter => filter.replace(
    /\b(x|y|width|height)="-?(?:inf|nan)"/gi,
    (_, key) => `${key}="${key === 'x' || key === 'y' ? -64 : 192}"`));
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
  Object.assign(flow, { animations, opacityTracks });
}

export function drawFlows(flows, state) {
  let visible = false;
  for (const [kind, flow] of Object.entries(flows)) {
    const active = state.kind === kind;
    if (active) {
      prepare(flow);
      const t = state.sourceTime;
      visible = true;
      for (const animation of flow.animations) animation.currentTime = t * 1000;
      for (const track of flow.opacityTracks) {
        const value = opacityAt(track.frames, t / flow.duration);
        if (value !== track.value) {
          track.element.style.opacity = String(value);
          track.value = value;
        }
      }
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
  for (const flow of Object.values(flows ?? {})) {
    flow.animations?.forEach((animation) => animation.cancel());
  }
}
