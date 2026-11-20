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
    state.repeat = false;
    exiting = false;
  }
  function afterFlow(action) {
    if (body.layout().busy) return false;
    if (!state.kind) return action();
    const spec = FLOW_TIMING[state.kind];
    if (spec.enter == null) { clear(); body.do('stand'); return action(); }
    pending = action;
    state.repeat = false;
    if (!exiting && state.sourceTime >= spec.enter - TIME_EPSILON) {
      state.sourceTime = Math.max(state.sourceTime, spec.sourceExit);
    }
    exiting = true;
    return true;
  }
  function start(word, repeat = false) {
    if (body.layout().busy) return false;
    if (state.kind === word && !exiting) { state.repeat ||= repeat; pending = null; return true; }
    if (state.kind) return afterFlow(() => start(word, repeat));
    body.stopWalk();
    body.do('stand');
    // The pack owns flow completion. A kit pulse would survive early stow/drag cancellation.
    state.kind = word;
    state.elapsed = state.sourceTime = 0;
    state.repeat = repeat;
    return true;
  }
  function advance(dt) {
    const spec = FLOW_TIMING[state.kind];
    if (exiting) {
      const reverse = state.sourceTime < spec.enter - TIME_EPSILON;
      state.sourceTime += reverse ? -dt : dt;
      return reverse ? state.sourceTime <= TIME_EPSILON : state.sourceTime >= spec.exitEnd - TIME_EPSILON;
    }
    state.elapsed += dt;
    if (state.repeat) {
      state.sourceTime = state.elapsed < spec.enter ? state.elapsed
        : spec.enter + (state.elapsed - spec.enter) % (spec.sourceExit - spec.enter);
      return false;
    }
    state.sourceTime = Math.min(spec.seconds, state.elapsed);
    return state.elapsed >= spec.seconds - TIME_EPSILON;
  }
  return {
    ...body,
    recoverableFlows: ['work', 'ask', 'write', 'flag', 'carry'],
    createIdleThinkingView() {
      return {
        seconds: FLOW_TIMING.think.seconds,
        draw(seconds) { state.thinkingTime = seconds; },
        hide() { state.thinkingTime = null; },
        dispose() { state.thinkingTime = null; },
      };
    },
    do(word, { repeat = false } = {}) {
      if (Object.hasOwn(FLOW_TIMING, word)) return start(word, repeat && ['work', 'ask'].includes(word));
      if (!body.words.includes(word)) return false;
      return afterFlow(() => body.do(word));
    },
    finishFlow() { return state.repeat ? afterFlow(() => {}) : false; },
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
      if (spec?.enter != null) phase = exiting || !state.repeat && state.sourceTime >= spec.sourceExit - TIME_EPSILON ? 'stowing'
        : state.sourceTime < spec.enter - TIME_EPSILON ? 'pulling' : state.kind === 'work' ? 'typing' : 'waiting';
      return {
        ...layout, work: state.kind === 'work' ? phase : null, ask: state.kind === 'ask' ? phase : null,
        recoverableFlow: ['work', 'ask', 'write', 'flag', 'carry'].includes(state.kind) ? state.kind : null,
        gesture: state.kind ?? layout.gesture,
        // Authored idle animation needs display-rate drawing without pretending to walk.
        animating: Boolean(state.authoredMotion),
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
