(function () {
  'use strict';

  const core = window.InviteCore;
  const $ = (id) => document.getElementById(id);
  const config = window.InviteConsoleConfig;
  const reels = [...document.querySelectorAll('.reel')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const emptyRow = $('empty-row');
  const emptyState = $('empty-state');
  const statusLabel = core.statusLabel;
  const state = {
    items: [], current: null, filter: 'current', query: '', busy: false,
    loading: false, ready: false, revoking: null, editing: null, listError: false,
    nextCursor: '', authenticated: false,
  };
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  let adapter;
  let issuer;
  let toastTimer;
  let listGeneration = 0;
  let searchTimer;
  let noteReturnFocus;

  function showPassword(message = '') {
    ++listGeneration;
    clearTimeout(searchTimer);
    state.authenticated = false;
    state.items = [];
    state.query = '';
    $('search-input').value = '';
    state.current = null;
    state.ready = false;
    state.loading = false;
    state.nextCursor = '';
    state.revoking = null;
    state.editing = null;
    $('revoke-dialog').close();
    $('note-dialog').close();
    $('revoke-code').textContent = '';
    $('note-code').textContent = '';
    $('note-input').value = '';
    document.querySelectorAll('textarea[data-invite-copy]').forEach((field) => field.remove());
    $('operation-message').textContent = '';
    $('toast').hidden = true;
    $('console-content').hidden = true;
    $('logout-button').hidden = true;
    $('password-gate').hidden = false;
    $('password-error').textContent = message;
    $('password-error').hidden = !message;
    $('login-button').disabled = false;
    $('login-button').textContent = '进入';
    displayCode();
    renderCaption();
    renderHistory();
    $('admin-password').focus();
  }

  function handleUnauthorized(error) {
    if (error.status !== 401) return false;
    showPassword('登录已过期，请重新输入管理员密码。');
    return true;
  }

  async function enterConsole() {
    state.authenticated = true;
    $('password-gate').hidden = true;
    $('console-content').hidden = false;
    $('logout-button').hidden = config.mode === 'demo';
    await refreshHistory();
  }

  $('password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('login-button').disabled) return;
    $('login-button').disabled = true;
    $('login-button').textContent = '正在验证…';
    $('password-error').hidden = true;
    try {
      await adapter.login($('admin-password').value);
      $('admin-password').value = '';
      await enterConsole();
    } catch (error) {
      $('admin-password').value = '';
      showPassword(error.status === 401 ? '管理员密码错误，请重试。' : error.message);
    } finally {
      $('login-button').disabled = false;
      $('login-button').textContent = '进入';
    }
  });

  $('logout-button').addEventListener('click', async () => {
    if (state.busy || state.loading || $('logout-button').disabled) return;
    $('logout-button').disabled = true;
    try { await adapter.logout(); showPassword(); }
    catch (error) { if (!handleUnauthorized(error)) notify(error.message); }
    finally { $('logout-button').disabled = false; }
  });

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
    const locked = state.busy || state.loading || !state.ready || !state.authenticated;
    $('logout-button').disabled = state.busy || state.loading;
    $('generate-button').disabled = locked;
    $('copy-button').disabled = locked || state.current?.status !== 'active';
    $('refresh-button').disabled = state.busy || state.loading;
    $('load-more').disabled = locked;
    $('load-more').hidden = !state.nextCursor;
    $('generate-label').textContent = state.busy && !state.revoking && !state.editing ? '正在摇码…'
      : issuer?.hasPending() ? '重试本次摇码' : state.current ? '再摇一次' : '摇码';
    $('reels-area').setAttribute('aria-busy', String(state.busy && !state.revoking && !state.editing));
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
    caption.append(dot, document.createTextNode(`${state.current.code} · ${statusLabel(state.current)}`));
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
    button.setAttribute('aria-label', action === 'revoke-activation'
      ? `吊销邀请码 ${item.code} 对应的设备激活资格` : `${label}邀请码 ${item.code}`);
    button.title = `${label} ${item.code}`;
    if (action === 'copy') {
      button.className = 'b b-icon b-sm row-copy';
      const icon = document.createElement('span');
      icon.className = 'asset-icon copy-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
    } else {
      button.className = action === 'note' ? 'note-button' : 'b b-danger b-pill row-danger';
      button.textContent = label;
    }
    return button;
  }

  function makeRow(item) {
    const row = document.createElement('tr');
    const code = makeCell();
    const value = document.createElement('span');
    value.className = 'code-value';
    value.textContent = item.code;
    const note = rowAction(item, 'note', '备注');
    note.className = `note-button${item.note ? ' has-note' : ''}`;
    note.textContent = item.note || '添加备注';
    note.title = item.note || '添加备注';
    note.setAttribute('aria-label', `编辑邀请码 ${item.code} 的备注${item.note ? `：${item.note}` : ''}`);
    code.append(value, note);
    const statusCell = makeCell();
    const status = document.createElement('span');
    status.className = `status status-${core.recordStatus(item)}`;
    status.textContent = statusLabel(item);
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
    else if (item.status === 'used' && item.activation?.status === 'active') {
      actions.append(rowAction(item, 'revoke-activation', '吊销'));
    }
    else {
      const text = document.createElement('span');
      text.className = 'row-unavailable';
      text.textContent = core.recordStatus(item) === 'revoked' ? '不可使用' : '已核销';
      actions.append(text);
    }
    actionsCell.append(actions);
    row.append(code, statusCell, dateCell, actionsCell);
    return row;
  }

  function renderHistory() {
    const items = state.items.filter((item) => (
      core.matchesFilter(item, state.filter) && core.matchesQuery(item, state.query)
    ));
    $('record-count').textContent = String(items.length);
    $('record-count').setAttribute('aria-label', `已加载 ${items.length} 条记录`);
    $('history-rows').replaceChildren(...(items.length ? items.map(makeRow) : [emptyRow]));
    const filtered = state.filter !== 'current' || state.query;
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

  async function refreshHistory(append = false) {
    if (!adapter || state.busy || !state.authenticated) return;
    const generation = ++listGeneration;
    state.loading = true;
    state.listError = false;
    $('history-error').hidden = true;
    renderHistory();
    try {
      const page = await adapter.listPage({ status: state.filter, query: state.query, cursor: append ? state.nextCursor : '' });
      if (generation !== listGeneration) return;
      state.items = append ? [...state.items, ...page.items.filter((item) => !state.items.some((entry) => entry.id === item.id))] : page.items;
      state.nextCursor = page.nextCursor;
      state.ready = true;
      if (state.current) {
        const currentPage = await adapter.listPage({ status: 'all', query: state.current.code });
        if (generation !== listGeneration) return;
        const current = currentPage.items.find((item) => item.id === state.current.id);
        // A missing record must never remain copyable as an active invite.
        state.current = current || null;
        displayCode(state.current?.code);
        renderCaption();
      }
    } catch (error) {
      if (generation !== listGeneration) return;
      if (handleUnauthorized(error)) return;
      state.listError = true;
      $('history-error').textContent = error.message;
      $('history-error').hidden = false;
    } finally {
      if (generation === listGeneration) { state.loading = false; renderHistory(); }
    }
  }

  async function generate() {
    if (state.busy || state.loading || !state.ready) return;
    state.busy = true;
    $('operation-message').textContent = '';
    $('result-caption').textContent = '正在摇码…';
    updateControls();
    let issued = false;
    try {
      startRolling();
      const item = await issuer.issue();
      await settleCode(item.code);
      state.current = item;
      mergeItem(item);
      // Keep a newly issued invite visible even if a previous filter hid it.
      state.filter = 'current';
      state.query = '';
      $('search-input').value = '';
      issued = true;
    } catch (error) {
      if (handleUnauthorized(error)) return;
      displayCode(state.current?.code);
      $('operation-message').textContent = `${error.message}${issuer.hasPending() ? ' 请重试本次摇码。' : ''}`;
    } finally {
      state.busy = false;
      renderCaption();
      renderHistory();
    }
    if (issued) await refreshHistory();
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
      field.dataset.inviteCopy = '';
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

  function openRevoke(item, activation = false) {
    if (state.busy || state.loading || (activation
      ? item.status !== 'used' || item.activation?.status !== 'active' : item.status !== 'active')) return;
    state.revoking = { item, activation };
    $('revoke-title').textContent = activation ? '吊销这台设备的激活资格？' : '作废这个邀请码？';
    $('revoke-code').textContent = item.code;
    $('revoke-effect').textContent = activation
      ? ' 对应设备的激活资格将过期，需使用新的邀请码重新激活。原邀请码无法恢复使用。'
      : ' 作废后将无法使用，此操作不可撤销。';
    $('confirm-revoke').textContent = activation ? '吊销' : '作废';
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
    const { item: target, activation } = state.revoking;
    let changed = false;
    state.busy = true;
    $('revoke-error').hidden = true;
    ['confirm-revoke', 'cancel-revoke', 'close-dialog'].forEach((id) => { $(id).disabled = true; });
    $('confirm-revoke').textContent = activation ? '正在吊销…' : '正在作废…';
    updateControls();
    try {
      const item = activation ? await adapter.revokeActivation(target.id) : await adapter.revoke(target.id);
      if (activation ? item.status !== 'used' || item.activation?.status !== 'revoked' : item.status !== 'revoked') {
        throw new Error('服务尚未确认操作结果，请刷新记录后核对。');
      }
      mergeItem(item);
      if (state.current?.id === item.id) state.current = item;
      $('revoke-dialog').close();
      state.revoking = null;
      changed = true;
      notify(activation ? '设备激活资格已过期' : '邀请码已作废');
      renderCaption();
    } catch (error) {
      if (handleUnauthorized(error)) return;
      $('revoke-error').textContent = error.message;
      $('revoke-error').hidden = false;
    } finally {
      state.busy = false;
      ['confirm-revoke', 'cancel-revoke', 'close-dialog'].forEach((id) => { $(id).disabled = false; });
      $('confirm-revoke').textContent = activation ? '吊销' : '作废';
      renderHistory();
      if (state.authenticated && !$('revoke-dialog').open) $('generate-button').focus();
    }
    if (changed) await refreshHistory();
  }

  function closeNote() {
    if (state.busy) return;
    $('note-dialog').close();
    state.editing = null;
    if (noteReturnFocus?.isConnected) noteReturnFocus.focus();
  }

  function openNote(item) {
    if (state.busy || state.loading) return;
    noteReturnFocus = document.activeElement;
    state.editing = item;
    $('note-code').textContent = item.code;
    $('note-input').value = item.note || '';
    $('note-error').hidden = true;
    $('note-dialog').showModal();
    $('note-input').focus();
  }

  async function saveNote(event) {
    event.preventDefault();
    if (state.busy || !state.editing) return;
    const target = state.editing;
    state.busy = true;
    $('note-error').hidden = true;
    ['save-note', 'cancel-note', 'close-note', 'note-input'].forEach((id) => { $(id).disabled = true; });
    $('save-note').textContent = '正在保存…';
    updateControls();
    let saved = false;
    try {
      const note = core.normalizeNote($('note-input').value);
      const item = await adapter.updateNote(target.id, note);
      if (item.id !== target.id || item.note !== note) throw new Error('服务尚未确认备注，请刷新记录后核对。');
      mergeItem(item);
      if (state.current?.id === item.id) state.current = item;
      $('note-dialog').close();
      saved = true;
      notify(note ? '备注已保存' : '备注已清空');
    } catch (error) {
      if (handleUnauthorized(error)) return;
      $('note-error').textContent = error.message;
      $('note-error').hidden = false;
    } finally {
      state.busy = false;
      ['save-note', 'cancel-note', 'close-note', 'note-input'].forEach((id) => { $(id).disabled = false; });
      $('save-note').textContent = '保存';
      renderCaption();
      renderHistory();
      if (saved) {
        state.editing = null;
        Array.from(document.querySelectorAll('button[data-action="note"]')).find((button) => button.dataset.id === target.id)?.focus();
      } else if (state.authenticated) $('note-input').focus();
    }
  }

  $('generate-button').addEventListener('click', generate);
  $('copy-button').addEventListener('click', () => {
    if (state.current?.status === 'active') copyCode(state.current.code);
  });
  $('refresh-button').addEventListener('click', () => void refreshHistory());
  $('load-more').addEventListener('click', () => void refreshHistory(true));
  $('history-rows').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const item = state.items.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === 'copy' && item.status === 'active') copyCode(item.code);
    else if (button.dataset.action === 'note') openNote(item);
    else if (button.dataset.action === 'revoke') openRevoke(item);
    else if (button.dataset.action === 'revoke-activation') openRevoke(item, true);
  });
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    if (state.busy) return;
    state.filter = button.dataset.filter;
    void refreshHistory();
  }));
  $('search-input').addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refreshHistory(), 250);
  });
  $('cancel-revoke').addEventListener('click', closeDialog);
  $('close-dialog').addEventListener('click', closeDialog);
  $('revoke-form').addEventListener('submit', confirmRevoke);
  $('revoke-dialog').addEventListener('cancel', (event) => {
    if (state.busy) event.preventDefault();
    else state.revoking = null;
  });
  $('cancel-note').addEventListener('click', closeNote);
  $('close-note').addEventListener('click', closeNote);
  $('note-form').addEventListener('submit', saveNote);
  $('note-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeNote();
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
      : core.createApiAdapter({ basePath: config.apiBasePath });
    issuer = core.createIssuer({
      adapter, storage: sessionStorage, pendingKey: `matter:invite-console:${config.mode}:pending:v1`,
    });
    if (isDemo) void enterConsole();
    else adapter.session().then(enterConsole).catch((error) => {
      showPassword(error.status === 401 ? '' : error.message);
    });
  } catch (error) {
    showPassword(error.message);
    $('login-button').disabled = true;
    $('login-button').textContent = '暂时无法连接';
  }
})();
