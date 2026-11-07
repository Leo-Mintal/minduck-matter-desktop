import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatInput } from '@matter/components/composer/ChatInput'
import { Button } from '@matter/components/core/Button'
import { LocaleProvider } from '@matter/i18n/LocaleProvider'
import editIcon from '@matter/design/assets/icons/user-message-edit.svg'

type Draft = { picks:string[]; text:string; attachments:{id:string; name:string}[]; skipped:boolean }
const blank = (): Draft => ({ picks:[], text:'', attachments:[], skipped:false })
const pageKey = (page:any, index:number) => page.page_id || String(index)
const acceptsInput = (spec:any) => spec.custom || ['text', 'files', 'text_or_files'].includes(spec.input_mode)
  || !spec.options.length || spec.options.some((option:any) => option.action === 'await_user_input')
const hasAnswer = (draft:Draft) => !!(draft.picks.length || draft.text.trim() || draft.attachments.length)

function Question({ task, onAction, onFocus }:any) {
  const qa = task.qa, spec = qa.spec, pages = spec.pages ?? []
  const [drafts, setDrafts] = useState<Record<string,Draft>>({})
  const [pageIndex, setPageIndex] = useState(0)
  const [editing, setEditing] = useState<Record<string,boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const alive = useRef(true)
  const pending = useRef(false)
  useEffect(() => () => { alive.current = false }, [])
  const target = { conversationId:task.conversationId, turnId:task.turnId, contextId:qa.contextId,
    itemId:qa.itemId, interruptId:qa.interruptId }
  const update = (key:string, patch:Partial<Draft>) => setDrafts(current => ({
    ...current, [key]:{ ...(current[key] ?? blank()), ...patch },
  }))
  async function request(action:string, payload:any) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await onAction(action, { ...target, ...payload })
      if (!result?.ok) throw new Error(result?.message || '操作未完成，请重试')
      if (alive.current && result.message) setNotice(result.message)
      return result
    } catch (reason:any) { if (alive.current) setError(reason.message || '操作未完成，请重试') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  async function submit(payload:any) {
    const result = await request('qa-answer', { picks:[], custom:'', attachmentIds:[], ...payload })
    if (result?.ok && alive.current) {
      // An HTTP acknowledgement alone is not a resolution. Keep the actual pending card and drafts.
      if (result.resolved) setNotice('已发送，等待 Matter 更新')
    }
  }
  function submitPages() {
    if (pages.every((page:any) => page.page_id)) {
      const pageAnswers = pages.map((page:any, index:number) => {
        const draft = drafts[pageKey(page,index)] ?? blank()
        return { page_id:page.page_id, picks:draft.picks, text:draft.text.trim(),
          attachment_ids:draft.attachments.map(file => file.id),
          skipped:draft.skipped || !(draft.picks.length || draft.text.trim() || draft.attachments.length) }
      })
      void submit({ pageAnswers })
    } else void submit({ answers:pages.map((page:any,index:number) => {
      const draft = drafts[pageKey(page,index)] ?? blank()
      return draft.text.trim() || draft.picks.map(pick => page.options.find((option:any) => option.key === pick)?.label || '').join('、')
    }) })
  }
  const index = Math.min(pageIndex, Math.max(0,pages.length-1))
  const definition = pages[index] ?? spec
  const description = (definition.desc || '').trim()
  const questionDescription = description.replace(/\s+/gu,' ') === definition.q.trim().replace(/\s+/gu,' ') ? '' : description
  const key = pages.length ? pageKey(definition,index) : 'single'
  const current = drafts[key] ?? blank()
  const customInput = !!definition.options.length && acceptsInput(definition)
  const inputPicks = (draft:Draft) => definition.variant !== 'single' && definition.selection_required ? draft.picks : draft.picks.filter(pick =>
    definition.options.some((option:any) => option.key === pick && option.action === 'await_user_input'))
  const inputSelected = !!(current.text.trim() || current.attachments.length || current.picks.some(pick =>
    definition.options.some((option:any) => option.key === pick && option.action === 'await_user_input')))
  const showInput = !definition.options.length || customInput || editing[key]
  const canAttach = definition.input_mode !== 'text' && definition.max_attachments > 0
  const atLast = index >= pages.length-1
  const multiPage = pages.length > 1
  const answered = pages.length ? pages.some((page:any,i:number) => hasAnswer(drafts[pageKey(page,i)] ?? blank())) : hasAnswer(current)
  const showAction = (multiPage && !atLast) || answered || spec.skippable
  const actionLabel = multiPage ? (!atLast ? '下一个' : answered ? '提交' : '跳过') : answered ? '发送' : '跳过'
  function openInput(pick?:string) {
    update(key,{ picks:pick ? [pick] : [], skipped:false })
    setEditing(saved => ({...saved,[key]:true}))
  }
  function pickOption(option:any) {
    if (busy) return
    if (option.action === 'await_user_input') { openInput(option.key); return }
    const picks = definition.variant === 'multi'
      ? current.picks.includes(option.key) ? current.picks.filter(pick => pick !== option.key) : [...current.picks,option.key]
      : current.picks[0] === option.key ? [] : [option.key]
    update(key,{ ...blank(),picks })
    setEditing(saved => ({...saved,[key]:false}))
  }
  const simpleConfirm = spec.variant === 'confirm' && spec.options.length > 0 && spec.options.length <= 3
    && !pages.length && !acceptsInput(spec)
  const app = () => { void onAction('open-conversation', { conversationId:task.conversationId, turnId:task.turnId })
    .catch((reason:any) => { if (alive.current) setError(reason.message || '无法打开 Matter') }) }
  const context = spec.require_read ? <Button variant="ghost" onClick={app}>在 Matter 查看相关文档</Button> : undefined
  async function attach() {
    const scope = key
    const result = await request('qa-upload', {})
    if (result?.attachments?.length && alive.current) setDrafts(saved => {
      const draft = saved[scope] ?? blank()
      const files = new Map([...draft.attachments,...result.attachments].map(file => [file.id,file]))
      return { ...saved, [scope]:{ ...draft, attachments:[...files.values()],
        ...(customInput ? {picks:inputPicks(draft)} : {}) } }
    })
  }
  function advance(fromInput = false) {
    // Empty Enter is never an implicit skip. Skipping requires the explicit QA action.
    if (busy || pending.current || !showAction || (fromInput && !hasAnswer(current))) return
    if (multiPage && !atLast) { setPageIndex(index+1); return }
    if (pages.length) submitPages()
    else void submit({ picks:current.picks, custom:current.text.trim(),
      attachmentIds:current.attachments.map(file => file.id), skipped:!hasAnswer(current) })
  }
  if (qa.reviewInApp) return <div className="pet-review">
    <div>{spec.q}</div><p>{spec.await_kind ? '请在 Matter 中完成外部授权。' : '此确认包含文档编辑，请在 Matter 中完成。'}</p>
    <Button variant="contrast" shape="pill" onClick={app}>在 Matter 中处理</Button>
    {error && <div className="pet-error" role="alert">{error}</div>}
  </div>
  return <div className={'pet-question' + (simpleConfirm ? ' pet-confirm' : '')} aria-busy={busy}
    onPointerDownCapture={onFocus}>
    {simpleConfirm ? <>
      <div className="pet-question-title" title={spec.q}>{spec.q}</div>
      {questionDescription && <div className="pet-question-desc" title={questionDescription}>{questionDescription}</div>}
      {context}
      <div className="pet-confirm-actions">{spec.options.map((option:any,index:number) => <Button
        key={option.key} variant={option.danger ? 'danger' : index === spec.options.length-1 ? 'contrast' : 'soft'}
        shape="pill" size="md" disabled={busy} onClick={() => submit({ picks:[option.key] })}>{option.label}</Button>)}</div>
    </> : <>
      <header className="pet-question-heading">
        <div className="pet-question-title" title={definition.q}>{definition.q}</div>
        {multiPage && <span className="pet-page-count">{index+1}/{pages.length}</span>}
      </header>
      {questionDescription && <div className="pet-question-desc" title={questionDescription}>{questionDescription}</div>}
      {context}
      {definition.history && <section className="pet-history" aria-label="历史回答参考">
        <div>历史回答参考</div><div>{definition.history.question}</div><div>{definition.history.answer}</div>
        {!definition.history.can_reuse && <div>仅供参考，请回答当前问题</div>}
      </section>}
      {!!definition.options.length && <div className={'pet-options'+(definition.variant === 'multi' ? ' pet-options-multi' : '')}>{definition.options.map((option:any) =>
        <button type="button" key={option.key} className={'pet-option'+(option.danger ? ' danger' : '')}
          title={[option.label,option.sub,option.tag || (option.recommended ? '推荐' : '')].filter(Boolean).join(' · ')}
          disabled={busy} aria-pressed={current.picks.includes(option.key)} onClick={() => pickOption(option)}>
          <span className="pet-option-mark" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L4.5 8.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg></span><span className="pet-option-label">{option.label}
            {option.sub && <span className="pet-option-sub"> · {option.sub}</span>}</span>
          {(option.recommended || option.tag) && <span className="pet-option-tag">{option.tag || '推荐'}</span>}
        </button>)}</div>}
      {showInput && <div className={'pet-answer'+(customInput ? ' pet-answer-custom' : '')} key={key}>
        <label className={customInput ? 'pet-custom-input'+(inputSelected ? ' is-filled' : '') : undefined}
          onFocus={customInput && definition.variant === 'single'
            ? () => update(key,{picks:inputPicks(current),skipped:false}) : undefined}>
          {customInput && <>
            <span className="pet-custom-mark" aria-hidden="true"><span className="pet-custom-icon"
              style={{maskImage:`url(${JSON.stringify(editIcon)})`,WebkitMaskImage:`url(${JSON.stringify(editIcon)})`}}/></span>
            <span className="pet-input-label">其他我来说明</span>
          </>}
          <ChatInput value={current.text} onChange={text => update(key,{text,skipped:false,
            ...(customInput ? {picks:inputPicks(current)} : {})})}
            onSubmit={() => advance(true)}
            placeholder={customInput ? '其他我来说明' : definition.input_mode === 'files' ? '请添加相关文件，可补充说明' : '请直接回答'}
            autoFocus={!!editing[key]} preventAutoFocusScroll maxRows={1} disabled={busy} style={{lineHeight:'20px'}}/>
        </label>
        {!!current.attachments.length && <div className="pet-attachments">{current.attachments.map(file =>
          <button key={file.id} disabled={busy} title="移除附件" onClick={() => update(key,
            { attachments:current.attachments.filter(candidate => candidate.id !== file.id) })}>{file.name} ×</button>)}</div>}
      </div>}
      <footer className="pet-qa-actions">
        <div className="pet-qa-tools">
          {multiPage && index > 0 && <Button variant="soft" shape="pill" disabled={busy}
            onClick={() => setPageIndex(index-1)}>上一题</Button>}
          {showInput && canAttach && <Button variant="soft" shape="pill" className="pet-attach" disabled={busy
            || current.attachments.length >= definition.max_attachments} onClick={attach}>添加附件</Button>}
        </div>
        {showAction && <Button variant={answered || (multiPage && !atLast) ? 'contrast' : 'soft'} shape="pill"
          className="pet-qa-go" disabled={busy} onClick={() => advance()}>{actionLabel}</Button>}
      </footer>
    </>}
    {busy && <div className="pet-status" role="status">正在提交…</div>}
    {error && <div className="pet-error" role="alert">{error}</div>}
    {notice && <div className="pet-status" role="status">{notice}</div>}
  </div>
}

export function createQaView(element:HTMLElement, css:string, callbacks:any) {
  const shadow = element.attachShadow({mode:'open'})
  const style = document.createElement('style'); style.textContent = css
  const mount = document.createElement('div'); shadow.append(style,mount)
  const root = createRoot(mount)
  const media = matchMedia('(prefers-color-scheme:dark)')
  const theme = () => element.dataset.theme = media.matches ? 'dark' : 'light'
  theme(); media.addEventListener('change',theme)
  return {
    update(task:any) { root.render(<LocaleProvider><Question key={task.qa.contextId+':'+task.qa.itemId}
      task={task} {...callbacks}/></LocaleProvider>) },
    destroy() { root.unmount(); media.removeEventListener('change',theme) },
  }
}

export { createQuickChatView } from './quick-chat'
export { createRunningView } from './running'
