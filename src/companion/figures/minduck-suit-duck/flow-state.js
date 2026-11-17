import { FLOW_TIMING } from './flow-player.js';

const TIME_EPSILON = 1e-9;
export function createFlowBody(kit, host, figure, state) {
  const words = Object.fromEntries(Object.entries(FLOW_TIMING)
    .map(([word, spec]) => [word, { motion: { seconds: spec.seconds, face: 'neutral' } }]));
  const body = kit.createBody(host, { figure, words });
  let pending = null;
  let exiting = false;
  function clear() {
    state.kind = null;
    state.elapsed = state.sourceTime = 0;
    exiting = false;
  }
  function afterFlow(action) {
    if (body.layout().busy) return false;
    if (!state.kind) return action();
    const spec = FLOW_TIMING[state.kind];
    if (spec.enter == null) { clear(); body.do('stand'); return action(); }
    pending = action;
    if (!exiting && state.sourceTime >= spec.enter - TIME_EPSILON) {
      state.sourceTime = Math.max(state.sourceTime, spec.sourceExit);
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
    // The pack owns flow completion. A kit pulse would survive early stow/drag cancellation.
    state.kind = word;
    state.elapsed = state.sourceTime = 0;
    return true;
  }
  function advance(dt) {
    const spec = FLOW_TIMING[state.kind];
    if (exiting) {
      const reverse = state.sourceTime < spec.enter - TIME_EPSILON;
      state.sourceTime += reverse ? -dt : dt;
      return reverse ? state.sourceTime <= TIME_EPSILON : state.sourceTime >= spec.seconds - TIME_EPSILON;
    }
    state.elapsed += dt;
    state.sourceTime = Math.min(spec.seconds, state.elapsed);
    return state.elapsed >= spec.seconds - TIME_EPSILON;
  }
  return {
    ...body,
    do(word) {
      if (Object.hasOwn(FLOW_TIMING, word)) return start(word);
      if (!body.words.includes(word)) return false;
      return afterFlow(() => body.do(word));
    },
    step(dt) {
      if (!(dt > 0 && Number.isFinite(dt))) return;
      if (state.kind) {
        body.set({ hold: 2 });
        if (advance(dt)) {
          const word = state.kind;
          clear();
          body.do('stand');
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
      if (spec?.enter != null) phase = exiting || state.sourceTime >= spec.sourceExit - TIME_EPSILON ? 'stowing'
        : state.sourceTime < spec.enter - TIME_EPSILON ? 'pulling' : state.kind === 'work' ? 'typing' : 'waiting';
      return {
        ...layout, work: state.kind === 'work' ? phase : null, ask: state.kind === 'ask' ? phase : null,
        gesture: state.kind ?? layout.gesture,
        moving: layout.moving || state.kind !== null,
      };
    },
    walk(x, run, id) {
      return Number.isFinite(x) && afterFlow(() => body.walk(x, run, id));
    },
    move(args, id) { return afterFlow(() => body.move?.(args, id) ?? false); },
    stopWalk(id) { pending = null; body.stopWalk(id); },
    pointer(type, point) {
      body.pointer(type, point);
      if (type === 'down' && body.layout().pressing) { clear(); pending = null; }
    },
    drop(point) { clear(); pending = null; body.drop(point); },
    dispose() { clear(); pending = null; body.dispose(); },
  };
}
