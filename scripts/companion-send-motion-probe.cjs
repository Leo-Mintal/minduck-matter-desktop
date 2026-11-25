const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Inspect the real opaque SVG sandbox while clicking the actual quick-send button.
module.exports = async function probeSendMotion(page, waitFor) {
  const evaluate = source => page.webContents.executeJavaScript(source)
  const send = (method, params) => page.webContents.debugger.sendCommand(method, params)
  const frame = page.webContents.mainFrame.frames.find(item => item.url.includes('/figure-frame'))
  assert.ok(frame, 'real figure sandbox is mounted')
  await frame.executeJavaScript(`(()=>{
    window.sendMotion={samples:[],record:false};
    addEventListener('message',event=>{
      if(event.data?.t!=='tick'||!sendMotion.record)return;
      const roots=[...document.querySelectorAll('[data-flow]')].filter(n=>getComputedStyle(n).display!=='none');
      const base=document.querySelector('[data-suit-base]');
      const paths=roots.flatMap(root=>[...root.querySelectorAll('path[fill="#FDD200"]')]).filter(path=>{
        for(let node=path;node&&node!==document.documentElement;node=node.parentElement){
          const s=getComputedStyle(node);if(s.display==='none'||Number(s.opacity)<.99)return false;
        }return true;
      });
      sendMotion.samples.push({time:performance.now(),flows:roots.map(n=>n.dataset.flow),
        source:roots.map(n=>Number(n.dataset.sourceTime)),base:base&&getComputedStyle(base).display,
        bodies:paths.map(p=>{const r=p.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})});
    });
  })()`)
  await evaluate(`(()=>{
    window.sendMotionFrame=document.querySelector('#figureLayer iframe');
    panelProbe.output({active:true,status:'waiting',conversationId:'send-before',turnId:'turn-before',
      text:'等待确认',detail:'发送后继续工作',activity:{kind:'ask'}});
    Object.defineProperty(panelProbe,'reply',{configurable:true,get(){
      if(panelProbe.actions.at(-1)==='chat-send'){
        panelProbe.output({active:true,status:'running',conversationId:'send-after',turnId:'turn-after',
          text:'正在工作',detail:'发送后的真实状态切换',activity:{kind:'work'}});
        return {ok:true,conversationId:'send-after'};
      }
    }});
  })()`)
  await waitFor(() => evaluate('panelProbe.layout?.ask'), value => value === 'waiting', 'confirmation hold')
  async function click(selector, shadow = false) {
    const point = await evaluate(`(()=>{const root=${shadow ? "document.querySelector('.minduck-quick').shadowRoot" : 'document'};
      const r=root.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', ...point, button:'none', buttons:0 })
    for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', {
      type, ...point, button:'left', buttons:type === 'mousePressed' ? 1 : 0, clickCount:1,
    })
  }
  const hit = await evaluate('panelProbe.layout.hit[0]')
  await send('Input.dispatchMouseEvent', { type:'mouseMoved', ...hit, button:'none', buttons:0 })
  await waitFor(() => evaluate('!document.querySelector(".minduck-actions").hidden'), Boolean, 'quick controls')
  await click('[data-action="new-chat"]')
  await waitFor(() => evaluate('document.querySelector(".minduck-quick").shadowRoot.querySelector("textarea")?.disabled'),
    value => value === false, 'quick editor is ready')
  await evaluate(`(()=>{const input=document.querySelector('.minduck-quick').shadowRoot.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'继续执行');
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));})()`)
  await new Promise(resolve => setTimeout(resolve, 300))
  await frame.executeJavaScript('sendMotion.record=true;void 0')
  await click('.pet-quick-send', true)
  await waitFor(() => evaluate('panelProbe.layout?.work'), value => value === 'typing', 'work after quick send')
  await frame.executeJavaScript('sendMotion.record=false;void 0')
  const samples = await frame.executeJavaScript('sendMotion.samples')
  const runs = samples.map(sample => sample.flows.join(',')).filter((flow, i, all) => i === 0 || flow !== all[i-1])
  const output = path.resolve(__dirname, '../build/companion-send-motion.json')
  fs.writeFileSync(output, JSON.stringify({ runs, samples }, null, 2) + '\n')
  assert.equal(await evaluate('sendMotionFrame===document.querySelector("#figureLayer iframe")'), true, 'sending reuses the figure iframe')
  console.log('Send motion diagnostic:', JSON.stringify({ runs, frames:samples.length,
    bodyCounts:[...new Set(samples.map(sample => sample.bodies.length))] }))
  assert.deepEqual(runs, ['ask','work'], 'confirmation goes straight into work without an intervening idle pose')
  assert.ok(samples.length >= 20, 'sample the complete stow and next entrance')
  assert.ok(samples.every(sample => sample.bodies.length === 1), 'every rendered frame retains one opaque body')
  await frame.executeJavaScript('sendMotion.samples=[];sendMotion.record=true;void 0')
  await evaluate(`panelProbe.output({active:true,status:'waiting',conversationId:'send-after',turnId:'turn-after',
    text:'等待确认',detail:'工作后需要确认',activity:{kind:'ask'}});void 0`)
  await waitFor(() => evaluate('panelProbe.layout?.ask'), value => value === 'waiting', 'confirmation after work')
  await frame.executeJavaScript('sendMotion.record=false;void 0')
  const reverse = await frame.executeJavaScript('sendMotion.samples')
  const reverseRuns = reverse.map(sample => sample.flows.join(',')).filter((flow, i, all) => i === 0 || flow !== all[i-1])
  fs.writeFileSync(output, JSON.stringify({ runs, samples, reverseRuns, reverse }, null, 2) + '\n')
  assert.deepEqual(reverseRuns, ['work','ask'], 'work also joins directly into confirmation')
  assert.ok(reverse.every(sample => sample.bodies.length === 1), 'reverse transitions keep a single opaque body')
  console.log('PASS: quick send and reverse activity changes retain the figure iframe, original stow/entrance and one opaque body without an intermediate idle frame')
}
