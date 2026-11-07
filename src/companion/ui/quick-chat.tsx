import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatInput } from '@matter/components/composer/ChatInput'
import { Button } from '@matter/components/core/Button'
import sendIcon from '@matter/design/assets/home-send.svg'
import attachIcon from '@matter/design/assets/home-attach.svg'

type File = {id:string; name:string}
export function QuickChat({ open, target, onAction, onClose, onBusy }:any) {
  const [text,setText] = useState('')
  const [files,setFiles] = useState<File[]>([])
  const [context,setContext] = useState('')
  const [loading,setLoading] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const pending = useRef(false)
  const lastContext = useRef('')
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true);setContext('');setError('')
    void onAction('chat-context',{}).then((result:any) => {
      if (cancelled) return
      if (!result?.ok || !result.contextId) throw new Error('请先登录 Matter，再重新打开输入框')
      if (target && result.contextId !== target.contextId) throw new Error('会话已切换，请等待消息刷新')
      if (lastContext.current && lastContext.current !== result.contextId) {setText('');setFiles([])}
      lastContext.current = result.contextId;setContext(result.contextId)
    }).catch((reason:any) => { if (!cancelled) setError(reason.message || 'Matter 暂不可用') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {cancelled=true}
  },[open,onAction,target?.contextId,target?.conversationId,target?.turnId])
  const send = target ? 'chat-queue' : 'chat-send'
  async function request(action:string) {
    if (!context || pending.current || (action===send && !(text.trim() || files.length))) return
    pending.current=true;setBusy(true);onBusy(true);setError('')
    try {
      const result = await onAction(action,{...target,contextId:context,text,attachmentIds:files.map(file => file.id)})
      if (!result?.ok) throw new Error(result?.message || '操作未完成，请重试')
      if (action==='chat-upload') setFiles(saved => [...new Map([...saved,...result.attachments].map(file => [file.id,file])).values()])
      else {setText('');setFiles([]);onClose()}
    } catch (reason:any) {setError(reason.message || '发送失败，请重试')}
    finally {pending.current=false;setBusy(false);onBusy(false)}
  }
  return <div className={'pet-quick-region'+(target ? ' pet-quick-inline' : '')} onKeyDown={event => {
    if (event.key==='Escape' && !event.nativeEvent.isComposing && event.keyCode!==229) {
      event.stopPropagation();event.preventDefault();if (!pending.current) onClose()
    }
  }}>
    <div className="pet-quick" aria-busy={loading || busy}>
    <Button variant="soft" shape="round" className="pet-quick-attach" aria-label="添加附件"
      disabled={loading || busy || !context || files.length>=20} onClick={() => request('chat-upload')}>
      <img src={attachIcon} alt="" aria-hidden="true"/>
    </Button>
    <ChatInput value={text} onChange={setText} onSubmit={() => request(send)}
      placeholder={loading ? '正在连接 Matter…' : target ? '追加消息，排队执行' : '输入你的需求'} maxRows={1}
      disabled={loading || busy} autoFocus={open && !loading} preventAutoFocusScroll style={{lineHeight:'20px'}}/>
    <Button variant="primary" shape="round" className="pet-quick-send" aria-label={target ? '发送到队列' : '发送'}
      disabled={loading || busy || !context || !(text.trim() || files.length)} onClick={() => request(send)}>
      <img src={sendIcon} alt="" aria-hidden="true"/>
    </Button>
    </div>
    {(files.length>0 || error) && <div className="pet-quick-notes">
      {!!files.length && <div className="pet-attachments">{files.map(file => <button key={file.id} disabled={busy}
        title="移除附件" onClick={() => setFiles(saved => saved.filter(candidate => candidate.id!==file.id))}>{file.name} ×</button>)}</div>}
      {error && <div role="alert" className="pet-error">{error}</div>}
    </div>}
  </div>
}

export function createQuickChatView(element:HTMLElement, css:string, callbacks:any) {
  const shadow=element.attachShadow({mode:'open'})
  const style=document.createElement('style');style.textContent=css
  const mount=document.createElement('div');shadow.append(style,mount)
  const root=createRoot(mount),media=matchMedia('(prefers-color-scheme:dark)')
  const theme=()=>element.dataset.theme=media.matches?'dark':'light'
  theme();media.addEventListener('change',theme)
  return {
    update(open:boolean) {root.render(<QuickChat open={open} {...callbacks}/>)},
    destroy() {root.unmount();media.removeEventListener('change',theme)},
  }
}
