// Verify the desktop chrome on the real pet page and figure without taking the user's focus.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')

const desktopFixture = `
  window.panelProbe = { interactive: false, layout: null, errors: [], actions: [], targets: [] };
  window.petHost = {
    setInteractive(on) { panelProbe.interactive = on; },
    setLanguage() {}, focus() {}, grabFocus() {}, releaseFocus() {},
    matterAction: async (action, target) => {
      panelProbe.actions.push(action); panelProbe.targets.push(target);
      if (panelProbe.pause) await new Promise(resolve => {panelProbe.release=resolve});
      if (panelProbe.failure) throw new Error(panelProbe.failure);
      return panelProbe.reply || (action === 'chat-context' ? {ok:true,contextId:'quick-context'}
        : action === 'chat-send' ? {ok:true,conversationId:'quick-created'} : {ok:true,resolved:false});
    },
    onMatterOutput(callback) { panelProbe.output = callback; },
    onCursor(callback) { panelProbe.cursor = callback; },
    sampleBackdrop: async () => null, followCursor: async () => null,
  };
  // A preview must not take over the real desktop pet's window connection.
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(value) {
      const url = new URL(value); url.searchParams.set('host', 'tab'); super(url);
    }
  };
  addEventListener('message', event => {
    if (event.data?.t === 'frame') panelProbe.layout = event.data.layout;
  });
  addEventListener('error', event => panelProbe.errors.push(event.message));
`;

const moveMouse = (page, x, y) => page.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
  type: 'mouseMoved', x, y, button: 'none', buttons: 0,
})
const setTask = (page, active, notificationCount = 0) => page.webContents.executeJavaScript(`panelProbe.output({active:${active}, notificationCount:${notificationCount},
  status:'running', contextId:'quick-context', conversationId:'conv-current', turnId:'turn-current', text:'小鸭子们开始工作啦', detail:'正在思考…'})`)

async function probeActionPaths(page) {
  for (const [index, side] of ['left', 'right'].entries()) {
    const hit = await page.webContents.executeJavaScript('panelProbe.layout.hit[0]')
    await moveMouse(page, hit.x, hit.y)
    const geometry = await page.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.minduck-actions').getBoundingClientRect();
      return { box:panelProbe.layout.box, actions:{ x:rect.x, y:rect.y, w:rect.width, h:rect.height } };
    })()`)
    const { box, actions } = geometry
    const corner = { x: side === 'left' ? box.x + 2 : box.x + box.w - 2, y: box.y + box.h - 18 }
    const button = { x: actions.x + 20 + index * 40, y: actions.y + 21 }
    const path = [corner]
    for (let step = 1; step <= 8; step++) path.push({
      x: corner.x + (button.x - corner.x) * step / 8,
      y: corner.y + (button.y - corner.y) * step / 8,
    })
    for (const point of path) {
      await moveMouse(page, point.x, point.y)
      const state = await page.webContents.executeJavaScript(`(() => {
        panelProbe.cursor(${JSON.stringify(point)});
        return { hidden:document.querySelector('.minduck-actions').hidden, interactive:panelProbe.interactive };
      })()`)
      assert.equal(state.hidden, false, side + ': buttons survive diagonal movement across the body and gap')
      assert.equal(state.interactive, true, side + ': native cursor polling keeps the connecting area interactive')
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type, x: button.x, y: button.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
      })
    }
    if (index === 0) {
      await new Promise(resolve => setTimeout(resolve,300));
      assert.equal(await page.webContents.executeJavaScript('document.querySelector(".minduck-actions").offsetWidth'),332);
      await page.webContents.executeJavaScript(`document.querySelector('.minduck-quick').shadowRoot.querySelector('textarea').focus();void 0`);
      for(const type of ['keyDown','keyUp'])await page.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await new Promise(resolve => setTimeout(resolve,300));
      assert.equal(await page.webContents.executeJavaScript('document.querySelector(".minduck-actions").classList.contains("is-composing")'),false);
    }
  }
  assert.deepEqual(await page.webContents.executeJavaScript('panelProbe.actions'), ['chat-context', 'open-app'],
    'both buttons accept real mouse clicks after traversing the hover area')
  await page.webContents.executeJavaScript('panelProbe.actions = [];panelProbe.targets = []')
}

async function checkPanels(page, width, theme, hover = true) {
  page.setContentSize(width, 600)
  await page.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme }],
  })
  await new Promise(resolve => setTimeout(resolve, 450))
  const hit = await page.webContents.executeJavaScript('panelProbe.layout.hit[0]')
  await moveMouse(page, hover ? hit.x : 2, hover ? hit.y : 2)
  return page.webContents.executeJavaScript(`new Promise(resolve => setTimeout(() => {
    const output = document.querySelector('.minduck-output'), actions = document.querySelector('.minduck-actions');
    const handle = document.querySelector('.minduck-handle');
    const rect = element => { const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height }; };
    resolve({ box:panelProbe.layout.box, output:rect(output), actions:rect(actions),
      font:getComputedStyle(output).fontSize, color:getComputedStyle(output).color,
      rows:[...output.querySelectorAll('.minduck-output-line')].map(el => el.textContent), outputHidden:output.hidden, actionsHidden:actions.hidden,
      handle:rect(handle), handleHidden:handle.hidden,
      buttons:[...actions.querySelectorAll('.minduck-action')].map(el => ({ name:el.getAttribute('aria-label'), disabled:el.getAttribute('aria-disabled'),
        icon:rect(el.querySelector('svg')), stroke:getComputedStyle(el.querySelector('svg')).strokeWidth })),
      overflow:document.documentElement.scrollWidth > innerWidth,
      oldMenu:document.getElementById('menu').hidden, oldTools:document.getElementById('tools').hidden });
  }, 100))`)
}

module.exports = async function probePanels(url, waitFor) {
  const page = new BrowserWindow({ show: false, width: 960, height: 600, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
  try {
    page.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error('Panel renderer:', event.message)
    })
    console.log('Panel probe: loading desktop page')
    // Start the renderer before issuing Page commands; a new offscreen window has no target yet.
    await page.loadURL('about:blank')
    page.webContents.debugger.attach('1.3')
    await page.webContents.debugger.sendCommand('Page.enable')
    await page.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: desktopFixture })
    console.log('Panel probe: desktop fixture ready')
    await page.loadURL(url)
    console.log('Panel probe: waiting for figure layout')
    await waitFor(() => page.webContents.executeJavaScript(`Boolean(window.panelProbe?.layout?.mode === 'idle' &&
      !panelProbe.layout.moving && panelProbe.layout.box &&
      document.querySelector('.minduck-actions'))`), Boolean, 'desktop panels and original figure')
    if(process.env.MINDUCK_COMPANION_RUNNING_ONLY==='1') {
      await require('./companion-running-ui-probe.cjs')(page,waitFor)
      return
    }

    const idle = await checkPanels(page, 960, 'light', false)
    assert.ok(idle.outputHidden && idle.actionsHidden, 'idle without hover hides both panels')
    assert.equal(idle.handleHidden, false, 'collapsed controls retain a visible handle')
    assert.deepEqual([idle.handle.w, idle.handle.h], [27, 6], 'the supplied collapsed handle stays 27×6')
    assert.deepEqual(idle.rows, ['', ''], 'no idle placeholder')
    assert.ok(Math.abs(idle.handle.y - Math.min(idle.box.y + idle.box.h + 6,542)) < .02, 'handle sits close to the duck')
    const gap = { x: idle.box.x + idle.box.w / 2, y: idle.box.y + idle.box.h + 2 }
    await moveMouse(page, gap.x, gap.y)
    const unopened = await page.webContents.executeJavaScript(`(() => {
      panelProbe.cursor(${JSON.stringify(gap)});
      return { hidden:document.querySelector('.minduck-actions').hidden, interactive:panelProbe.interactive };
    })()`)
    assert.ok(unopened.hidden && !unopened.interactive, 'the empty gap does not reveal controls or take clicks before body hover')
    const handlePoint = { x:idle.handle.x + 13.5, y:idle.handle.y + 3 }
    const handleHover = await page.webContents.executeJavaScript(`(() => {
      panelProbe.cursor(${JSON.stringify(handlePoint)});
      return { hidden:document.querySelector('.minduck-actions').hidden, interactive:panelProbe.interactive,
        handleHidden:document.querySelector('.minduck-handle').hidden };
    })()`)
    assert.ok(!handleHover.hidden && handleHover.interactive && handleHover.handleHidden,
      'native cursor polling alone expands the handle and retains input over the expanded capsule')
    await checkPanels(page, 960, 'light', false)
    for (const type of ['keyDown', 'keyUp']) await page.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, key:'Tab', code:'Tab', windowsVirtualKeyCode:9,
    })
    await waitFor(() => page.webContents.executeJavaScript(`!document.querySelector('.minduck-actions').hidden &&
      document.activeElement?.dataset.action === 'new-chat'`), Boolean, 'keyboard expands the handle into the first action')
    await page.webContents.executeJavaScript('document.activeElement.blur()')
    const hoveredIdle = await checkPanels(page, 960, 'light')
    assert.ok(Math.abs(hoveredIdle.actions.y - Math.min(hoveredIdle.box.y + hoveredIdle.box.h + 6,542)) < .02,
      'expanded buttons use the same body-relative top edge as the handle: ' + JSON.stringify(hoveredIdle))
    assert.ok(hoveredIdle.outputHidden && !hoveredIdle.actionsHidden, 'idle hover shows only the buttons')
    await probeActionPaths(page)
    await setTask(page, true)

    console.log('Panel probe: checking text limits')

    await page.webContents.executeJavaScript(`panelProbe.output({active:true,status:'running',conversationId:'long',
      text:'一二三四五六七八九十'.repeat(20),detail:'<script>alert(1)</script>'})`)
    await checkPanels(page, 375, 'light', false)
    const long = await page.webContents.executeJavaScript(`(() => {
      const lines=[...document.querySelector('.minduck-running').shadowRoot.querySelectorAll('.pet-running-message span')];
      return {text:lines[0].textContent,detail:lines[1].textContent,ellipsis:getComputedStyle(lines[0]).textOverflow,
        overflowing:lines[0].scrollWidth>lines[0].clientWidth,scripts:document.querySelector('.minduck-output script')!==null};
    })()`)
    assert.equal(long.ellipsis,'ellipsis');assert.equal(long.overflowing,true)
    assert.equal(long.detail,'<script>alert(1)</script>');assert.equal(long.scripts,false)
    await setTask(page,true)

    for (const width of [375, 768, 1024, 1440]) {
      for (const theme of ['light', 'dark']) {
        console.log('Panel probe:', width, theme)
        const state = await checkPanels(page, width, theme)
        assert.equal(state.font, '14px')
        assert.equal(state.color, theme === 'light' ? 'rgb(13, 13, 13)' : 'rgb(240, 240, 240)')
        assert.deepEqual([state.output.w,state.output.h],[330,12+20+8+20+12], 'message height follows two text rows, spacing and padding')
        assert.equal(state.outputHidden || state.actionsHidden, false, JSON.stringify(state))
        assert.equal(state.overflow, false)
        assert.equal(state.oldMenu && state.oldTools, true)
        assert.ok(Math.abs(state.actions.w - 80) < .01)
        assert.ok(Math.abs(state.actions.h - 42) < .01)
        assert.ok(state.output.y + state.output.h <= state.box.y, 'output above the figure')
        assert.ok(state.actions.y >= state.box.y + state.box.h, 'buttons below the figure: ' + JSON.stringify(state))
        for (const r of [state.output, state.actions]) {
          assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= 600, 'panels stay on screen')
        }
        assert.deepEqual(state.buttons.map(button => button.name), ['和 Matter 聊天', '打开 Minduck Matter'])
        assert.ok(state.buttons.every(button => button.disabled === 'false' && Math.abs(button.icon.w - 18) < .01
          && Math.abs(button.icon.h - 18) < .01 && button.stroke === '1.2px'))
        const away = await checkPanels(page, width, theme, false)
        assert.equal(away.outputHidden, false, 'active task remains visible without hover')
        assert.equal(away.actionsHidden, true, 'buttons hide when the pointer leaves')
        assert.equal(away.handleHidden, false, 'leaving replaces the buttons with the collapsed handle')
      }
    }

    for(const detail of ['需要你确认当前内容','']) {
      await page.webContents.executeJavaScript(`panelProbe.output({active:true,status:'waiting',conversationId:'auto-height',turnId:'spacing',text:'等待确认',detail:${JSON.stringify(detail)}})`)
      const state=await checkPanels(page,375,'light',false)
      assert.equal(state.output.h,12+20+(detail ? 8+20 : 0)+12,'ordinary messages shrink naturally when the subtitle is absent')
    }

    console.log('Panel probe: checking notification states')
    const arrow = await page.webContents.executeJavaScript(`document.querySelector('[data-action="open-app"] path').getAttribute('d')`)
    for (const count of [1, 2, 12, 1000, 0]) {
      await setTask(page, false, count)
      await checkPanels(page, 768, 'light')
      const notification = await page.webContents.executeJavaScript(`(() => {
        const button=document.querySelector('[data-action="open-app"]'), badge=button.querySelector('.minduck-notification-badge');
        return { hidden:badge.hidden, text:badge.textContent, label:button.getAttribute('aria-label'),
          icon:button.querySelector('path').getAttribute('d'), outputHidden:document.querySelector('.minduck-output').hidden };
      })()`)
      assert.equal(notification.hidden, !count)
      assert.equal(notification.text, count > 99 ? '99+' : count ? String(count) : '')
      assert.equal(notification.icon === arrow, !count, 'zero notifications restores the original arrow')
      assert.equal(notification.outputHidden, true, 'notifications alone do not create a task capsule')
      assert.equal(notification.label, '打开 Minduck Matter' + (count ? `，${count} 个会话通知` : ''))
    }
    await setTask(page, true, 2)
    for (const width of [375, 768, 1024, 1440]) for (const theme of ['light', 'dark']) {
      const state = await checkPanels(page, width, theme)
      const badge = await page.webContents.executeJavaScript(`(() => {
        const badge=document.querySelector('.minduck-notification-badge'), button=badge.parentElement;
        const b=badge.getBoundingClientRect(), r=button.getBoundingClientRect();
        return { inside:b.left>=r.left && b.right<=r.right && b.top>=r.top && b.bottom<=r.bottom,
          color:getComputedStyle(badge).color, surface:getComputedStyle(button.parentElement).backgroundColor };
      })()`)
      assert.ok(badge.inside, 'notification badge stays inside its button at every viewport size')
      assert.equal(badge.color, 'rgb(0, 0, 0)')
      assert.equal(badge.surface, theme === 'dark' ? 'rgba(0, 0, 0, 0.88)' : 'rgba(255, 255, 255, 0.88)')
      assert.deepEqual([state.actions.w, state.actions.h], [80, 42], 'badges never resize the capsule')
    }
    const manipulating = await page.webContents.executeJavaScript(`import('/web/pet-app.js').then(({panels}) => {
      const results=['drag','air','land'].map(mode => {
        panels.layout({...panelProbe.layout,mode}, {hoveringBody:true});
        return document.querySelector('.minduck-actions').hidden && document.querySelector('.minduck-handle').hidden;
      }); return results;
    })`)
    assert.ok(manipulating.every(Boolean), 'drag, airborne and landing states hide both the capsule and handle')
    await setTask(page, true)

    await page.webContents.executeJavaScript(`import('/web/pet-app.js').then(({panels}) =>
      panels.setOutputs(Array.from({length:3}, (_, i) => ({ active:true, conversationId:'conv-'+i,
        turnId:'turn-'+i, text:'会话'+i+'正在执行', detail:'独立的任务输出内容' }))))`)
    for (const width of [375, 768, 1024, 1440]) for (const theme of ['light', 'dark']) {
      await checkPanels(page, width, theme, false)
      const cards = await page.webContents.executeJavaScript(`[...document.querySelectorAll('.minduck-output')].map(el => {
        const r=el.getBoundingClientRect(); return { y:r.y, bottom:r.bottom, hidden:el.hidden,
          font:getComputedStyle(el).fontSize, color:getComputedStyle(el).color };
      })`)
      assert.equal(cards.length, 1, 'multiple active tasks render at most one capsule')
      assert.ok(cards.every(card => !card.hidden && card.y >= 16 && card.font === '14px'))
      const stack = await page.webContents.executeJavaScript(`(() => {const front=document.querySelector('.minduck-output').getBoundingClientRect();
        return [...document.querySelectorAll('.minduck-stack-layer:not([hidden])')].map(el=>{const r=el.getBoundingClientRect();return {
          offset:r.bottom-front.bottom,inset:r.left-front.left,width:r.width,height:r.height,top:r.top,pointer:getComputedStyle(el).pointerEvents,
          hidden:el.getAttribute('aria-hidden')};});})()`)
      assert.equal(stack.length,2)
      stack.forEach((layer,index)=>{
        assert.ok(Math.abs(layer.offset-(index+1)*6)<.05 && Math.abs(layer.inset-(index+1)*16)<.05,JSON.stringify(layer))
        assert.equal(layer.width,330-(index+1)*32);assert.equal(layer.height,38);assert.ok(layer.top>=15.99)
        assert.equal(layer.pointer,'none');assert.equal(layer.hidden,'true')
      })
      if (width === 768) fs.writeFileSync(path.resolve(__dirname, '../build/companion-stacked-panel-' + theme + '.png'),
        (await page.webContents.capturePage()).toPNG())
    }
    for (const theme of ['light', 'dark']) {
      await checkPanels(page, 768, theme, false)
      for (let i = 0; i < 3; i++) {
        await page.webContents.executeJavaScript(`(() => {
          panelProbe.output({active:false,tasks:[]});
          const tasks=Array.from({length:3}, (_, i) => ({active:true, status:i===${i}?'running':'waiting',
            conversationId:'conv-'+i, turnId:'turn-'+i, text:'会话'+i+'正在执行', detail:'独立的任务输出内容'}));
          panelProbe.output({...tasks[${i}],tasks});
        })()`)
        await checkPanels(page, 768, theme, false)
        assert.deepEqual(await page.webContents.executeJavaScript(
          `[...document.querySelectorAll('.minduck-output')].map(el=>el.dataset.conversationId)`),
        ['conv-' + i], 'only the selected primary conversation remains, even when tasks start with another one')
        const point = await page.webContents.executeJavaScript(`(() => {
          const r=document.querySelector('[data-conversation-id="conv-${i}"]').getBoundingClientRect();
          return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`)
        await moveMouse(page, point.x, point.y)
        await new Promise(resolve => setTimeout(resolve, 200))
        const hover = await page.webContents.executeJavaScript(`(() => {
          panelProbe.cursor(${JSON.stringify(point)});
          const el=document.querySelector('[data-conversation-id="conv-${i}"]');
          return { shadow:getComputedStyle(el).boxShadow, interactive:panelProbe.interactive }; })()`)
        assert.equal(hover.interactive, true, 'the selected capsule accepts native pointer input')
        assert.ok(hover.shadow.endsWith((theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)')+' 0px 0px 0px 1px inset'),
          'hover keeps the neutral card edge: '+hover.shadow)
        if (i === 1) fs.writeFileSync(path.resolve(__dirname, '../build/companion-conversation-hover-' + theme + '.png'),
          (await page.webContents.capturePage()).toPNG())
        for (const type of ['mousePressed','mouseReleased']) await page.webContents.debugger.sendCommand(
          'Input.dispatchMouseEvent', {type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})
        assert.equal(await page.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.minduck-output')).boxShadow`),hover.shadow,
          'click/focus does not introduce an orange card outline')
      }
    }
    const routed = await page.webContents.executeJavaScript(`panelProbe.targets.filter(Boolean)`)
    assert.deepEqual(routed.map(target => [target.conversationId, target.turnId]),
      [0,1,2,0,1,2].map(i => ['conv-'+i, 'turn-'+i]), 'switching the single capsule updates its conversation and turn target')
    for (const theme of ['light','dark']) {
      await page.webContents.executeJavaScript(`(() => {
        panelProbe.queue=Array.from({length:3},(_,i)=>({active:true,status:'waiting',conversationId:'queue-${theme}-'+i,
          turnId:'queue-turn',text:'待处理消息 '+i,detail:'等待确认'}));
        panelProbe.output({active:false,tasks:[]});panelProbe.output({...panelProbe.queue[0],tasks:panelProbe.queue});
      })()`)
      await checkPanels(page,375,theme,false)
      for(let index=0;index<3;index++) {
        const state=await page.webContents.executeJavaScript(`(() => {
          const stack=document.querySelector('.minduck-outputs'),front=document.querySelector('.minduck-output');
          return {id:front.dataset.conversationId,count:Number(stack.dataset.messageCount),
            layers:stack.querySelectorAll('.minduck-stack-layer:not([hidden])').length};})()`)
        assert.equal(state.id,'queue-'+theme+'-'+index);assert.equal(state.count,3-index);assert.equal(state.layers,2-index)
        if(index===0)await page.webContents.executeJavaScript(`panelProbe.queue[0].turnId='resolved-turn-anchor';void 0`)
        await page.webContents.executeJavaScript(`panelProbe.output({...panelProbe.queue[2],tasks:[...panelProbe.queue].reverse()});void 0`)
        assert.equal(await page.webContents.executeJavaScript(`document.querySelector('.minduck-output').dataset.conversationId`),state.id,
          'stream/primary reordering never replaces the message being read')
        const center=await page.webContents.executeJavaScript(`(() => {const r=document.querySelector('.minduck-output').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
        await moveMouse(page,center.x,center.y)
        await new Promise(resolve=>setTimeout(resolve,200))
        const point=await page.webContents.executeJavaScript(`(() => {const r=document.querySelector('.minduck-close').getBoundingClientRect();return {x:r.x+8,y:r.y+8};})()`)
        await moveMouse(page,point.x,point.y)
        await waitFor(()=>page.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.minduck-close')).opacity`),value=>value==='1','queued close visible')
        for(const type of ['mousePressed','mouseReleased'])await page.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{
          type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})
        await waitFor(()=>page.webContents.executeJavaScript(`Number(document.querySelector('.minduck-outputs').dataset.messageCount)`),
          count=>count===2-index,'close advances exactly one queued hint')
        await page.webContents.executeJavaScript(`panelProbe.output({...panelProbe.queue[0],tasks:panelProbe.queue});void 0`)
        assert.equal(await page.webContents.executeJavaScript(`Number(document.querySelector('.minduck-outputs').dataset.messageCount)`),2-index,
          'ordinary stream updates do not revive dismissed messages')
      }
      assert.equal(await page.webContents.executeJavaScript(`document.querySelector('.minduck-outputs').hidden`),true)
      await page.webContents.executeJavaScript(`panelProbe.output({...panelProbe.queue[0],turnId:'new-turn'});void 0`)
      await waitFor(()=>page.webContents.executeJavaScript(`document.querySelector('.minduck-outputs').hidden`),hidden=>!hidden,'a new turn appears after the old queue is dismissed')
      assert.equal(await page.webContents.executeJavaScript(`document.querySelectorAll('.minduck-stack-layer:not([hidden])').length`),0)
    }
    await page.webContents.executeJavaScript('panelProbe.actions=[];panelProbe.targets=[]')
    await page.webContents.executeJavaScript(`import('/web/pet-app.js').then(({panels}) =>
      panels.setOutputs(Array.from({length:12}, (_, i) => ({ active:true, conversationId:'many-'+i,
        text:'会话'+i, detail:'正在执行' }))))`)
    await checkPanels(page, 768, 'light', false)
    const scrolling = await page.webContents.executeJavaScript(`(() => {
      const el=document.querySelector('.minduck-outputs'), r=el.getBoundingClientRect();
      panelProbe.cursor({x:r.x+10, y:r.y+10});
      return { count:el.children.length, height:el.clientHeight, content:el.scrollHeight,
        x:r.x+40, y:r.y+r.height/2, interactive:panelProbe.interactive, top:r.y, bottom:r.bottom };
    })()`)
    assert.equal(scrolling.count, 3, 'twelve queued conversations render one card and two compact back layers')
    assert.ok(scrolling.content <= scrolling.height && scrolling.top >= 15.99 && scrolling.bottom <= 600,
      JSON.stringify(scrolling))
    assert.equal(scrolling.interactive, true, 'the single capsule retains native input')
    await setTask(page, true, 2)

    const controls = await checkPanels(page, 768, 'light')
    await moveMouse(page, controls.actions.x + 40, (controls.box.y + controls.box.h + controls.actions.y) / 2)
    assert.equal(await page.webContents.executeJavaScript('document.querySelector(".minduck-actions").hidden'), false,
      'the gap between the body and buttons stays traversable')
    await moveMouse(page, controls.actions.x + 20, controls.actions.y + 21)
    await waitFor(() => page.webContents.executeJavaScript('panelProbe.interactive'), Boolean, 'panel takes pointer input')
    await moveMouse(page, 2, 2)
    await waitFor(() => page.webContents.executeJavaScript('panelProbe.interactive'), value => !value, 'outside remains click-through')
    await setTask(page, false)
    const completed = await checkPanels(page, 768, 'light', false)
    assert.ok(completed.outputHidden && completed.actionsHidden, 'completed task hides output even with retained text')
    await checkPanels(page, 768, 'light')
    const activated = await page.webContents.executeJavaScript(`(() => {
      const hit = panelProbe.layout.hit[0];
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, clientX:hit.x, clientY:hit.y }));
      return { bubbleHidden:document.getElementById('bubble').hidden, menuHidden:document.getElementById('menu').hidden,
        url:location.href, panelsVisible:!document.querySelector('.minduck-actions').hidden,
        actions:panelProbe.actions };
    })()`)
    assert.ok(activated.bubbleHidden && activated.menuHidden && activated.panelsVisible, 'Matter controls do not open upstream chat/menu')
    assert.deepEqual(activated.actions, [], 'context menu does not dispatch a Matter action')
    assert.equal(activated.url, url)

    // Task data is injected only in the test preview; production has no placeholder task.
    console.log('Panel probe: capturing previews')
    await setTask(page, true, 2)
    for (const theme of ['light', 'dark']) {
      const state = await checkPanels(page, 768, theme)
      const x = Math.max(0, Math.floor(Math.min(state.output.x, state.box.x, state.actions.x) - 28))
      const y = Math.floor(state.output.y - 28)
      const right = Math.min(768, Math.ceil(Math.max(state.output.x + state.output.w, state.box.x + state.box.w, state.actions.x + state.actions.w) + 28))
      const bottom = Math.min(600, Math.ceil(state.actions.y + state.actions.h + 24))
      fs.writeFileSync(path.resolve(__dirname, '../build/companion-panels-' + theme + '.png'),
        (await page.webContents.capturePage({ x, y, width: right - x, height: bottom - y })).toPNG())
      await checkPanels(page, 768, theme, false)
      fs.writeFileSync(path.resolve(__dirname, '../build/companion-collapsed-' + theme + '.png'),
        (await page.webContents.capturePage({ x, y, width:right-x, height:bottom-y })).toPNG())
    }
    assert.deepEqual(await page.webContents.executeJavaScript('panelProbe.errors'), [])
    await require('./companion-quick-chat-ui-probe.cjs')(page, waitFor)
    await require('./companion-running-ui-probe.cjs')(page, waitFor)
    await require('./companion-qa-ui-probe.cjs')(page, waitFor)
    console.log('PASS: collapsed handle/body hover, keyboard, diagonal paths, native polling, real clicks and outside click-through; notification arrow/bell/badge, task-only output, 4 widths × light/dark and original figure')
  } catch(error) {
    if(!page.isDestroyed())fs.writeFileSync(path.resolve(__dirname,'../build/companion-panel-failure.png'),(await page.webContents.capturePage()).toPNG())
    throw error
  } finally {
    if (!page.isDestroyed()) page.destroy()
  }
}
