const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')

// Render the real pack in its official opaque sandbox and inspect the actual SVG joint matrices.
module.exports = async function probeSuitPose(url) {
  const page = new BrowserWindow({ show: false, width: 720, height: 640, backgroundColor: '#e8e8e8',
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
  try {
    const origin = new URL(url).origin
    await page.loadURL(origin + '/api/figures')
    const exec = code => page.webContents.executeJavaScript(code)
    await exec(`document.body.textContent='';document.body.style='margin:0;background:#e8e8e8';
      window.poseReady=new Promise((resolve,reject)=>{window.poseResolve=resolve;window.poseReject=reject});
      const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
      frame.style='width:720px;height:640px;border:0';window.poseFrame=frame;
      addEventListener('message',e=>{if(e.source!==frame.contentWindow)return;
        if(e.data.t==='error')poseReject(new Error(e.data.message));
        if(e.data.t==='loaded')frame.contentWindow.postMessage({t:'init',entry:'${origin}/packs/minduck-suit-duck/figure.js',
          export:'createSuitDuckBody',base:'${origin}/packs/minduck-suit-duck/',theme:'light',language:'zh',
          bounds:{W:720,H:640,floorY:580,S:1.5},start:{x:300,facing:1,enter:false}},'*');
        if(e.data.t==='ready')poseResolve();});
      frame.src='${origin}/figure-frame?pack=minduck-suit-duck';document.body.append(frame);`)
    await exec('poseReady')
    const send = message => exec(`poseFrame.contentWindow.postMessage(${JSON.stringify(message)},'*')`)
    const tick = count => exec(`(async()=>{for(let i=0;i<${count};i++){
      const next=new Promise((resolve,reject)=>{const listener=e=>{
        if(e.source!==poseFrame.contentWindow)return;
        if(e.data.t==='frame'||e.data.t==='error'){removeEventListener('message',listener);
          e.data.t==='error'?reject(new Error(e.data.message)):resolve(e.data);}};
        addEventListener('message',listener);});
      poseFrame.contentWindow.postMessage({t:'tick',dt:.05},'*');await next;}})()`)
    const frame = page.webContents.mainFrame.frames.find(item => item.url.includes('/figure-frame'))
    assert.ok(frame, 'official Suit Duck frame')
    const measure = () => frame.executeJavaScript(`(()=>{
      const front=document.querySelector('#suit-wing-front'),torso=document.querySelector('#suit-torso');
      const p=node=>new DOMPoint(13.5,27).matrixTransform(node.getScreenCTM());
      const a=p(front),b=p(torso),hand=front.querySelector('path').getBoundingClientRect();
      const laptop=document.querySelector('#suit-laptop'),matrix=laptop.getScreenCTM();
      const keys=[[0,11],[12,11],[10,17],[0,13]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
      const xs=keys.map(p=>p.x),ys=keys.map(p=>p.y);
      const gap=Math.hypot(Math.max(0,Math.min(...xs)-hand.right,hand.left-Math.max(...xs)),
        Math.max(0,Math.min(...ys)-hand.bottom,hand.top-Math.max(...ys)));
      return {shoulderGap:Math.hypot(a.x-b.x,a.y-b.y),keyboardGap:gap};})()`)
    await send({ t: 'set', state: { roam: 'off', thoughtShown: true } })
    await tick(30)
    const samples = []
    // Both facings and several automatic repeats exercise the entire enter/hold/stow sequence.
    for (const facing of [1, -1]) {
      await send({ t: 'place', x: 300, facing })
      await send({ t: 'set', state: { matterActivity: { kind: 'work' } } })
      for (let i = 0; i < 36; i++) {
        await tick(10)
        const layout = await exec(`new Promise(resolve=>{
          const listener=e=>{if(e.source===poseFrame.contentWindow&&e.data.t==='frame'){
            removeEventListener('message',listener);resolve(e.data.layout)}};addEventListener('message',listener);
          poseFrame.contentWindow.postMessage({t:'tick',dt:.00001},'*');})`)
        const value = await measure()
        assert.ok(value.shoulderGap < .01, 'shoulder detached: ' + JSON.stringify({ facing, i, ...value }))
        if (layout.work === 'typing') assert.ok(value.keyboardGap < 12, 'hand misses keyboard: ' + JSON.stringify(value))
        samples.push({ facing, phase: layout.work, ...value })
        if (facing === 1 && i === 3) fs.writeFileSync(path.resolve(__dirname, '../build/companion-suit-work.png'),
          (await page.webContents.capturePage()).toPNG())
      }
      await send({ t: 'set', state: { matterActivity: { kind: 'idle' } } })
      await tick(125)
    }
    assert.ok(samples.some(item => item.phase === 'typing') && samples.some(item => item.phase === 'stowing'))
    console.log('PASS: Suit Duck SVG shoulder attachment and keyboard alignment, both facings, repeated real sandbox work:', samples.length, 'samples')
  } finally { page.destroy() }
}
