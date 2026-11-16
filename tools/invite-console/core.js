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
    return { id: value.id, code: value.code, status: value.status, createdAt: value.createdAt };
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
    };
  }

  function createApiAdapter({ basePath, csrfToken, fetchImpl = globalThis.fetch, timeoutMs = 12000 }) {
    if (typeof basePath !== 'string' || !/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(basePath)) {
      throw new Error('服务地址必须为同源 API 路径，请联系管理员检查配置。');
    }
    const base = basePath.replace(/\/$/, '');

    async function request(path, { method = 'GET', requestId } = {}) {
      const headers = { Accept: 'application/json' };
      if (method !== 'GET') {
        const token = csrfToken();
        if (!token) throw new Error('管理会话校验信息缺失，请通过管理入口重新打开页面。');
        headers['Content-Type'] = 'application/json';
        headers['X-CSRF-Token'] = token;
        if (requestId) headers['Idempotency-Key'] = requestId;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${base}${path}`, {
          method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          signal: controller.signal, ...(method === 'GET' ? {} : { body: '{}' }),
        });
        if (!response.ok) {
          const messages = {
            401: '管理会话已失效，请重新登录管理后台。',
            403: '当前账号没有发码权限，请联系管理员。',
            409: '邀请码状态已变化，请刷新记录后重试。',
            429: '操作有些频繁，请稍后重试。',
          };
          throw new Error(messages[response.status] || '服务暂时不可用，请稍后重试。');
        }
        return await response.json();
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('请求超时，请重试查询本次发码结果。');
        if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试。');
        if (error instanceof SyntaxError) throw new Error('服务返回格式不正确，请联系管理员。');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      list: async () => {
        const data = await request('');
        if (!Array.isArray(data?.items)) throw new Error('发码记录格式不正确，请联系管理员。');
        return data.items.map(validateInvite);
      },
      issue: async (requestId) => {
        const item = validateInvite(await request('', { method: 'POST', requestId }));
        // A retry may return a record that has since been redeemed or revoked.
        return item;
      },
      revoke: async (id) => validateInvite(await request(`/${encodeURIComponent(id)}/revoke`, { method: 'POST' })),
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

  return { ALPHABET, DEMO_KEY, generateCode, validateInvite, createDemoAdapter, createApiAdapter, createIssuer };
});
