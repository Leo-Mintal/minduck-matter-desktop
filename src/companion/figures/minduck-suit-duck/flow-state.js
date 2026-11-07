import { FLOW_TIMING } from './flow-player.js';

const TIME_EPSILON = 1e-9;
const MOTIONS = new Set([
  'stand', 'jump', 'hop', 'look', 'turn', 'nod', 'shake', 'spin', 'sit', 'sleep', 'dizzy',
  'walk', 'run', 'wave', 'bow', 'shiver', 'flap', 'dance',
]);

export function createFlowBody(kit, host, figure, state) {
  const words = Object.fromEntries(Object.entries(FLOW_TIMING)
    .map(([word, spec]) => [word, { motion: { seconds: spec.seconds, face: 'neutral' } }]));
  const body = kit.createBody(host, { figure, words });
  let pending = null;
  let exiting = false;
  function clear() {
    state.kind = null;
    state.elapsed = state.sourceTime = state.holdTime = 0;
    exiting = false;
  }
  function afterFlow(action) {
    if (body.layout().busy) return false;
    if (!state.kind) return action();
    pending = action;
    if (!exiting && state.sourceTime >= FLOW_TIMING[state.kind].enter - TIME_EPSILON) {
      state.sourceTime = Math.max(state.sourceTime, FLOW_TIMING[state.kind].sourceExit);
    }
    exiting = true;
    return true;
  }
  function start(word) {
    if (body.layout().busy) return false;
    if (state.kind === word && !exiting) { pending = null; return true; }
    if (state.kind) return afterFlow(() => start(word));
    body.stopWalk();
    body.do('stand');
    body.do(word);
    state.kind = word;
    state.elapsed = state.sourceTime = state.holdTime = 0;
    return true;
  }
  function advance(dt) {
    const spec = FLOW_TIMING[state.kind];
    if (exiting) {
      const reverse = state.sourceTime < spec.enter - TIME_EPSILON;
      state.sourceTime += reverse ? -dt : dt;
      return reverse ? state.sourceTime <= TIME_EPSILON : state.sourceTime >= spec.end - TIME_EPSILON;
    }
    state.elapsed += dt;
    state.holdTime = Math.max(0, Math.min(spec.hold, state.elapsed - spec.enter));
    if (state.elapsed < spec.enter - TIME_EPSILON) state.sourceTime = state.elapsed;
    else if (state.elapsed < spec.enter + spec.hold - TIME_EPSILON) {
      state.sourceTime = spec.enter + state.holdTime / spec.hold * (spec.sourceExit - spec.enter);
    } else state.sourceTime = spec.sourceExit + state.elapsed - spec.enter - spec.hold;
    return state.elapsed >= spec.seconds - TIME_EPSILON;
  }
  return {
    ...body,
    do(word) {
      if (Object.hasOwn(FLOW_TIMING, word)) return start(word);
      if (!body.words.includes(word)) return false;
      return MOTIONS.has(word) ? afterFlow(() => body.do(word)) : body.do(word);
    },
    step(dt) {
      if (!(dt > 0 && Number.isFinite(dt))) return;
      if (state.kind) {
        body.set({ hold: 2 });
        if (advance(dt)) {
          const word = state.kind;
          clear();
          host.emit?.('done', { word });
          const action = pending;
          pending = null;
          action?.();
        }
      }
      body.step(dt);
    },
    layout() {
      const layout = body.layout();
      const spec = FLOW_TIMING[state.kind];
      let phase = null;
      if (spec) phase = exiting || state.sourceTime >= spec.sourceExit - TIME_EPSILON ? 'stowing'
        : state.sourceTime < spec.enter - TIME_EPSILON ? 'pulling' : state.kind === 'work' ? 'typing' : 'waiting';
      return {
        ...layout, work: state.kind === 'work' ? phase : null, ask: state.kind === 'ask' ? phase : null,
        moving: layout.moving || state.kind !== null,
      };
    },
    walk(x, run, id) {
      return Number.isFinite(x) && afterFlow(() => body.walk(x, run, id));
    },
    stopWalk(id) { pending = null; body.stopWalk(id); },
    pointer(type, point) {
      body.pointer(type, point);
      if (type === 'down' && body.layout().pressing) { clear(); pending = null; }
    },
    drop(point) { clear(); pending = null; body.drop(point); },
    dispose() { clear(); pending = null; body.dispose(); },
  };
}
