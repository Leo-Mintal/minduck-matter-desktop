import { useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { QuickChat } from './quick-chat'

function Running({ task, onAction, onFocus, onReleaseFocus }:any) {
  const [open,setOpen] = useState(false)
  const [busy,setBusy] = useState(false)
  const [stopped,setStopped] = useState(false)
  const [error,setError] = useState('')
  const pending = useRef(false)
  const target = {contextId:task.contextId,conversationId:task.conversationId,turnId:task.turnId}
  const disabled = !target.contextId || !target.turnId || busy || stopped || typeof onAction !== 'function'
  const close = () => {setOpen(false);onReleaseFocus?.()}
  async function stop() {
    if (disabled || pending.current) return
    pending.current=true;setBusy(true);setError('')
    try {
      const result=await onAction('chat-stop',target)
      if (!result?.ok || !result.stopped) throw new Error(result?.message || '终止未完成，请重试')
      setStopped(true);close()
    } catch (reason:any) {setError(reason.message || '终止失败，请重试')}
    finally {pending.current=false;setBusy(false)}
  }
  return <div className="pet-running" aria-busy={busy}>
    <div className="pet-running-heading">
      <button className="pet-running-message" title={[task.text,task.detail].filter(Boolean).join('\n')}
        aria-label={'打开会话：'+(task.detail || task.text || '当前任务')}
        onClick={() => {void onAction('open-conversation',{conversationId:task.conversationId,turnId:task.turnId})
          .catch((reason:any) => setError(reason.message || '无法打开会话'))}}>
        <span>{task.text || '任务进行中'}</span><span className="pet-running-secondary">{task.detail}</span>
      </button>
      <div className="pet-running-actions">
        <button type="button" className="pet-running-button pet-running-append" aria-label="追加消息到队列"
          title="追加消息到队列" aria-expanded={open} disabled={disabled} onClick={() => {
            if (open) close();else {setOpen(true);setError('');onFocus?.()}
          }}>
          <svg width="16" height="16" viewBox="272 42 16 16" fill="none" aria-hidden="true">
            <path d="M285.333 44.6667V45.6C285.333 47.8402 285.333 48.9603 284.897 49.816C284.514 50.5686 283.902 51.1805 283.149 51.564C282.294 52 281.174 52 278.933 52H274.667M278 55.3333L274.667 52L278 48.6667"
              stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button type="button" className="pet-running-button pet-running-stop" aria-label="终止当前任务"
          title="终止当前任务" disabled={disabled} onClick={stop}>
          <svg width="16" height="16" viewBox="312 42 16 16" fill="none" aria-hidden="true">
            <rect x="314" y="44" width="12" height="12" rx="3.2" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>
    <div className="pet-running-composer" hidden={!open}>
      <QuickChat open={open} target={target} onAction={onAction} onClose={close} onBusy={setBusy}/>
    </div>
    {error && <div className="pet-running-feedback pet-error" role="alert">{error}</div>}
    {stopped && <div className="pet-running-feedback pet-status" role="status">已终止，等待状态更新</div>}
  </div>
}

export function createRunningView(element:HTMLElement, css:string, callbacks:any) {
  const shadow=element.attachShadow({mode:'open'})
  const style=document.createElement('style');style.textContent=css
  const mount=document.createElement('div');shadow.append(style,mount)
  const root=createRoot(mount),media=matchMedia('(prefers-color-scheme:dark)')
  const theme=()=>element.dataset.theme=media.matches?'dark':'light'
  theme();media.addEventListener('change',theme)
  return {
    update(task:any) {root.render(task ? <Running key={[task.contextId,task.conversationId,task.turnId].join(':')} task={task} {...callbacks}/> : null)},
    destroy() {root.unmount();media.removeEventListener('change',theme)},
  }
}
