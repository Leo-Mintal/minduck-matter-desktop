import { FLOWS } from './flow-artwork.js';

export const FLOW_TIMING = {
  work: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  write: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  ask: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  happy: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
  sad: { enter: 1.3504, sourceExit: 4.5, exitEnd: 6, seconds: 8 },
};
// Three complete measured strides, excluding the source's lead-in and final stop.
export const gaitTime = (seconds, run = false) => 1.35 + (seconds * (run ? 1.65 : 1)) % 3.3;

const DIRECTIONAL_SYMBOLS = {
  ask: '[id$="-Effects_Confirmation"]',
  happy: '[id$="-SuccessBadge"]',
  sad: '[id$="-FailureBadge"]',
};

export function opacityAt(frames, progress) {
  let left = frames[0];
  for (let index = 1; index < frames.length; index++) {
    const right = frames[index];
    if (progress + 1e-12 < right.offset) {
      const span = right.offset - left.offset;
      // The export uses 0.01% ramps to swap complete poses. Interpolating
      // these makes two translucent bodies and flashes on a refresh boundary.
      if (span <= .000100001) return Number(left.opacity);
      const k = Math.max(0, (progress - left.offset) / span);
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
    return [kind, { kind, root, source, symbol: null, mirrored: null, animations: null, opacityTracks: [], visible: false }];
  }));
}

function wrapDirectionalSymbol(flow) {
  const selector = DIRECTIONAL_SYMBOLS[flow.kind];
  const symbol = selector && flow.root.querySelector(selector);
  if (!symbol) return;
  const wrapper = flow.root.ownerDocument.createElementNS(flow.root.namespaceURI, 'g');
  wrapper.style.transformBox = 'fill-box';
  wrapper.style.transformOrigin = 'center';
  wrapper.append(...symbol.childNodes);
  symbol.appendChild(wrapper);
  flow.symbol = wrapper;
}

function prepare(flow) {
  if (flow.animations) return;
  flow.root.innerHTML = flow.source.svg;
  wrapDirectionalSymbol(flow);
  flow.animations = [];
  for (const track of flow.source.animations) {
    const element = flow.root.querySelector(`#${track.id}`);
    if (!element) throw new Error(`Missing Suit Duck animation target: ${track.id}`);
    // Pose switches need no browser animation object or per-frame write at rest.
    if (track.keyframes.every(frame => frame.opacity != null && (!frame.easing || frame.easing === 'linear'))) {
      flow.opacityTracks.push({ element, frames: track.keyframes, value: null });
    } else {
      // These transforms are authored around the SVG group's source origin.
      element.style.transformOrigin = '0 0';
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

export function drawFlows(flows, kind, time, loop = false, facing = 1) {
  let visible = false;
  for (const [name, flow] of Object.entries(flows)) {
    const active = name === kind;
    if (active) {
      const t = loop ? time % flow.source.duration : time;
      seekFlow(flow, t);
      const mirrored = facing < 0;
      if (flow.symbol && flow.mirrored !== mirrored) {
        flow.symbol.style.transform = mirrored ? 'scaleX(-1)' : '';
        flow.mirrored = mirrored;
      }
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
