(function (root, factory) {
  'use strict';
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.InviteCore = core;
})(globalThis, function () {
  'use strict';

  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const DEMO_KEY = 'matter:invite-console:demo:v1';
  const STATUSES = new Set(['active', 'used', 'revoked']);
  const MAX_NOTE_LENGTH = 200;

  function normalizeNote(value) {
    if (typeof value !== 'string' || [...value.trim()].length > MAX_NOTE_LENGTH) {
      throw new Error('备注须为不超过 200 个字符的文本。');
    }
    return value.trim();
  }

  function generateCode(cryptoImpl = globalThis.crypto) {
    const bytes = new Uint8Array(6);
    for (let attempt = 0; attempt < 128; attempt += 1) {
      cryptoImpl.getRandomValues(bytes);
      const code = Array.from(bytes, (value) => ALPHABET[value & 31]).join('');
      if (/[A-Z]/.test(code) && /[2-9]/.test(code)) return code;
    }
    throw new Error('暂时无法生成邀请码，请重试。');
  }

  function validateInvite(value) {
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 128
      || !/^[A-Z0-9]{6}$/.test(value.code) || !STATUSES.has(value.status)
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
      throw new Error('邀请码数据格式不正确，请刷新后重试。');
    }
    const item = { id: value.id, code: value.code, status: value.status, createdAt: value.createdAt };
    if (value.note !== undefined) item.note = normalizeNote(value.note);
    if (value.usedAt != null) {
      if (typeof value.usedAt !== 'string' || !Number.isFinite(Date.parse(value.usedAt))) {
        throw new Error('邀请码核销时间格式不正确，请刷新后重试。');
      }
      item.usedAt = value.usedAt;
    }
    if (value.activation != null) {
      const activation = value.activation;
      if (value.status !== 'used' || !['active', 'revoked'].includes(activation.status)
        || typeof activation.createdAt !== 'string' || !Number.isFinite(Date.parse(activation.createdAt))
        || (activation.revokedAt !== undefined && !Number.isFinite(Date.parse(activation.revokedAt)))) {
        throw new Error('设备激活数据格式不正确，请刷新后重试。');
      }
      item.activation = { status: activation.status, createdAt: activation.createdAt,
        ...(activation.revokedAt ? { revokedAt: activation.revokedAt } : {}) };
    }
    return item;
  }

  function recordStatus(item) {
    return item.activation?.status === 'revoked' ? 'revoked' : item.status;
  }

  function statusLabel(item) {
    if (item.activation?.status === 'revoked' || (item.status === 'revoked' && item.usedAt)) return '已过期';
    return { active: '未使用', used: '已使用', revoked: '已作废' }[item.status];
  }

  function matchesFilter(item, status = 'current') {
    const effective = recordStatus(item);
    return status === 'all' || (status === 'current' ? effective !== 'revoked' : effective === status);
  }

  function matchesQuery(item, query = '') {
    const text = query.trim().toLowerCase();
    return !text || item.code.toLowerCase().includes(text) || (item.note || '').toLowerCase().includes(text);
  }

  function createDemoAdapter({ storage, locks, cryptoImpl = globalThis.crypto }) {
    function read() {
      try {
        const raw = storage.getItem(DEMO_KEY);
        if (!raw) return { items: [], requests: {} };
        const data = JSON.parse(raw);
        if (!Array.isArray(data.items) || !data.requests || typeof data.requests !== 'object') throw new Error();
        return { items: data.items.map(validateInvite), requests: data.requests };
      } catch {
        throw new Error('无法读取本地演示记录，请检查浏览器存储权限。');
      }
    }

    function save(data) {
      try {
        storage.setItem(DEMO_KEY, JSON.stringify(data));
      } catch {
        throw new Error('无法保存演示记录，请检查浏览器存储空间及权限。');
      }
    }

    const exclusive = (action) => locks?.request
      ? locks.request(DEMO_KEY, action)
      : Promise.resolve().then(action);

    return {
      list: async () => read().items,
      listPage: async ({ status = 'current', query = '', cursor = '' } = {}) => {
        const filtered = read().items.filter((item) => matchesFilter(item, status)
          && matchesQuery(item, query))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
        const offset = cursor ? Number(cursor) : 0;
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页位置无效，请刷新记录。');
        return { items: filtered.slice(offset, offset + 20), nextCursor: offset + 20 < filtered.length ? String(offset + 20) : '' };
      },
      issue: (requestId) => exclusive(() => {
        const data = read();
        const existing = data.items.find((item) => item.id === data.requests[requestId]);
        if (existing) return existing;
        if (data.items.length >= 1000) throw new Error('演示记录已达 1,000 条，请使用新的演示存储环境。');
        const codes = new Set(data.items.map((item) => item.code));
        let code;
        for (let attempt = 0; attempt < 64; attempt += 1) {
          const candidate = generateCode(cryptoImpl);
          if (!codes.has(candidate)) { code = candidate; break; }
        }
        if (!code) throw new Error('暂时无法生成不重复的邀请码，请重试。');
        const item = { id: cryptoImpl.randomUUID(), code, status: 'active', createdAt: new Date().toISOString() };
        data.items.unshift(item);
        data.requests[requestId] = item.id;
        save(data);
        return item;
      }),
      revoke: (id) => exclusive(() => {
        const data = read();
        const item = data.items.find((entry) => entry.id === id);
        if (!item) throw new Error('没有找到这个邀请码，请刷新记录。');
        if (item.status === 'used') throw new Error('邀请码已使用，无法作废。');
        item.status = 'revoked';
        save(data);
        return item;
      }),
      revokeActivation: (id) => exclusive(() => {
        const data = read();
        const item = data.items.find((entry) => entry.id === id);
        if (!item || item.status !== 'used' || !item.activation) throw new Error('没有找到已激活设备，请刷新记录。');
        item.activation.status = 'revoked';
        item.activation.revokedAt ||= new Date().toISOString();
        save(data);
        return item;
      }),
      updateNote: (id, note) => exclusive(() => {
        note = normalizeNote(note);
        const data = read();
        const item = data.items.find((entry) => entry.id === id);
        if (!item) throw new Error('没有找到这个邀请码，请刷新记录。');
        item.note = note;
        save(data);
        return item;
      }),
    };
  }

  function createApiAdapter({ basePath, fetchImpl = globalThis.fetch, timeoutMs = 12000 }) {
    if (typeof basePath !== 'string' || !/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(basePath)) {
      throw new Error('服务地址必须为同源 API 路径，请联系管理员检查配置。');
    }
    const base = basePath.replace(/\/$/, '');

    async function request(path, { method = 'GET', requestId, body = {} } = {}) {
      const headers = { Accept: 'application/json' };
      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        if (requestId) headers['Idempotency-Key'] = requestId;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${base}${path}`, {
          method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: controller.signal, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          const messages = {
            400: '请求内容不正确，请检查后重试。',
            401: '邀请码接口仍要求身份验证，请确认后端已更新。',
            403: '邀请码接口拒绝访问，请确认后端已更新。',
            404: '邀请码接口不存在，请确认当前后端已更新。',
            409: '邀请码或设备状态已变化，请刷新记录后重试。',
            429: '操作有些频繁，请稍后重试。',
            503: '邀请码服务未启用或依赖未就绪，请联系管理员。',
          };
          throw new Error(messages[response.status] || '服务暂时不可用，请稍后重试。');
        }
        return await response.json();
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('请求超时，请刷新记录核对结果后重试。');
        if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试。');
        if (error instanceof SyntaxError) throw new Error('服务返回格式不正确，请联系管理员。');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      listPage: async ({ status = 'current', query = '', cursor = '' } = {}) => {
        const params = new URLSearchParams({ status, q: query, cursor });
        const data = await request(`?${params}`);
        if (!Array.isArray(data?.items)) throw new Error('发码记录格式不正确，请联系管理员。');
        if (data.nextCursor !== undefined && (typeof data.nextCursor !== 'string' || data.nextCursor.length > 1024)) {
          throw new Error('发码分页格式不正确，请刷新记录。');
        }
        return { items: data.items.map(validateInvite), nextCursor: data.nextCursor || '' };
      },
      issue: async (requestId) => {
        const item = validateInvite(await request('', { method: 'POST', requestId }));
        // A retry may return a record that has since been redeemed or revoked.
        return item;
      },
      revoke: async (id) => validateInvite(await request(`/${encodeURIComponent(id)}/revoke`, { method: 'POST' })),
      revokeActivation: async (id) => validateInvite(await request(`/${encodeURIComponent(id)}/revoke-activation`, { method: 'POST' })),
      updateNote: async (id, note) => validateInvite(await request(`/${encodeURIComponent(id)}/note`, {
        method: 'POST', body: { note: normalizeNote(note) },
      })),
    };
  }

  // Single-flight plus a tab-scoped journal: reload/timeout retries reuse the same ID.
  // Actual exactly-once issuance must be implemented transactionally by the service.
  function createIssuer({ adapter, storage, pendingKey, randomUUID = () => globalThis.crypto.randomUUID() }) {
    let pendingId = storage.getItem(pendingKey);
    let inFlight = null;
    return {
      hasPending: () => Boolean(pendingId),
      issue() {
        if (inFlight) return inFlight;
        if (!pendingId) {
          const id = randomUUID();
          // Never send a mutation if its recovery ID could not be saved.
          storage.setItem(pendingKey, id);
          pendingId = id;
        }
        inFlight = Promise.resolve().then(() => adapter.issue(pendingId)).then((item) => {
          storage.removeItem(pendingKey);
          pendingId = null;
          return item;
        }).finally(() => { inFlight = null; });
        return inFlight;
      },
    };
  }

  return { ALPHABET, DEMO_KEY, MAX_NOTE_LENGTH, normalizeNote, generateCode, validateInvite, recordStatus, statusLabel, matchesFilter, matchesQuery,
    createDemoAdapter, createApiAdapter, createIssuer };
});
