// Exercise visible desktop QA controls with actual Chromium mouse/keyboard input.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function probeQaUI(page, waitFor) {
  const evaluate = code => page.webContents.executeJavaScript(code)
  const root = `document.querySelector('.minduck-qa').shadowRoot`
  const frame = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  async function click(selector) {
    await evaluate(`${root}.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'});void 0`)
    await frame()
    const hit = await evaluate(`(() => {
      const s=${root},button=s.querySelector(${JSON.stringify(selector)}),r=button.getBoundingClientRect();
      const x=r.x+r.width/2,y=r.y+r.height/2;
      let visible=true,opacity=1;
      for(let e=button;e;e=e.parentElement || e.getRootNode().host){
        const c=getComputedStyle(e);opacity*=Number(c.opacity);
        visible=visible && c.display!=='none' && c.visibility==='visible' && c.pointerEvents!=='none';
      }
      const target=s.elementFromPoint(x,y),outer=document.elementFromPoint(x,y);
      return {x,y,visible,opacity,disabled:button.disabled,hit:!!target && (target===button || button.contains(target)),
        outer:outer===s.host,width:r.width,height:r.height};})()`)
    assert.ok(hit.visible && hit.opacity>.99 && !hit.disabled && hit.hit && hit.outer
      && hit.width>0 && hit.height>0,selector+': '+JSON.stringify(hit))
    await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:hit.x,y:hit.y,button:'none',buttons:0})
    for(const type of ['mousePressed','mouseReleased']) await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{
      type,x:hit.x,y:hit.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,
    })
    await frame()
  }
  let number = 0, task
  async function render(spec, extra = {}) {
    task = {active:true,status:'waiting',conversationId:'qa-conversation',turnId:'qa-turn',text:'等你回答',detail:spec.pages?.[0]?.q || spec.q,
      qa:{contextId:'qa-context',itemId:'qa-'+(++number),interruptId:'qa-interrupt',spec,reviewInApp:false,...extra}}
    await evaluate(`panelProbe.actions=[];panelProbe.targets=[];panelProbe.failure='';panelProbe.reply=null;
      panelProbe.output(${JSON.stringify(task)});void 0`)
    await waitFor(()=>evaluate(`${root}?.querySelector('.pet-question,.pet-review')?.textContent`),
      text=>text?.includes(spec.pages?.[0]?.q || spec.q),'desktop QA render')
    await frame()
  }
  const payload = () => evaluate('panelProbe.targets.at(-1)')
  const input = text => evaluate(`(() => {const field=${root}.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});
    field.dispatchEvent(new Event('input',{bubbles:true,composed:true}));field.focus();})()`)
  const label = () => evaluate(`${root}.querySelector('.pet-qa-go')?.textContent`)
  async function screenshot(name) {
    await frame()
    fs.writeFileSync(path.resolve(__dirname,'../build/companion-qa-'+name+'.png'),(await page.webContents.capturePage()).toPNG())
  }
  const options=[{key:'no',label:'取消'},{key:'yes',label:'允许 Figma'}]
  await render({variant:'confirm',q:'是否允许继续执行？',desc:'确认后，Matter 将继续当前任务',options,max_attachments:0})
  for(const width of [375,768,1024,1440]) for(const theme of ['light','dark']) {
    page.setContentSize(width,600)
    await page.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    await new Promise(resolve=>setTimeout(resolve,120))
    const state=await evaluate(`(() => {const card=document.querySelector('.minduck-output'),s=${root},r=card.getBoundingClientRect();
      const title=s.querySelector('.pet-question-title').getBoundingClientRect(),desc=s.querySelector('.pet-question-desc').getBoundingClientRect(),buttons=[...s.querySelectorAll('.pet-confirm-actions .b')].map(b=>b.getBoundingClientRect());
      return {theme:s.host.dataset.theme,width:r.width,height:r.height,font:getComputedStyle(s.querySelector('.b')).fontSize,
        overflow:document.documentElement.scrollWidth>innerWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
        paddingLeft:title.left-r.left,paddingTop:title.top-r.top,paddingBottom:r.bottom-buttons[0].bottom,
        titleHeight:title.height,descriptionHeight:desc.height,descriptionGap:desc.top-title.bottom,actionGap:buttons[0].top-desc.bottom,
        buttonHeight:buttons[0].height,gap:buttons[1].left-buttons[0].right,paddingRight:r.right-buttons[1].right};})()`)
    assert.equal(state.theme,theme);assert.equal(state.font,'14px');assert.equal(state.overflow,false)
    assert.equal(state.width,330)
    assert.equal(state.height,state.paddingTop+state.titleHeight+state.descriptionGap+state.descriptionHeight+state.actionGap+state.buttonHeight+state.paddingBottom,'card height follows its content and spacing')
    assert.equal(state.titleHeight,20);assert.equal(state.descriptionHeight,20);assert.equal(state.descriptionGap,8);assert.equal(state.actionGap,12)
    for(const [property,value] of Object.entries({paddingLeft:16,paddingTop:12,paddingBottom:12,buttonHeight:32,gap:12,paddingRight:16}))
      assert.ok(Math.abs(state[property]-value)<.02,property+': '+JSON.stringify(state))
    assert.ok(state.left>=16 && state.right<=width-15.99 && state.top>=16 && state.bottom<=600,JSON.stringify(state))
    if(width===768) await screenshot('confirm-'+theme)
  }
  await click('.pet-confirm-actions .b:last-child')
  await waitFor(()=>evaluate('panelProbe.actions.length'),value=>value===1,'confirm reply')
  assert.deepEqual((await payload()).picks,['yes'])
  assert.equal(await evaluate(`!!${root}.querySelector('.pet-confirm')`),true,'acknowledgement retains the pending card')

  for(const desc of [undefined,'  是否允许继续执行？ \n']) {
    await render({variant:'confirm',q:'是否允许继续执行？',desc,options,max_attachments:0})
    assert.equal(await evaluate(`${root}.querySelectorAll('.pet-question-desc').length`),0,'confirm never repeats the question as a description')
    assert.equal(await evaluate(`document.querySelector('.minduck-output').getBoundingClientRect().height`),12+20+12+32+12,'missing subtitle leaves no reserved row or minimum card height')
  }
  const choiceSpec={variant:'single',q:'你希望我怎么处理？',max_attachments:0,options:[
    {key:'direct',label:'直接帮我来完成',sub:'这一轮我就把它做完交给你。'},
    {key:'team',label:'交给专业团队来完成',sub:'组一支团队来做，以后同类的事都能交给它。'},
  ]}
  for(const theme of ['light','dark']) {
    await page.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    await render(choiceSpec)
    await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2,button:'none',buttons:0})
    await waitFor(()=>evaluate(`getComputedStyle(document.querySelector('.minduck-output')).boxShadow`),
      shadow=>shadow.endsWith((theme==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)')+' 0px 0px 0px 1px inset'),'QA theme transition finishes before hover comparison')
    const neutralShadow=await evaluate(`getComputedStyle(document.querySelector('.minduck-output')).boxShadow`)
    const hoverPoint=await evaluate(`(()=>{const r=${root}.querySelector('.pet-question-title').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
    await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint,button:'none',buttons:0})
    await new Promise(resolve=>setTimeout(resolve,180))
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.minduck-output')).boxShadow`),neutralShadow,'QA hover does not add an orange outline')
    await click('.pet-option:first-child')
    const selectedBackground=theme==='dark'?'rgb(28, 28, 30)':'rgb(240, 240, 240)'
    await waitFor(()=>evaluate(`getComputedStyle(${root}.querySelector('.pet-option')).backgroundColor`),
      color=>color===selectedBackground,'QA selection transition')
    for(const width of [375,768,1024,1440]) {
      page.setContentSize(width,600);await frame()
      const style=await evaluate(`(() => {const s=${root},rows=[...s.querySelectorAll('.pet-option')];
        return {titles:s.querySelectorAll('.pet-question-title').length,descriptions:s.querySelectorAll('.pet-question-desc').length,
          overflow:document.documentElement.scrollWidth>innerWidth,rows:rows.map(row=>{const label=row.querySelector('.pet-option-label'),mark=row.querySelector('.pet-option-mark'),r=row.getBoundingClientRect(),c=getComputedStyle(row),m=getComputedStyle(mark),t=getComputedStyle(label);
            return {height:r.height,background:c.backgroundColor,border:c.borderColor,radius:c.borderRadius,font:c.fontSize,
              labelHeight:label.getBoundingClientRect().height,ink:t.color,subInk:getComputedStyle(row.querySelector('.pet-option-sub')).color,
              whiteSpace:t.whiteSpace,overflow:t.overflow,ellipsis:t.textOverflow,clipped:label.scrollWidth>label.clientWidth,
              title:row.title,text:label.textContent,markWidth:mark.getBoundingClientRect().width,markRadius:m.borderRadius,markBg:m.backgroundColor,markInk:m.color,check:getComputedStyle(mark.querySelector('svg')).opacity};})};})()`)
      assert.equal(style.titles,1);assert.equal(style.descriptions,0,'task detail is the same question, not a second title')
      assert.equal(style.overflow,false)
      for(const row of style.rows){
        assert.equal(row.height,32);assert.ok(row.labelHeight<20);assert.equal(row.font,'14px')
        assert.equal(row.whiteSpace,'nowrap');assert.equal(row.overflow,'hidden');assert.equal(row.ellipsis,'ellipsis');assert.ok(row.clipped)
        assert.equal(row.subInk,row.ink,'option descriptions use the main QA label color')
        assert.equal(row.title,row.text);assert.equal(row.markWidth,20);assert.equal(row.markRadius,'50%')
      }
      const selected=style.rows[0],unselected=style.rows[1]
      assert.equal(selected.background,theme==='dark'?'rgb(28, 28, 30)':'rgb(240, 240, 240)')
      assert.equal(selected.border,'rgba(0, 0, 0, 0)','selection uses the main QA neutral capsule, without an orange border')
      assert.equal(selected.markBg,theme==='dark'?'rgb(255, 255, 255)':'rgb(13, 13, 13)')
      assert.equal(selected.markInk,theme==='dark'?'rgb(13, 13, 13)':'rgb(255, 255, 255)')
      assert.equal(selected.check,'1');assert.equal(unselected.check,'0')
    }
    page.setContentSize(375,600);await frame();await screenshot('choice-'+theme)
  }
  await render({...choiceSpec,desc:' 你希望我怎么处理？\n'})
  assert.equal(await evaluate(`${root}.querySelectorAll('.pet-question-desc').length`),0,'an explicit duplicate description is omitted')
  await render({...choiceSpec,desc:'请选择本次的处理方式'})
  assert.equal(await evaluate(`${root}.querySelector('.pet-question-desc').textContent`),'请选择本次的处理方式','distinct descriptions remain visible')

  await render({variant:'multiq',q:'确认竞品范围',options:[],max_attachments:0,pages:[
    {page_id:'spacing-a',q:'先确认问题范围',options:[],max_attachments:0},
    {page_id:'spacing-b',q:'具体要盯哪几家竞品？请把名字写出来。',desc:'有几家写几家；如果是你们内部常跟踪的固定名单，也可以直接填写。',options:[],max_attachments:0},
    {page_id:'spacing-c',q:'最后确认',options:[],max_attachments:0},
  ]})
  await click('.pet-qa-go')
  for(const width of [375,768,1024,1440]) for(const theme of ['light','dark']) {
    page.setContentSize(width,600)
    await page.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    await frame()
    const layout=await evaluate(`(()=>{const s=${root},r=document.querySelector('.minduck-output').getBoundingClientRect(),t=s.querySelector('.pet-question-title').getBoundingClientRect(),d=s.querySelector('.pet-question-desc').getBoundingClientRect(),f=s.querySelector('textarea').getBoundingClientRect(),a=s.querySelector('.pet-qa-actions').getBoundingClientRect();return {height:r.height,gap:d.top-t.bottom,inputGap:f.top-d.bottom,inputHeight:f.height,footerGap:a.top-f.bottom,bottom:r.bottom-a.bottom,count:s.querySelector('.pet-page-count').textContent,action:s.querySelector('.pet-qa-go').textContent,overflow:document.documentElement.scrollWidth>innerWidth};})()`)
    for(const key of Object.keys(layout)) if(typeof layout[key]==='number') layout[key]=Math.round(layout[key]*1000)/1000
    assert.deepEqual(layout,{height:12+20+8+20+12+32+12+32+12,gap:8,inputGap:12,inputHeight:32,footerGap:12,bottom:12,count:'2/3',action:'下一个',overflow:false})
    if(width===768) await screenshot('spaced-input-'+theme)
  }

  await render({variant:'single',q:'选择一项',options,max_attachments:0})
  assert.equal(await label(),undefined,'required empty answers have no skip action')
  await click('.pet-option')
  assert.equal(await evaluate('panelProbe.actions.length'),0,'selection alone is not submission')
  assert.equal(await label(),'发送');await click('.pet-qa-go')
  assert.deepEqual((await payload()).picks,['no'])
  await render({variant:'multi',q:'选择多项',options,max_attachments:0})
  await click('.pet-option:first-child');await click('.pet-option:nth-child(2)')
  assert.equal(await evaluate(`getComputedStyle(${root}.querySelector('.pet-option-mark')).borderRadius`),'6px','multi-select uses the main QA checkbox shape')
  await click('.pet-qa-go')
  assert.deepEqual((await payload()).picks,['no','yes'])
  await render({variant:'single',q:'可以跳过的问题',options:[],custom:true,skippable:true,max_attachments:0})
  assert.equal(await label(),'跳过')
  await evaluate(`${root}.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));void 0`)
  assert.equal(await evaluate('panelProbe.actions.length'),0,'empty Enter never skips')
  await click('.pet-qa-go');assert.equal((await payload()).skipped,true)

  await render({variant:'single',q:'请输入补充说明',options:[],custom:true,input_mode:'text_or_files',max_attachments:3})
  assert.equal(await evaluate(`${root}.querySelectorAll('textarea').length`),1,'open answer is immediately inline')
  await input('长回答\n'.repeat(15));await frame()
  const longInput=await evaluate(`(()=>{const f=${root}.querySelector('textarea');return {height:f.getBoundingClientRect().height,scroll:f.scrollHeight>f.clientHeight,overflow:getComputedStyle(f).overflowY};})()`)
  assert.deepEqual(longInput,{height:32,scroll:true,overflow:'auto'},'long answers scroll inside the same option-height capsule')
  await input('输入法与草稿 123')
  await evaluate(`${root}.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',
    {key:'Enter',code:'Enter',bubbles:true,composed:true,isComposing:true}));
    ${root}.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',
    {key:'Enter',code:'Enter',bubbles:true,composed:true,shiftKey:true}));void 0`)
  assert.equal(await evaluate('panelProbe.actions.length'),0,'IME and Shift+Enter do not submit')
  await evaluate(`panelProbe.failure='测试提交失败，请重试'`)
  await click('.pet-qa-go')
  await waitFor(()=>evaluate(`${root}.querySelector('[role=alert]')?.textContent`),text=>text?.includes('测试提交失败'),'visible request error')
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'输入法与草稿 123')
  task.detail='新的进度，但同一个问题'
  await evaluate(`panelProbe.output(${JSON.stringify(task)});panelProbe.failure='';
    panelProbe.reply={ok:true,attachments:[{id:'file-one',name:'说明.txt'}]};void 0`)
  await click('.pet-attach')
  await waitFor(()=>evaluate(`${root}.querySelector('.pet-attachments')?.textContent`),text=>text?.includes('说明.txt'),'attachment in question')
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'输入法与草稿 123','progress preserves the draft')
  for(const theme of ['light','dark']) {
    await page.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    for(const width of [375,768,1024,1440]) {
      page.setContentSize(width,600);await frame()
      await click('textarea')
      await waitFor(()=>evaluate(`getComputedStyle(document.querySelector('.minduck-output')).boxShadow`),
        shadow=>!shadow.includes('255, 154, 46') && !shadow.includes('255, 149, 0'),'focused input has no orange outer card ring')
      const layout=await evaluate(`(() => {const s=${root},card=document.querySelector('.minduck-output').getBoundingClientRect(),field=s.querySelector('textarea').getBoundingClientRect(),go=s.querySelector('.pet-qa-go').getBoundingClientRect();
        const f=getComputedStyle(s.querySelector('textarea')),q=getComputedStyle(s.querySelector('.pet-question'));
        return {inside:field.left>=card.left+15.95 && field.right<=card.right-15.95,above:field.bottom<go.top,buttons:s.querySelectorAll('.pet-qa-go').length,
          inputHeight:field.height,radius:parseFloat(f.borderRadius),outline:f.outlineStyle,shadow:f.boxShadow,
          padding:[q.paddingTop,q.paddingRight,q.paddingBottom,q.paddingLeft],
          bottom:card.bottom-go.bottom,right:card.right-go.right,overflow:document.documentElement.scrollWidth>innerWidth};})()`)
      assert.ok(layout.inside && layout.above && !layout.overflow,JSON.stringify(layout));assert.equal(layout.buttons,1)
      assert.equal(layout.inputHeight,32);assert.ok(layout.radius>=16)
      assert.equal(layout.outline,'none');assert.equal(layout.shadow,'none')
      assert.deepEqual(layout.padding,['12px','16px','12px','16px'])
      assert.ok(Math.abs(layout.right-16)<.05)
      await click('.pet-qa-go')
    }
    await click('textarea');await new Promise(resolve=>setTimeout(resolve,180));await screenshot('input-'+theme)
  }
  await evaluate('panelProbe.actions=[];panelProbe.targets=[];panelProbe.reply={ok:true,resolved:false};panelProbe.pause=true')
  await evaluate(`${root}.querySelector('textarea').focus();void 0`)
  await page.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await page.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await waitFor(()=>evaluate('panelProbe.actions.length'),value=>value===1,'real keyboard reply')
  assert.equal(await evaluate(`${root}.querySelector('textarea').disabled && ${root}.querySelector('.pet-qa-go').disabled`),true)
  assert.deepEqual((await payload()).attachmentIds,['file-one']);assert.equal((await payload()).custom,'输入法与草稿 123')
  await evaluate('panelProbe.pause=false;panelProbe.release();void 0')

  await render({variant:'single',q:'自定义选项',options:[{key:'supplement',label:'补充说明',action:'await_user_input'}],custom:true,max_attachments:0})
  await click('.pet-option');await input('保留所选方向');await click('.pet-qa-go')
  assert.deepEqual((await payload()).picks,['supplement']);assert.equal((await payload()).custom,'保留所选方向')
  assert.equal(await evaluate(`${root}.querySelectorAll('.pet-custom-input').length`),1,'one inline custom input replaces the separate text entry')

  await render({variant:'single',q:'请选择上线重点',options:[
    {key:'team',label:'内部对齐，各部门都准备好',sub:'重点是内部协作'},
    {key:'sales',label:'直接拉动首月销量',sub:'重点是转化与成交'},
  ],custom:true,max_attachments:0})
  for(const theme of ['light','dark']) for(const width of [375,768,1024,1440]) {
    page.setContentSize(width,600)
    await page.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    await frame();await click('.pet-custom-input')
    const layout=await evaluate(`(()=>{const s=${root},row=s.querySelector('.pet-option'),custom=s.querySelector('.pet-custom-input'),input=custom.querySelector('textarea'),mark=custom.querySelector('.pet-custom-mark'),icon=custom.querySelector('.pet-custom-icon'),a=row.getBoundingClientRect(),b=custom.getBoundingClientRect(),f=input.getBoundingClientRect(),i=icon.getBoundingClientRect(),c=getComputedStyle(custom);return {width:b.width,height:b.height,optionWidth:a.width,optionHeight:a.height,gap:b.top-s.querySelector('.pet-option:last-child').getBoundingClientRect().bottom,markOffset:mark.getBoundingClientRect().left-b.left,optionMarkOffset:row.querySelector('.pet-option-mark').getBoundingClientRect().left-a.left,icon:[i.width,i.height],mask:getComputedStyle(icon).maskImage.includes('data:image/svg+xml'),inputHeight:f.height,placeholder:input.placeholder,focused:s.activeElement===input,outline:getComputedStyle(input).outlineStyle,radius:parseFloat(c.borderRadius),background:c.backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};})()`)
    for(const key of ['width','height','optionWidth','optionHeight','gap','markOffset','optionMarkOffset','inputHeight']) layout[key]=Math.round(layout[key]*1000)/1000
    assert.equal(layout.width,layout.optionWidth);assert.equal(layout.height,layout.optionHeight);assert.equal(layout.height,32)
    assert.equal(layout.gap,8);assert.equal(layout.markOffset,layout.optionMarkOffset);assert.deepEqual(layout.icon,[12,12]);assert.equal(layout.mask,true)
    assert.equal(layout.inputHeight,32);assert.equal(layout.placeholder,'其他我来说明');assert.equal(layout.focused,true);assert.equal(layout.outline,'none');assert.ok(layout.radius>=16);assert.equal(layout.overflow,false)
    assert.equal(layout.background,theme==='dark'?'rgb(28, 28, 30)':'rgb(240, 240, 240)')
    if(width===768) await screenshot('custom-input-'+theme)
  }
  await click('.pet-option')
  await click('.pet-custom-input')
  assert.equal(await evaluate(`${root}.querySelectorAll('.pet-option[aria-pressed="true"]').length`),0,'focusing other clears the ordinary single selection before typing')
  await page.webContents.debugger.sendCommand('Input.insertText',{text:'其他方向，先做小范围验证'})
  await frame()
  assert.equal(await evaluate(`${root}.querySelectorAll('.pet-option[aria-pressed="true"]').length`),0,'typing another answer clears ordinary selections')
  await click('.pet-qa-go')
  assert.deepEqual((await payload()).picks,[]);assert.equal((await payload()).custom,'其他方向，先做小范围验证')
  await click('.pet-option:last-child')
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'','selecting an ordinary option clears the custom answer')
  await click('.pet-qa-go')
  assert.deepEqual((await payload()).picks,['sales']);assert.equal((await payload()).custom,'')

  await render({variant:'single',q:'选择一个回答',options,custom:true,selection_required:true,max_attachments:0})
  await click('.pet-option');await click('.pet-custom-input')
  assert.equal(await evaluate(`${root}.querySelectorAll('.pet-option[aria-pressed="true"]').length`),0,'required single choice also switches on focus')
  await input('我选择其他方向');await click('.pet-qa-go')
  assert.deepEqual((await payload()).picks,[]);assert.equal((await payload()).custom,'我选择其他方向','custom answer replaces a required ordinary single choice')
  await click('.pet-option');await click('.pet-qa-go')
  assert.deepEqual((await payload()).picks,['no']);assert.equal((await payload()).custom,'','ordinary single choice replaces the custom answer')

  for(const required of [false,true]) {
    await render({variant:'single',q:'选择或上传补充',options,custom:true,selection_required:required,input_mode:'text_or_files',max_attachments:3})
    await click('.pet-option')
    await evaluate("panelProbe.reply={ok:true,attachments:[{id:'custom-file',name:'补充.txt'}]};void 0")
    await click('.pet-attach')
    await waitFor(()=>evaluate(`${root}.querySelector('.pet-attachments')?.textContent`),text=>text?.includes('补充.txt'),'custom attachment in question')
    await evaluate('panelProbe.reply=null;void 0');await click('.pet-qa-go')
    assert.deepEqual((await payload()).picks,[],'custom uploads replace ordinary single choices regardless of selection_required')
    assert.deepEqual((await payload()).attachmentIds,['custom-file'])
    await click('.pet-option');await click('.pet-qa-go')
    assert.deepEqual((await payload()).picks,['no']);assert.deepEqual((await payload()).attachmentIds,[],'ordinary choice clears custom attachments')
  }

  await render({variant:'multi',q:'选择并补充说明',options,custom:true,selection_required:true,max_attachments:0})
  await click('.pet-option');await click('.pet-custom-input');await input('多选补充说明');await click('.pet-qa-go')
  assert.deepEqual((await payload()).picks,['no']);assert.equal((await payload()).custom,'多选补充说明','multi-choice keeps its existing supplementary input semantics')

  const pages=[{page_id:'page-a',variant:'single',q:'第一题',options,custom:true,selection_required:true,max_attachments:0},
    {page_id:'page-b',variant:'single',q:'第二题',options:[],custom:true,max_attachments:0}]
  await render({variant:'multiq',q:'逐题确认',options:[],pages,max_attachments:0})
  assert.equal(await label(),'下一个');await click('.pet-option');await click('.pet-custom-input');await input('第一题输入')
  await click('.pet-qa-go')
  assert.equal(await evaluate('panelProbe.actions.length'),0,'next saves locally without POST')
  assert.equal(await label(),'提交');assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'')
  await input('第二题的独立回答')
  await click('.pet-qa-tools .b:first-child')
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'第一题输入','previous restores inline draft')
  assert.equal(await evaluate(`${root}.querySelectorAll('.pet-option[aria-pressed="true"]').length`),0,'page drafts restore only the chosen custom answer')
  await click('.pet-option:first-child');await click('.pet-qa-go')
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'第二题的独立回答')
  await screenshot('pages')
  task.qa.spec.pages=[...pages].reverse()
  await evaluate(`panelProbe.output(${JSON.stringify(task)});void 0`);await frame()
  assert.equal(await evaluate(`${root}.querySelector('.pet-question-title').textContent`),'第一题')
  await click('.pet-qa-go')
  const replies=(await payload()).pageAnswers
  assert.equal(replies.find(answer=>answer.page_id==='page-a').picks[0],'no')
  assert.equal(replies.find(answer=>answer.page_id==='page-b').text,'第二题的独立回答')
  await render({variant:'multiq',q:'允许全跳过',options:[],pages,skippable:true,max_attachments:0})
  await click('.pet-qa-go');assert.equal(await label(),'跳过');await click('.pet-qa-go')
  assert.ok((await payload()).pageAnswers.every(answer=>answer.skipped))

  await render({variant:'confirm',q:'审阅修改过的文档',options,max_attachments:0},{reviewInApp:true})
  await click('.pet-review .b')
  assert.equal(await evaluate('panelProbe.actions[0]'),'open-conversation')
  assert.equal((await payload()).conversationId,'qa-conversation')
  await render({variant:'single',q:'长选项列表',options:Array.from({length:30},(_,i)=>({key:'key-'+i,label:'选项 '+i+'：'+'长内容'.repeat(8)})),max_attachments:0})
  page.setContentSize(375,600);await frame();await click('.pet-option')
  const scrolling=await evaluate(`(() => {const content=document.querySelector('.minduck-content');return content.scrollHeight>content.clientHeight;})()`)
  assert.ok(scrolling,'long cards scroll inside the capsule');await click('.pet-qa-go')
  assert.equal((await payload()).picks[0],'key-0');await screenshot('options')

  const point=await evaluate(`(() => {const r=document.querySelector('.minduck-output').getBoundingClientRect();return {x:r.x+8,y:r.y+8};})()`)
  await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none',buttons:0})
  await waitFor(()=>evaluate(`getComputedStyle(document.querySelector('.minduck-close')).opacity`),value=>value==='1','hover close')
  assert.equal(await evaluate(`document.elementFromPoint(${point.x},${point.y}).classList.contains('minduck-close')`),true)
  for(const type of ['mousePressed','mouseReleased']) await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{
    type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,
  })
  await waitFor(()=>evaluate(`document.querySelector('.minduck-outputs').hidden`),Boolean,'close only this hint')
  await evaluate(`panelProbe.output(${JSON.stringify(task)});void 0`)
  assert.equal(await evaluate(`document.querySelector('.minduck-outputs').hidden`),true)
  await render({variant:'confirm',q:'下一条新问题',options,max_attachments:0})
  await waitFor(()=>evaluate(`!document.querySelector('.minduck-outputs').hidden`),Boolean,'next question appears')
  const nextTask={...task,conversationId:'qa-next-conversation',turnId:'qa-next-turn',
    qa:{...task.qa,itemId:'qa-next-item',interruptId:'qa-next-interrupt',
      spec:{variant:'single',q:'第二个待处理问题',options:[],custom:true,max_attachments:0}}}
  await evaluate(`panelProbe.output(${JSON.stringify({...task,tasks:[task,nextTask],notificationCount:2})});void 0`)
  await waitFor(()=>evaluate(`document.querySelector('.minduck-outputs').dataset.messageCount`),count=>count==='2','two actionable questions queued')
  const close=await evaluate(`(() => {const r=document.querySelector('.minduck-close').getBoundingClientRect();return {x:r.x+8,y:r.y+8};})()`)
  await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...close,button:'none',buttons:0})
  await waitFor(()=>evaluate(`getComputedStyle(document.querySelector('.minduck-close')).opacity`),value=>value==='1','QA queue close visible')
  for(const type of ['mousePressed','mouseReleased'])await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{
    type,...close,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})
  await waitFor(()=>evaluate(`${root}.querySelector('.pet-question-title')?.textContent`),text=>text===nextTask.qa.spec.q,'next full QA renders inside the pet')
  assert.equal(await evaluate(`document.querySelector('.minduck-notification-badge').textContent`),'2','dismissal never clears backend notifications')
  await input('回答第二个问题');await click('.pet-qa-go')
  assert.equal((await payload()).conversationId,nextTask.conversationId)
  assert.equal((await payload()).turnId,nextTask.turnId);assert.equal((await payload()).itemId,nextTask.qa.itemId)
  assert.equal((await payload()).custom,'回答第二个问题')
  assert.equal(await evaluate('panelProbe.actions.length'),1,'closing a hint sends no task cancellation or QA answer')
  assert.deepEqual(await evaluate('panelProbe.errors'),[])
  console.log('PASS: stacked close-to-next QA keeps independent conversation/turn/item answers and notification counts; one title, single-line ellipsis options, neutral selection/check marks, inline input, one footer, exact SVG spacing, next/send/submit/skip, drafts, IME, attachments, busy/errors, review route, real visible mouse/keyboard and long-card scrolling; 4 widths × light/dark')
}
