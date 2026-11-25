const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Sample actual compositor frames: a final-state screenshot cannot catch a layout jump.
module.exports = async function probeTaskMotion(page, waitFor) {
  const evaluate = code => page.webContents.executeJavaScript(code)
  const media = value => page.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features:[{name:'prefers-reduced-motion',value}],
  })
  await evaluate(`(async () => {
    // Isolate deck motion from the real figure's independent idle breathing/bubble movement.
    const {panels}=await import('/web/pet-app.js'), nativeLayout=panels.layout;
    const body=structuredClone(panelProbe.layout);
    panels.layout=(_body,options)=>nativeLayout(body,options);
    panels.layout(body);
    window.taskMotion = (() => {
    const stack=document.querySelector('.minduck-outputs'), toggle=document.querySelector('[data-action="toggle-tasks"]');
    const sample=() => {
      const cards=[...stack.querySelectorAll('.minduck-output:not([hidden])')].slice(0,3);
      const viewport=stack.querySelector('.minduck-output-list').getBoundingClientRect();
      const listStyle=getComputedStyle(stack.querySelector('.minduck-output-list'));
      const stackStyle=getComputedStyle(stack),bounds=stack.getBoundingClientRect();
      return {time:performance.now(),bottom:stack.getBoundingClientRect().bottom,
        timings:stack.getAnimations({subtree:true}).filter(a=>a.effect?.target?.classList?.contains('minduck-output')
          && a.effect.getKeyframes().some(k=>'translate' in k)).map(a=>{const t=a.effect.getTiming();
            return {duration:t.duration,delay:t.delay,easing:t.easing};}),
        viewport:{top:viewport.top,bottom:viewport.bottom},
        clipBounds:{top:bounds.top,bottom:bounds.bottom,clip:stackStyle.clipPath,overflow:listStyle.overflowY,mask:listStyle.maskImage},
        anchor:Math.min(body.box.y,body.bubble.y)-16,
        expanded:toggle.getAttribute('aria-expanded')==='true',moving:stack.classList.contains('is-transitioning'),
        cards:cards.map(card=>{const r=card.getBoundingClientRect(),css=getComputedStyle(card);
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {top:r.top,bottom:r.bottom,width:r.width,height:r.height,font:css.fontSize,opacity:Number(css.opacity),
            centerVisible:!!hit && card.contains(hit),
            hitClass:typeof hit?.className==='string' ? hit.className : hit?.tagName,
            clip:css.clipPath,content:Number(getComputedStyle(card.firstElementChild).opacity)};})};
    };
    return {sample, initialY:body.box.y, restore:()=>{panels.layout=nativeLayout;}, moveTo(y) {
      const delta=y-body.box.y;body.box.y+=delta;body.bubble.y+=delta;body.y+=delta;panels.layout(body);
    },resizeFront(height) {
      stack.querySelector('.minduck-content').style.minHeight=height ? height+'px' : '';panels.layout(body);
    },toggle:()=>toggle.click(), run(reverse=false) {
      const frames=[sample()]; toggle.click(); frames.push(sample());
      return new Promise(resolve=>{
        let reversed=false;
        function frame(){
          frames.push(sample());
          if(reverse && !reversed && performance.now()-frames[0].time>=55){
            reversed=true; toggle.click(); frames.push({...sample(),reversed:true});
          }
          if(performance.now()-frames[0].time>600) resolve(frames);
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
    }};
    })();
  })()`)
  await media('no-preference')
  const collapse = await evaluate('taskMotion.run()')
  const expand = await evaluate('taskMotion.run()')
  const record = data => fs.writeFileSync(path.resolve(__dirname,'../build/companion-task-motion.json'),JSON.stringify(data,null,2))
  record({collapse,expand})
  const closing=collapse[1].timings,opening=expand[1].timings
  assert.equal(opening.length,3);assert.equal(closing.length,3)
  const endTime=timings=>Math.max(...timings.map(t=>t.duration+t.delay))
  assert.ok(endTime(closing)<endTime(opening),'gathering finishes sooner than spreading')
  assert.ok(endTime(opening)<=300,'the complete staggered opening stays within 300ms')
  assert.ok(opening[1].delay>opening[0].delay && opening[2].delay>opening[1].delay,'cards unfold in a gentle sequence')
  for (const [name, frames] of [['collapse',collapse],['expand',expand]]) {
    const first=frames[0], last=frames.at(-1), start=first.cards[0].top, end=last.cards[0].top
    assert.ok(Math.abs(start-end)>50, name+': fixture exercises a full deck movement')
    assert.ok(Math.abs(frames[1].cards[0].top-start)<1, name+': no jump when layouts switch')
    const moving=frames.filter(frame=>frame.moving)
    assert.ok(moving.length>=3, name+': transition contains intermediate rendered frames')
    assert.ok(moving.some(frame=>Math.abs(frame.cards[0].top-start)>5 && Math.abs(frame.cards[0].top-end)>5),name+': front card travels between endpoints')
    for (const frame of frames) {
      assert.ok(Math.abs(frame.bottom-frame.anchor)<.1,name+': deck stays anchored above the pet: '+JSON.stringify({anchor:frame.anchor,current:frame.bottom,time:frame.time-first.time,moving:frame.moving}))
      assert.equal(frame.cards[0].opacity,1,name+': front card never flashes transparent')
      for (const card of frame.cards) {
        assert.ok(Math.abs(card.width-first.cards[0].width)<.01,name+': card width never scales')
        assert.equal(card.font,first.cards[0].font,name+': text never scales')
      }
    }
    assert.equal(last.moving,false,name+': animation reaches a resting layout')
  }
  assert.ok(expand.some(frame=>frame.cards[1]?.content>0 && frame.cards[1]?.content<1),'back-card content fades in after separation')
  const reversal = await evaluate('taskMotion.run(true)')
  const reversed = reversal.findIndex(frame=>frame.reversed)
  assert.ok(reversed>0,'quick re-click actually reverses an active transition')
  assert.ok(reversal[reversed].timings[0].duration<opening[0].duration,'reversal duration follows the remaining travel')
  assert.ok(reversal[reversed].timings.every(t=>t.delay===0),'reversing responds immediately without replaying stagger delays')
  for (let i=0;i<3;i++) assert.ok(Math.abs(reversal[reversed].cards[i].top-reversal[reversed-1].cards[i].top)<1,'reversal continues from each current position')
  assert.equal(reversal.at(-1).expanded,true,'reversed collapse returns to the expanded list')
  await evaluate('taskMotion.moveTo(150)')
  const edgeCollapse=await evaluate('taskMotion.run()'),edgeExpand=await evaluate('taskMotion.run()')
  record({collapse,expand,reversal,edgeCollapse,edgeExpand})
  for (const frame of [...edgeCollapse,...edgeExpand]) {
    assert.equal(frame.cards[0].centerVisible,true,'front card stays visible when layout crosses from above the pet to below it')
  }
  const edgeReversal=await evaluate('taskMotion.run(true)')
  const edgeReversed=edgeReversal.findIndex(frame=>frame.reversed)
  assert.ok(Math.abs(edgeReversal[edgeReversed].cards[0].top-edgeReversal[edgeReversed-1].cards[0].top)<1,'edge-placement reversal keeps the current front-card position')
  assert.ok(edgeReversal.every(frame=>frame.cards[0].opacity===1 && frame.cards[0].centerVisible),'edge reversal never hides the front card')
  await evaluate('taskMotion.moveTo(taskMotion.initialY)')
  await evaluate('taskMotion.resizeFront(200)')
  const mixedCollapse=await evaluate('taskMotion.run()'),mixedExpand=await evaluate('taskMotion.run()')
  let clipped=0
  for (const frames of [mixedCollapse,mixedExpand]) {
    const bottom=Math.max(frames[0].viewport.bottom,frames.at(-1).viewport.bottom)+8
    for (const frame of frames.filter(frame=>frame.moving)) for (const card of frame.cards) {
      if ((card.top+card.bottom)/2>bottom+1) {
        clipped++;assert.equal(card.centerVisible,false,'tall mixed-height rows stay clipped to the combined transition viewport')
      }
    }
  }
  assert.ok(clipped>0,'mixed-height fixture exercises off-viewport cards')
  await evaluate('taskMotion.resizeFront(0)')
  await media('reduce')
  for (const state of [false,true]) {
    const frame = await evaluate('taskMotion.toggle();taskMotion.sample()')
    assert.equal(frame.expanded,state)
    assert.equal(frame.moving,false,'reduced-motion preference settles immediately')
  }
  await media('no-preference')
  await waitFor(() => evaluate('!document.querySelector(".minduck-outputs").classList.contains("is-transitioning")'),Boolean,'motion probe leaves the list expanded')
  record({collapse,expand,reversal,edgeCollapse,edgeExpand,edgeReversal,mixedCollapse,mixedExpand})
  if (process.env.MINDUCK_COMPANION_MOTION_CAPTURE==='1') {
    await evaluate('taskMotion.toggle()')
    await waitFor(() => evaluate('!document.querySelector(".minduck-outputs").classList.contains("is-transitioning")'),Boolean,'capture starts from the folded deck')
    await evaluate(`taskMotion.toggle();window.taskMotionFrames=document.querySelector('.minduck-outputs').getAnimations({subtree:true});
      taskMotionFrames.forEach(animation=>animation.pause());void 0`)
    for (const time of [0,40,80,140,300]) {
      await evaluate(`taskMotionFrames.forEach(animation=>{animation.currentTime=${time}});
        new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      fs.writeFileSync(path.resolve(__dirname,'../build/companion-task-motion-'+time+'.png'),(await page.webContents.capturePage()).toPNG())
    }
    await evaluate('taskMotionFrames.forEach(animation=>animation.finish());delete window.taskMotionFrames')
    await waitFor(() => evaluate('!document.querySelector(".minduck-outputs").classList.contains("is-transitioning")'),Boolean,'captured animation completes')
  }
  await evaluate('taskMotion.restore();delete window.taskMotion')
  console.log('PASS: sampled staggered opening, quicker gathering, distance-aware immediate reversal, anchored opaque cards, unchanged widths/fonts and reduced motion')
}
