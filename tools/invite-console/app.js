(function () {
  'use strict';

  const core = window.InviteCore;
  const $ = (id) => document.getElementById(id);
  const config = window.InviteConsoleConfig;
  const reels = [...document.querySelectorAll('.reel')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const emptyRow = $('empty-row');
  const emptyState = $('empty-state');
  const labels = { active: '未使用', used: '已使用', revoked: '已作废' };
  const state = {
    items: [], current: null, filter: 'all', query: '', busy: false,
    loading: false, ready: false, revoking: null, listError: false,
  };
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  let adapter;
  let issuer;
  let toastTimer;

  function updateThemeButton() {
    const next = document.documentElement.dataset.theme === 'dark' ? '浅色' : '深色';
    $('theme-toggle').setAttribute('aria-label', `切换为${next}模式`);
    $('theme-toggle').title = `切换为${next}模式`;
  }

  $('theme-toggle').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('matter:invite-console:theme', theme); } catch { /* Optional preference. */ }
    updateThemeButton();
  });
  updateThemeButton();

  function notify(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600);
  }

  function updateControls() {
    const locked = state.busy || state.loading || !state.ready;
    $('generate-button').disabled = locked;
    $('copy-button').disabled = locked || state.current?.status !== 'active';
    $('refresh-button').disabled = state.busy || state.loading;
    $('generate-label').textContent = state.busy && !state.revoking ? '正在摇码…'
      : issuer?.hasPending() ? '重试本次摇码' : state.current ? '再摇一次' : '摇码';
    $('reels-area').setAttribute('aria-busy', String(state.busy));
    document.querySelectorAll('[data-action]').forEach((button) => { button.disabled = locked; });
  }

  function displayCode(code = '——————') {
    $('reels-area').classList.toggle('has-code', code !== '——————');
    reels.forEach((reel, index) => {
      reel.classList.remove('is-rolling');
      const track = reel.firstElementChild;
      track.getAnimations().forEach((animation) => animation.cancel());
      const symbol = document.createElement('span');
      symbol.textContent = code[index];
      track.replaceChildren(symbol);
    });
  }

  function symbols(track, values) {
    track.replaceChildren(...values.map((value) => {
      const node = document.createElement('span');
      node.textContent = value;
      return node;
    }));
  }

  function randomSymbols(count) {
    const bytes = crypto.getRandomValues(new Uint8Array(count));
    return Array.from(bytes, (value) => core.ALPHABET[value & 31]);
  }

  function startRolling() {
    if (reducedMotion.matches) return;
    $('reels-area').classList.add('has-code');
    reels.forEach((reel) => {
      symbols(reel.firstElementChild, randomSymbols(12));
      reel.classList.add('is-rolling');
    });
  }

  async function settleCode(code) {
    if (reducedMotion.matches) { displayCode(code); return; }
    await Promise.all(reels.map(async (reel, index) => {
      reel.classList.remove('is-rolling');
      const track = reel.firstElementChild;
      symbols(track, [...randomSymbols(12 + index * 2), code[index]]);
      const animation = track.animate([
        { transform: 'translateY(0)' },
        { transform: 'translateY(calc(-100% + var(--reel-height)))' },
      ], { duration: 640 + index * 90, easing: 'cubic-bezier(.14,.66,.16,1)', fill: 'forwards' });
      try { await animation.finished; } catch { /* Complete immediately if motion is cancelled. */ }
    }));
    displayCode(code);
  }

  function renderCaption() {
    const caption = $('result-caption');
    caption.replaceChildren();
    if (!state.current) return;
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    if (state.current.status !== 'active') dot.style.background = 'var(--ink3)';
    caption.append(dot, document.createTextNode(`${state.current.code} · ${labels[state.current.status]}`));
  }

  function makeCell(className = '') {
    const td = document.createElement('td');
    td.className = className;
    return td;
  }

  function rowAction(item, action, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.id = item.id;
    button.setAttribute('aria-label', `${label}邀请码 ${item.code}`);
    button.title = `${label} ${item.code}`;
    if (action === 'copy') {
      button.className = 'b b-icon b-sm row-copy';
      const icon = document.createElement('span');
      icon.className = 'asset-icon copy-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
    } else {
      button.className = 'text-button';
      button.textContent = label;
    }
    return button;
  }

  function makeRow(item) {
    const row = document.createElement('tr');
    const code = makeCell('code-value');
    code.textContent = item.code;
    const statusCell = makeCell();
    const status = document.createElement('span');
    status.className = `status status-${item.status}`;
    status.textContent = labels[item.status];
    statusCell.append(status);
    const dateCell = makeCell();
    const time = document.createElement('time');
    time.dateTime = item.createdAt;
    time.title = new Date(item.createdAt).toLocaleString('zh-CN');
    const parts = dateFormat.formatToParts(new Date(item.createdAt));
    const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
    const day = document.createElement('span');
    day.className = 'record-date';
    day.textContent = `${part('month')}/${part('day')}`;
    const clock = document.createElement('span');
    clock.className = 'record-time';
    clock.textContent = `${part('hour')}:${part('minute')}`;
    time.append(day, document.createTextNode(' '), clock);
    dateCell.append(time);
    const actionsCell = makeCell();
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    if (item.status === 'active') actions.append(rowAction(item, 'copy', '复制'), rowAction(item, 'revoke', '作废'));
    else {
      const text = document.createElement('span');
      text.className = 'row-unavailable';
      text.textContent = item.status === 'used' ? '已核销' : '不可使用';
      actions.append(text);
    }
    actionsCell.append(actions);
    row.append(code, statusCell, dateCell, actionsCell);
    return row;
  }

  function renderHistory() {
    const items = state.items.filter((item) => (
      (state.filter === 'all' || item.status === state.filter) && item.code.includes(state.query)
    ));
    $('record-count').textContent = String(state.items.length);
    $('record-count').setAttribute('aria-label', `共 ${state.items.length} 条记录`);
    $('history-rows').replaceChildren(...(items.length ? items.map(makeRow) : [emptyRow]));
    const filtered = state.filter !== 'all' || state.query;
    const unavailable = state.listError && !state.ready;
    emptyState.textContent = state.loading ? '加载中…'
      : unavailable ? '加载失败，请刷新重试' : filtered ? '无匹配记录' : '暂无记录';
    document.querySelectorAll('[data-filter]').forEach((button) => {
      const selected = button.dataset.filter === state.filter;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    updateControls();
  }

  function mergeItem(item) {
    state.items = [item, ...state.items.filter((entry) => entry.id !== item.id)]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async function refreshHistory() {
    if (!adapter || state.busy || state.loading) return;
    state.loading = true;
    state.listError = false;
    $('history-error').hidden = true;
    renderHistory();
    try {
      state.items = (await adapter.list()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      state.ready = true;
      if (state.current) {
        const current = state.items.find((item) => item.id === state.current.id);
        // A missing record must never remain copyable as an active invite.
        state.current = current || null;
        displayCode(state.current?.code);
        renderCaption();
      }
    } catch (error) {
      state.listError = true;
      $('history-error').textContent = error.message;
      $('history-error').hidden = false;
    } finally {
      state.loading = false;
      renderHistory();
    }
  }

  async function generate() {
    if (state.busy || state.loading || !state.ready) return;
    state.busy = true;
    $('operation-message').textContent = '';
    $('result-caption').textContent = '正在摇码…';
    updateControls();
    try {
      startRolling();
      const item = await issuer.issue();
      await settleCode(item.code);
      state.current = item;
      mergeItem(item);
      // Keep a newly issued invite visible even if a previous filter hid it.
      state.filter = 'all';
      state.query = '';
      $('search-input').value = '';
    } catch (error) {
      displayCode(state.current?.code);
      $('operation-message').textContent = `${error.message}${issuer.hasPending() ? ' 请重试本次摇码。' : ''}`;
    } finally {
      state.busy = false;
      renderCaption();
      renderHistory();
    }
  }

  async function copyCode(code) {
    const previousFocus = document.activeElement;
    try {
      await navigator.clipboard.writeText(code);
      notify(config.mode === 'demo' ? '已复制演示码，仅供预览' : '邀请码已复制');
    } catch {
      // A selectable fallback also works on file:// and when clipboard permission is denied.
      const field = document.createElement('textarea');
      field.value = code;
      field.setAttribute('aria-label', '选中并复制邀请码');
      field.style.cssText = 'position:fixed;left:16px;bottom:16px;width:160px;z-index:20';
      document.body.append(field);
      field.focus();
      field.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* Keep the selectable fallback. */ }
      if (copied) {
        field.remove();
        previousFocus?.focus();
        notify(config.mode === 'demo' ? '已复制演示码，仅供预览' : '邀请码已复制');
      } else {
        notify('请长按或按 ⌘/Ctrl+C 复制选中的邀请码');
        field.addEventListener('blur', () => field.remove(), { once: true });
      }
    }
  }

  function openRevoke(item) {
    if (state.busy || state.loading || item.status !== 'active') return;
    state.revoking = item;
    $('revoke-code').textContent = item.code;
    $('revoke-error').hidden = true;
    $('revoke-dialog').showModal();
    $('cancel-revoke').focus();
  }

  function closeDialog() {
    if (state.busy) return;
    $('revoke-dialog').close();
    state.revoking = null;
  }

  async function confirmRevoke(event) {
    event.preventDefault();
    if (state.busy || !state.revoking) return;
    state.busy = true;
    $('revoke-error').hidden = true;
    ['confirm-revoke', 'cancel-revoke', 'close-dialog'].forEach((id) => { $(id).disabled = true; });
    $('confirm-revoke').textContent = '正在作废…';
    updateControls();
    try {
      const item = await adapter.revoke(state.revoking.id);
      if (item.status !== 'revoked') throw new Error('服务尚未确认作废，请刷新记录后核对。');
      mergeItem(item);
      if (state.current?.id === item.id) state.current = item;
      $('revoke-dialog').close();
      state.revoking = null;
      notify('邀请码已作废');
      renderCaption();
    } catch (error) {
      $('revoke-error').textContent = error.message;
      $('revoke-error').hidden = false;
    } finally {
      state.busy = false;
      ['confirm-revoke', 'cancel-revoke', 'close-dialog'].forEach((id) => { $(id).disabled = false; });
      $('confirm-revoke').textContent = '作废';
      renderHistory();
      if (!$('revoke-dialog').open) $('generate-button').focus();
    }
  }

  $('generate-button').addEventListener('click', generate);
  $('copy-button').addEventListener('click', () => {
    if (state.current?.status === 'active') copyCode(state.current.code);
  });
  $('refresh-button').addEventListener('click', refreshHistory);
  $('history-rows').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const item = state.items.find((entry) => entry.id === button.dataset.id);
    if (!item || item.status !== 'active') return;
    if (button.dataset.action === 'copy') copyCode(item.code);
    else openRevoke(item);
  });
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    renderHistory();
  }));
  $('search-input').addEventListener('input', (event) => {
    state.query = event.target.value.trim().toUpperCase();
    renderHistory();
  });
  $('cancel-revoke').addEventListener('click', closeDialog);
  $('close-dialog').addEventListener('click', closeDialog);
  $('revoke-form').addEventListener('submit', confirmRevoke);
  $('revoke-dialog').addEventListener('cancel', (event) => {
    if (state.busy) event.preventDefault();
    else state.revoking = null;
  });
  window.addEventListener('storage', (event) => {
    if (config?.mode === 'demo' && event.key === core.DEMO_KEY) refreshHistory();
  });

  try {
    if (!['demo', 'api'].includes(config?.mode)) throw new Error('页面模式配置不正确，请联系管理员。');
    const isDemo = config.mode === 'demo';
    $('mode-badge').lastChild.textContent = isDemo ? '演示 · 不可激活' : '发码管理';
    adapter = isDemo
      ? core.createDemoAdapter({ storage: localStorage, locks: navigator.locks })
      : core.createApiAdapter({
        basePath: config.apiBasePath,
        csrfToken: () => document.querySelector('meta[name="csrf-token"]').content,
      });
    issuer = core.createIssuer({
      adapter, storage: sessionStorage, pendingKey: `matter:invite-console:${config.mode}:pending:v1`,
    });
    refreshHistory();
  } catch (error) {
    $('operation-message').textContent = error.message;
    $('generate-label').textContent = '暂时无法摇码';
    $('refresh-button').disabled = true;
  }
})();
