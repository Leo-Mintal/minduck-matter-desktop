// Pure, bounded contract shared with Matter's isolated monitor. Never project credentials or tools.
function createQaContract() {
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/u.test(value)
  const key = value => typeof value === 'string' && value.length > 0 && value.length <= 500
    && !/[\u0000-\u001f]/u.test(value)
  const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : ''
  const keys = value => Array.isArray(value) && value.length <= 40 && value.every(key)
    ? [...new Set(value)] : null
  function spec(value, nested = false) {
    if (!value || !['confirm', 'single', 'multi', 'multiq'].includes(value.variant)) return null
    const options = (Array.isArray(value.options) ? value.options : []).slice(0, 40)
      .filter(option => key(option?.key)).map(option => ({ key: option.key, label: text(option.label, 500),
        sub: text(option.sub, 300), tag: text(option.tag, 100), recommended: option.recommended === true,
        danger: option.danger === true, action: option.action === 'await_user_input' ? option.action : '' }))
    const result = { variant: value.variant, q: text(value.q), desc: text(value.desc), options,
      custom: value.custom === true, custom_label: text(value.custom_label, 100), skippable: value.skippable === true,
      input_mode: ['confirm', 'text', 'files', 'text_or_files'].includes(value.input_mode) ? value.input_mode : '',
      selection_required: typeof value.selection_required === 'boolean' ? value.selection_required
        : value.input_mode === 'confirm' || value.variant === 'confirm',
      min_attachments: Number.isSafeInteger(value.min_attachments) ? Math.max(0, value.min_attachments) : 0,
      max_attachments: Number.isSafeInteger(value.max_attachments) && value.max_attachments >= 0
        ? Math.min(value.max_attachments, 20) : 20,
      require_read: text(value.require_read, 200), await_kind: text(value.await_kind, 100) }
    if (key(value.page_id)) result.page_id = value.page_id
    if (value.history) result.history = { question: text(value.history.question), answer: text(value.history.answer),
      can_reuse: value.history.can_reuse === true }
    if (!nested && Array.isArray(value.pages)) result.pages = value.pages.slice(0, 20)
      .map(page => spec(page, true)).filter(Boolean)
    return result
  }
  function project(value) {
    if (!id(value?.contextId) || !id(value?.itemId) || !key(value?.interruptId)) return null
    const projected = spec(value.spec)
    return projected ? { contextId: value.contextId, itemId: value.itemId, interruptId: value.interruptId,
      spec: projected, reviewInApp: value.reviewInApp === true } : null
  }
  function target(value, command) {
    if (!id(value?.conversationId) || !id(value?.turnId) || !project({ ...value, spec: { variant:'confirm' } })) {
      throw new Error('Invalid Matter QA target')
    }
    const result = { conversationId: value.conversationId, turnId: value.turnId,
      contextId: value.contextId, itemId: value.itemId, interruptId: value.interruptId }
    if (command === 'upload') return result
    if (command !== 'answer') throw new Error('Unsupported Matter QA command')
    const picks = keys(value.picks ?? []), attachmentIds = keys(value.attachmentIds ?? [])
    if (!picks || !attachmentIds || typeof (value.custom ?? '') !== 'string' || (value.custom ?? '').length > 20000) {
      throw new Error('Invalid Matter QA answer')
    }
    Object.assign(result, { picks, custom: value.custom ?? '', attachmentIds, skipped: value.skipped === true })
    if (value.pageAnswers != null) {
      if (!Array.isArray(value.pageAnswers) || value.pageAnswers.length > 20) throw new Error('Invalid QA pages')
      result.pageAnswers = value.pageAnswers.map(page => {
        const pagePicks = keys(page?.picks ?? []), attachments = keys(page?.attachment_ids ?? [])
        if (!key(page?.page_id) || !pagePicks || !attachments || typeof page.text !== 'string' || page.text.length > 20000) {
          throw new Error('Invalid QA page answer')
        }
        return { page_id: page.page_id, picks: pagePicks, text: page.text,
          attachment_ids: attachments, skipped: page.skipped === true }
      })
    }
    if (value.answers != null) {
      if (!Array.isArray(value.answers) || value.answers.length > 20
        || value.answers.some(answer => typeof answer !== 'string' || answer.length > 20000)) throw new Error('Invalid QA answers')
      result.answers = value.answers
    }
    return result
  }
  function validateAnswer(question, answer, uploaded) {
    if (question.reviewInApp) throw new Error('请在 Matter 中处理这条确认')
    function check(definition, picks, custom, attachments, skipped) {
      if (picks.some(pick => !definition.options.some(option => option.key === pick))) throw new Error('选项已更新，请重新选择')
      if (definition.variant !== 'multi' && picks.length > 1) throw new Error('这道问题只能选择一项')
      const acceptsInput = definition.custom || ['text', 'files', 'text_or_files'].includes(definition.input_mode)
        || definition.options.some(option => option.action === 'await_user_input') || !definition.options.length
      if ((custom || attachments.length) && !acceptsInput) throw new Error('这道问题不接受补充输入')
      const singleInput = definition.variant === 'single' && !!(custom.trim() || attachments.length)
      if (singleInput && picks.some(pick => definition.options.some(option => option.key === pick && option.action !== 'await_user_input'))) {
        throw new Error('单选题的选项和其他说明只能选择一项')
      }
      if (attachments.length > definition.max_attachments || attachments.some(attachment => !uploaded.has(attachment))) {
        throw new Error('附件已失效或超过数量上限，请重新上传')
      }
      if (skipped && !definition.skippable) throw new Error('这道问题不能跳过')
      if (!skipped && definition.selection_required && definition.options.length && !picks.length && !singleInput) {
        throw new Error('请先选择一个选项')
      }
      if (!picks.length && !custom.trim() && !attachments.length && !skipped) throw new Error('请先填写回答')
    }
    const pages = question.spec.pages ?? []
    if (!pages.length) check(question.spec, answer.picks, answer.custom, answer.attachmentIds, answer.skipped)
    else if (pages.every(page => page.page_id)) {
      if (answer.pageAnswers?.length !== pages.length || new Set(answer.pageAnswers.map(page => page.page_id)).size !== pages.length) {
        throw new Error('问题已更新，请重新作答')
      }
      for (const page of pages) {
        const draft = answer.pageAnswers.find(candidate => candidate.page_id === page.page_id)
        if (!draft) throw new Error('问题已更新，请重新作答')
        // The original QA contract explicitly skips unanswered pages within an answered multi-question card.
        check({ ...page, skippable:true }, draft.picks, draft.text, draft.attachment_ids, draft.skipped)
      }
      if (!answer.pageAnswers.some(page => page.picks.length || page.text.trim() || page.attachment_ids.length)
        && !question.spec.skippable) throw new Error('请至少回答一个问题')
    } else {
      if (answer.answers?.length !== pages.length) throw new Error('问题已更新，请重新作答')
      if (!answer.answers.some(value => value.trim()) && !question.spec.skippable) throw new Error('请至少回答一个问题')
    }
    return { item_id: question.itemId, picks: answer.picks, custom: answer.custom, skipped: answer.skipped,
      ...(answer.attachmentIds.length ? { attachment_ids:answer.attachmentIds } : {}),
      ...(answer.pageAnswers ? { page_answers:answer.pageAnswers } : {}),
      ...(answer.answers ? { answers:answer.answers } : {}) }
  }
  function chatTarget(value, command) {
    if (command === 'context') return {}
    if (!id(value?.contextId)) throw new Error('请重新打开桌宠输入框')
    const result = { contextId:value.contextId }
    if (command === 'queue' || command === 'stop' || value.conversationId != null || value.turnId != null) {
      if (!id(value.conversationId) || !id(value.turnId)) throw new Error('任务已更新，请等待消息刷新')
      Object.assign(result, { conversationId:value.conversationId, turnId:value.turnId })
    }
    if (command === 'stop') return result
    if (command === 'upload') return result
    const attachmentIds = keys(value?.attachmentIds ?? [])
    if (!['send','queue'].includes(command) || command === 'send' && result.conversationId
      || typeof value.text !== 'string' || value.text.length > 20000
      || !attachmentIds || attachmentIds.length > 20 || !(value.text.trim() || attachmentIds.length)) {
      throw new Error('请填写不超过 20000 字的消息')
    }
    return { ...result, text:value.text.trim(), attachmentIds }
  }
  return { project, target, validateAnswer, chatTarget }
}

module.exports = { createQaContract }
