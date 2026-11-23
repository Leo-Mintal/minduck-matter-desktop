const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')

// Actual official API 2 sandbox, Matter lifecycle adapter, and source SVG parity.
module.exports = async function probeSuitPose(url) {
  const page = new BrowserWindow({ show: false, width: 720, height: 640, backgroundColor: '#e8e8e8',
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
  try {
    const origin = new URL(url).origin
    await page.loadURL(origin + '/api/figures')
    const exec = code => page.webContents.executeJavaScript(code)
    await exec(`document.body.textContent='';document.body.style='margin:0;background:#e8e8e8;overflow:hidden';
      window.poseReady=new Promise((resolve,reject)=>{window.poseResolve=resolve;window.poseReject=reject});
      const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
      frame.style='width:720px;height:640px;border:0';window.poseFrame=frame;window.poseEvents=[];
      addEventListener('message',e=>{if(e.source!==frame.contentWindow)return;
        poseEvents.push(e.data);
        if(e.data.t==='error')poseReject(new Error(e.data.message));
        if(e.data.t==='loaded')frame.contentWindow.postMessage({t:'init',entry:'${origin}/packs/minduck-suit-duck/figure.js',
          export:'createSuitDuckBody',base:'${origin}/packs/minduck-suit-duck/',theme:'light',language:'zh',
          bounds:{W:720,H:640,floorY:580,S:1.5},start:{x:300,facing:1,enter:false}},'*');
        if(e.data.t==='ready')poseResolve();});
      frame.src='${origin}/figure-frame?pack=minduck-suit-duck';document.body.append(frame);`)
    await exec('poseReady')
    const send = message => exec(`poseFrame.contentWindow.postMessage(${JSON.stringify(message)},'*')`)
    const tick = (count, quiet = true) => exec(`(async()=>{let value;for(let i=0;i<${count};i++){
      const next=new Promise((resolve,reject)=>{const listener=e=>{
        if(e.source!==poseFrame.contentWindow)return;
        if(e.data.t==='frame'||e.data.t==='error'){removeEventListener('message',listener);
          e.data.t==='error'?reject(new Error(e.data.message)):resolve(e.data.layout);}};
        addEventListener('message',listener);});
      ${quiet ? "poseFrame.contentWindow.postMessage({t:'set',state:{hold:.1}},'*');" : ''}
      poseFrame.contentWindow.postMessage({t:'tick',dt:.05},'*');value=await next;}return value;})()`)
    const frame = page.webContents.mainFrame.frames.find(item => item.url.includes('/figure-frame'))
    assert.ok(frame, 'official Suit Duck frame')
    const measure = () => frame.executeJavaScript(`(()=>{
      const visible=[...document.querySelectorAll('[data-flow]')].filter(n=>getComputedStyle(n).display!=='none');
      return {flows:visible.map(n=>n.dataset.flow),times:visible.map(n=>Number(n.dataset.sourceTime)),
        opacities:visible.map(n=>Number(getComputedStyle(n).opacity)),
        animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime})),
        base:getComputedStyle(document.querySelector('[data-suit-base]')).display,
        monocle:!!document.querySelector('#suit-monocle')};})()`)
    const capture = async name => {
      // Let Chromium paint the manually sought, paused WAAPI state.
      await new Promise(resolve => setTimeout(resolve, 50))
      fs.writeFileSync(path.resolve(__dirname, '../build/companion-suit-' + name + '.png'),
        (await page.webContents.capturePage()).toPNG())
    }
    await send({ t: 'set', state: { roam: 'off', thoughtShown: true } })
    const idleLayout = await tick(30)
    assert.equal(idleLayout.animating, true, 'authored idle requests the configured animation rate')
    assert.equal(idleLayout.moving, false, 'idle animation does not block random thinking or pretend to walk')
    assert.deepEqual((await measure()).flows, ['idle'])
    await capture('idle')
    await send({ t: 'do', word: 'love' })
    const loveLayout = await tick(10)
    assert.equal(loveLayout.animating, true, 'procedural love/heart pose retains the configured animation rate')
    assert.equal(loveLayout.moving, false, 'face effects must not masquerade as walking')
    assert.deepEqual((await measure()).flows, [], 'love exercises the procedural pose, not a full source clip')
    await send({ t: 'do', word: 'neutral' })
    await tick(1)
    let comparisons = 0
    const sources = { gait: 'walking', idle: 'idle', work: 'working', write: 'writing',
      ask: 'confirmation', happy: 'success', sad: 'failure', think: 'thinking', flag: 'flag', carry: 'carry' }
    const compare = async (word, time) => {
      const raw = fs.readFileSync(path.resolve(__dirname, '../assets/companion-suit-duck/source', sources[word] + '.svg'), 'utf8')
      // Shadow DOM isolates original IDs and keyframe names from the compiled pack.
      return frame.executeJavaScript(`(async()=>{
        const holder=document.createElement('div');holder.style='position:absolute;left:-10000px;opacity:0';
        const shadow=holder.attachShadow({mode:'open'});shadow.innerHTML=${JSON.stringify(raw)};
        document.body.append(holder);
        try {
          for(const a of shadow.getAnimations()){a.pause();a.currentTime=${time}*1000;}
          const {FLOWS}=await import('${origin}/packs/minduck-suit-duck/flow-artwork.js');
          const problems=[];let count=0;
          for(const track of FLOWS['${word}'].animations){
            const actual=document.getElementById(track.id);
            const original=shadow.getElementById(track.id.slice('suit-${word}-'.length));
            const a=getComputedStyle(actual),b=getComputedStyle(original);
            const props=Object.keys(track.keyframes[0]).filter(k=>!['offset','easing'].includes(k));
            for(const p of props){
              if(p==='transform'){
                const av=new DOMMatrix(a.transform),bv=new DOMMatrix(b.transform);
                if(['a','b','c','d','e','f'].some(k=>Math.abs(av[k]-bv[k])>.003))problems.push(track.id+':transform');
              }else if(Math.abs(parseFloat(a[p])-parseFloat(b[p]))>.0002)problems.push(track.id+':'+p);
              count++;
            }
          }
          return {count,problems:problems.slice(0,8)};
        }finally{holder.remove();}
      })()`)
    }
    const idleTime = (await measure()).times[0]
    const idleParity = await compare('idle', idleTime)
    assert.deepEqual(idleParity.problems, [], JSON.stringify(idleParity))
    comparisons += idleParity.count
    await exec(`(async () => {
      const style=document.createElement('link');style.rel='stylesheet';style.href='/web/minduck-panels.css';
      const loaded=new Promise((resolve,reject)=>{style.onload=resolve;style.onerror=reject});
      document.head.appendChild(style);await loaded;
      const {createMinduckPanels}=await import('/web/minduck-panels.js');
      const {readLayout}=await import('/web/body-host.js');
      const panels=createMinduckPanels();
      window.measureControls=()=>{
        const body=readLayout(poseEvents.findLast(event=>event.t==='frame').layout,{W:innerWidth,H:innerHeight,S:1.5});
        const center=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.left+r.width/2};
        panels.layout(body);const handle=center('.minduck-handle');
        panels.layout(body,{hoveringBody:true});const buttons=center('.minduck-actions');
        panels.layout(null);return {handle,buttons};
      };
    })()`)
    async function checkControls(action, facing) {
      const centers = await exec('measureControls()')
      const feet = await frame.executeJavaScript("document.querySelector('ellipse.shadow').cx.baseVal.value")
      assert.ok(Math.abs(centers.handle - feet) < .1 && Math.abs(centers.buttons - feet) < .1,
        JSON.stringify({action, facing, feet, ...centers}))
    }
    for (const facing of [1, -1]) {
      await send({ t: 'place', x: 300, facing })
      for (const [activity, word, seconds] of [['work', 'work', 8], ['ask', 'ask', 8],
        ['success', 'happy', 8], ['error', 'sad', 8]]) {
        // Manual source actions retain all eight seconds; Matter work/ask have a separate hold-loop probe below.
        await send({ t: 'do', word })
        let layout
        for (let i = 0; i < 200; i++) {
          layout = await tick(1)
          if (layout.gesture === word) break
        }
        assert.equal(layout.gesture, word, JSON.stringify(layout))
        // Activity starts after the current render; the next host tick draws its first source frame.
        await tick(1)
        const entrance = await measure()
        assert.deepEqual(entrance.opacities, [1], 'the first source frame is opaque, without a crossfade')
        assert.equal(entrance.base, 'none')
        if (facing === 1 && word === 'work') {
          await frame.executeJavaScript(`window.hiddenWrites=0;window.hiddenObserver=new MutationObserver(records=>hiddenWrites+=records.length);
            hiddenObserver.observe(document.querySelector('[data-suit-base]'),{attributes:true,subtree:true});`)
          await tick(2)
          assert.equal(await frame.executeJavaScript('hiddenObserver.disconnect();hiddenWrites'), 0,
            'hidden procedural body is not transformed every frame')
        }
        for (const at of [.15, seconds * .3, seconds * .4, seconds - .15]) {
          let value = await measure()
          await tick(Math.max(1, Math.round((at - value.times[0]) / .05)))
          value = await measure()
          assert.deepEqual(value.flows, [word])
          assert.deepEqual(value.opacities, [1])
          assert.ok(value.monocle)
          assert.equal(value.base, 'none', JSON.stringify({ word, facing, at, time: value.times }))
          assert.ok(value.animations.every(a => a.state === 'paused'))
          const parity = await compare(word, value.times[0])
          assert.deepEqual(parity.problems, [], JSON.stringify({ word, facing, at, ...parity }))
          comparisons += parity.count
          if (at === seconds * .4) {
            await checkControls(word, facing)
            await capture(word + (facing === -1 ? '-left' : ''))
          }
        }
        // A pending idle state leaves manual finite actions intact.
        await send({ t: 'set', state: { matterActivity: { kind: 'idle' } } })
        layout = await tick(Math.ceil(seconds / .05) + 5)
        assert.equal(layout.gesture, null)
        assert.deepEqual((await measure()).flows, ['idle'])
      }
      for (const word of ['write', 'think', 'flag', 'carry']) {
        await send({ t: 'do', word })
        let layout
        for (let i = 0; i < 20; i++) {
          layout = await tick(1)
          if (layout.gesture === word) break
        }
        assert.equal(layout.gesture, word, JSON.stringify(layout))
        for (const at of [.15, 3.5, 7.5]) {
          let value = await measure()
          await tick(Math.max(1, Math.round((at - value.times[0]) / .05)))
          value = await measure()
          assert.deepEqual(value.flows, [word])
          const parity = await compare(word, value.times[0])
          assert.deepEqual(parity.problems, [], JSON.stringify({ word, facing, at, ...parity }))
          comparisons += parity.count
          if (at === 3.5) await checkControls(word, facing)
        }
        await send({ t: 'do', word: 'stand' })
        await tick(1)
      }
    }
    // The extra callable prop actions retain the same drag/landing contract as work and ask.
    for (const word of ['write', 'flag', 'carry']) {
      await send({ t: 'do', word }); let layout = await tick(40)
      const point = layout.hit[0]
      await send({ t: 'pointer', type: 'down', p: { x: point.x, y: point.y, t: 1000 } })
      await send({ t: 'pointer', type: 'move', p: { x: point.x + 30, y: point.y - 90, t: 1150 } })
      layout = await tick(2)
      assert.equal(layout.mode, 'drag', word)
      assert.equal(layout.gesture, null, word)
      await send({ t: 'drop', p: { x: 300, y: 350 } })
      let restored = false
      for (let i = 0; i < 400; i++) {
        layout = await tick(1)
        assert.ok(!['air', 'land', 'dizzy', 'wake'].includes(layout.mode) || layout.gesture !== word, word)
        if (layout.mode === 'idle' && layout.gesture === word) { restored = true; break }
      }
      assert.ok(restored, word + ' resumes once after landing')
      await tick(165)
      assert.equal((await measure()).flows[0], 'idle')
    }
    // Automatic work loops, transitions, and real drag cancellation/recovery.
    await send({ t: 'set', state: { matterActivity: { kind: 'work' } } })
    await tick(180)
    let value = await measure()
    assert.deepEqual(value.flows, ['work'])
    for (let i = 0; i < 160; i++) {
      await tick(1)
      value = await measure()
      assert.deepEqual(value.flows, ['work'])
      assert.deepEqual(value.opacities, [1])
      assert.ok(value.times[0] >= 1.3504 && value.times[0] < 4.5,
        'automatic work loops its active section without stowing or re-entering')
    }
    const before = value.times[0]
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal((await measure()).times[0], before, 'wall time cannot advance the pack')
    let layout = await tick(1)
    const point = layout.hit[0]
    await send({ t: 'pointer', type: 'down', p: { x: point.x, y: point.y, t: 1000 } })
    await send({ t: 'pointer', type: 'move', p: { x: point.x + 40, y: point.y - 90, t: 1150 } })
    layout = await tick(2)
    assert.equal(layout.mode, 'drag')
    assert.ok(!layout.work, 'drag clears active artwork')
    await capture('drag')
    await send({ t: 'drop', p: { x: 300, y: 350 } })
    let recovered = false
    for (let i = 0; i < 400; i++) {
      layout = await tick(1)
      if (layout.work && layout.mode === 'idle') { recovered = true; break }
    }
    assert.ok(recovered, 'automatic work resumes only after landing recovery')
    await send({ t: 'set', state: { matterActivity: { kind: 'idle' } } })
    await tick(180)
    for (const facing of [1, -1]) {
      await send({ t: 'place', x: facing === 1 ? 160 : 560, facing })
      await send({ t: 'walk', x: facing === 1 ? 600 : 100, run: false, id: 999 })
      layout = await tick(5)
      value = await measure()
      assert.equal(layout.mode, 'walk')
      assert.deepEqual(value.flows, ['gait'])
      const parity = await compare('gait', value.times[0])
      assert.deepEqual(parity.problems, [], JSON.stringify(parity))
      comparisons += parity.count
      await capture('walk' + (facing === -1 ? '-left' : ''))
      await send({ t: 'do', word: 'stand' }); await tick(1)
    }
    // Short clicks use the complete pack-owned thinking clip, never the generic overlay.
    await tick(5, false)
    layout = await tick(1, false)
    const tap = layout.hit[0]
    await send({ t: 'pointer', type: 'down', p: { x: tap.x, y: tap.y, t: 1000 } })
    await send({ t: 'pointer', type: 'up', p: { x: tap.x, y: tap.y, t: 1100 } })
    await tick(65, false)
    value = await measure()
    assert.deepEqual(value.flows, ['think'])
    await checkControls('click thinking', layout.facing)
    assert.equal(await frame.executeJavaScript("document.querySelectorAll('[data-minduck-thinking]').length"), 0)
    await capture('thinking')
    const thinkingTime = value.times[0]
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal((await measure()).times[0], thinkingTime)
    await tick(100, false)
    assert.deepEqual((await measure()).flows, ['idle'])
    console.log('PASS: Suit Duck ten source actions, opaque boundaries, no hidden-body writes, idle frame-rate signal, continuous activity holds, both facings, host-only clock and drag recovery:', comparisons, 'property comparisons')
  } finally { page.destroy() }
}
