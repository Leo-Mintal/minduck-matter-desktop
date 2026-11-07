const contracts = {
  local_shell: { required: ['command'], fields: { command: ['string', 1, 65536], cwd: ['string', 0, 4096], timeout_ms: ['integer', 1000, 120000], needs_network: ['boolean'], description: ['string', 0, 200] } },
  local_read_file: { required: ['path'], fields: { path: ['string', 1, 4096], offset: ['integer', 0, Number.MAX_SAFE_INTEGER], limit: ['integer', 1, 2000] } },
  local_edit_file: { required: ['path', 'old_string', 'new_string'], fields: { path: ['string', 1, 4096], old_string: ['string', 1, 262144], new_string: ['string', 0, 262144], replace_all: ['boolean'] } },
  local_write_file: { required: ['path', 'content'], fields: { path: ['string', 1, 4096], content: ['string', 0, 262144] } },
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function validateCall(params) {
  if (!object(params) || Object.keys(params).some(key => !['name', 'arguments', '_matter'].includes(key))) throw new Error('本机工具请求无效')
  const contract = Object.hasOwn(contracts, params.name) && contracts[params.name]
  const args = params.arguments
  if (!contract || !object(args) || contract.required.some(key => !Object.hasOwn(args, key))) throw new Error('本机工具或参数无效')
  for (const [key, value] of Object.entries(args)) {
    const field = Object.hasOwn(contract.fields, key) && contract.fields[key]
    if (!field) throw new Error('不支持的本机参数：' + key)
    const [type, min, max] = field
    const valid = type === 'integer' ? Number.isSafeInteger(value) && value >= min && value <= max
      : type === 'string' ? typeof value === 'string' && !value.includes('\0') && [...value].length >= min && [...value].length <= max
        : typeof value === type
    if (!valid) throw new Error('本机参数无效：' + key)
  }
  const meta = params._matter
  if (!object(meta) || !/^[A-Za-z0-9_-]{1,80}$/.test(meta.conversation_id || '')
    || typeof meta.conversation_title !== 'string' || meta.conversation_title.length > 1000
    || Object.keys(meta).some(key => !['conversation_id', 'conversation_title', 'run_id', 'tool_call_id'].includes(key))) throw new Error('会话上下文无效')
  return { name: params.name, args, meta }
}

function tokenAccount(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return typeof claims.uid === 'string' && claims.uid && Number.isFinite(claims.exp) && claims.exp * 1000 > Date.now() ? claims.uid : ''
  } catch { return '' }
}

function requestHeaders(headers, { origin, url, account, pairing, ready }) {
  const result = Object.fromEntries(Object.entries(headers).filter(([key]) => !/^x-matter-(desktop|client)$/i.test(key)))
  const target = new URL(url)
  const authorization = Object.entries(result).find(([key]) => key.toLowerCase() === 'authorization')?.[1] || ''
  if (target.origin === origin && target.pathname.startsWith('/api/') && ready && account
    && pairing?.account === account && pairing.origin === origin && typeof authorization === 'string'
    && tokenAccount(authorization.replace(/^Bearer\s+/i, '')) === account) {
    result['X-Matter-Client'] = 'desktop'
    result['X-Matter-Desktop'] = pairing.deviceId
  }
  return result
}

module.exports = { validateCall, tokenAccount, requestHeaders }
