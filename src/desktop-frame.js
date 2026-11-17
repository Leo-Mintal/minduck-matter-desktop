const api = window.minduckDesktopFrame
const toggle = document.querySelector('#browser-toggle')
const update = document.querySelector('#check-update')
const status = document.querySelector('#update-status')
const updateProgress = document.querySelector('#update-progress')
const updateProgressValue = document.querySelector('#update-progress-value')
const back = document.querySelector('#matter-back')
const forward = document.querySelector('#matter-forward')
const reload = document.querySelector('#matter-reload')
const rail = document.querySelector('.rail')

function render(state) {
  if (!state) return
  // The shared Web rail owns interaction once the workspace renderer takes over.
  rail.inert = Boolean(state.workspace)
  rail.setAttribute('aria-hidden', String(Boolean(state.workspace)))
  status.setAttribute('aria-hidden', String(Boolean(state.workspace)))
  document.documentElement.dataset.theme = state.theme
  document.documentElement.dataset.browserOpen = String(state.rightPanelOpen)
  toggle.setAttribute('aria-expanded', String(state.rightPanelOpen))
  const label = state.rightPanelOpen ? '收起浏览器' : '展开浏览器'
  toggle.title = label
  toggle.setAttribute('aria-label', label)
  back.disabled = !state.navigation.canGoBack
  forward.disabled = !state.navigation.canGoForward
  reload.disabled = !state.navigation.canReload
  reload.setAttribute('aria-busy', String(state.navigation.isLoading))
  const check = state.update
  const phase = check.phase || (check.checking ? 'checking' : 'idle')
  const busy = ['checking', 'downloading', 'preparing', 'installing'].includes(phase)
  const percent = Number.isFinite(check.percent) ? Math.max(0, Math.min(100, Math.floor(check.percent))) : 0
  update.dataset.phase = phase
  update.dataset.available = String(Boolean(check.available))
  update.setAttribute('aria-disabled', String(busy))
  update.setAttribute('aria-busy', String(busy))
  const phaseLabels = { checking: '正在检查更新', downloading: `正在下载 ${percent}%`,
    downloaded: check.error ? '安装准备失败，点击重试' : '更新已下载，点击重启安装',
    preparing: '正在验证签名并准备安装', installing: '正在重启更新' }
  const updateLabel = phaseLabels[phase] || (check.error ? '更新失败，点击重试'
    : check.available ? `发现新版本 ${check.version}，点击更新` : '检查更新')
  update.title = updateLabel
  update.setAttribute('aria-label', updateLabel)
  updateProgress.hidden = phase !== 'downloading'
  updateProgressValue.setAttribute('stroke-dashoffset', String(100 - percent))
  updateProgress.setAttribute('aria-valuenow', String(percent))
  status.textContent = updateLabel
}

toggle.addEventListener('click', () => api.command('toggle-browser'))
back.addEventListener('click', () => api.command('matter-go-back'))
forward.addEventListener('click', () => api.command('matter-go-forward'))
reload.addEventListener('click', () => api.command('matter-reload'))
update.addEventListener('click', () => {
  if (update.getAttribute('aria-disabled') !== 'true') api.command('check-update')
})
document.querySelector('#companion-settings').addEventListener('click', () => api.command('companion-settings'))
api.onState(render)
void api.getState().then(render)
