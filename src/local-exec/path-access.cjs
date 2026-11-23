const { canonical, inside, approvalPaths } = require('./workspace.cjs')

function createPathAccess({ home, userData, confirmAccess = async () => false }) {
  const protectedPaths = approvalPaths(home, userData)
  const tasks = new Map()
  async function restrictions() {
    // An unavailable unrelated resource must not disable ordinary file tasks.
    const resolved = await Promise.all(protectedPaths.map(root => canonical(root).catch(() => root)))
    return [...new Set([...protectedPaths, ...resolved])]
  }
  function state(task) {
    if (!tasks.has(task)) {
      if (tasks.size >= 100) tasks.delete(tasks.keys().next().value)
      tasks.set(task, { grants: [], refusals: [], pending: new Map() })
    }
    return tasks.get(task)
  }
  function refusal(filename) {
    return { status: 'denied', denied: true, permission: 'filesystem', denial_source: 'matter', path: filename,
      permission_required: true, command_executed: false, may_have_partial_effects: false, retryable: false,
      message: '当前任务未获得此位置的 Matter 访问授权，操作已停止。' }
  }
  function revoke(current, filename) {
    current.refusals.push(filename)
    current.grants = current.grants.filter(grant => !inside(grant.path, filename) && !inside(filename, grant.path))
  }
  return {
    clear() { tasks.clear() },
    restrictions,
    grants(task) { return state(task).grants.map(grant => ({ ...grant })) },
    revoke(task, filename) { revoke(state(task), filename) },
    async request(filename, { task, access, reason, conversation, signal, validate }) {
      if (!(await restrictions()).some(root => inside(root, filename))) return null
      const current = state(task)
      if (current.refusals.some(root => inside(root, filename) || inside(filename, root))) return refusal(filename)
      if (current.grants.some(grant => inside(grant.path, filename) && (grant.access === 'write' || access === 'read'))) return { approved: true }
      const key = JSON.stringify([filename, access])
      let pending = current.pending.get(key)
      if (!pending) {
        pending = (async () => {
          await validate()
          const allowed = await confirmAccess({ path: filename, access, reason, conversation, signal })
          await validate()
          if (await canonical(filename) !== filename) throw new Error('授权路径已变化，请重新发起任务')
          if (allowed !== true) {
            revoke(current, filename)
            return refusal(filename)
          }
          current.grants.push({ path: filename, access })
          return { approved: true }
        })()
        current.pending.set(key, pending)
      }
      try { const result = await pending; await validate(); return result }
      finally { if (current.pending.get(key) === pending) current.pending.delete(key) }
    },
  }
}

module.exports = { createPathAccess }
