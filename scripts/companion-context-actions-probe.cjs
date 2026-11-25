const assert = require('node:assert/strict')

module.exports = async function probeContextActions({ companion, client, evaluate, waitFor }) {
  const exceptions=[]
  client.on('Runtime.exceptionThrown',({exceptionDetails})=>exceptions.push(exceptionDetails.exception?.description?.split('\n')[0] || exceptionDetails.text))
  await client.send('Runtime.enable')
  await evaluate(`window.contextMenuLayout=null;addEventListener('message',event=>{
    if(event.data?.t==='frame')contextMenuLayout=event.data.layout;
  });window.menuClicks=[];document.addEventListener('click',event=>{
    const item=event.target.closest('[data-pet-action]');if(item)menuClicks.push(item.dataset.petAction);
  },true);window.menuShown=null;petHost.onShown(shown=>menuShown=shown);void 0`)
  const mouse = (type, point, button='left') => client.send('Input.dispatchMouseEvent',{
    type,x:point.x,y:point.y,button:type==='mouseMoved'?'none':button,
    buttons:type==='mousePressed'?(button==='right'?2:1):0,clickCount:type==='mouseMoved'?0:1,
  })
  async function openPetMenu() {
    const point=await waitFor(()=>evaluate('contextMenuLayout?.hit?.[0]'),Boolean,'native pet hit target')
    await mouse('mouseMoved',point)
    for(const type of ['mousePressed','mouseReleased'])await mouse(type,point,'right')
    await waitFor(()=>evaluate('!document.getElementById("menu").hidden'),Boolean,'native right-click menu')
    await waitFor(()=>evaluate('document.getElementById("menu").getAnimations().every(a=>a.playState==="finished")'),Boolean,'native menu opening settles')
  }
  async function clickPetMenu(id) {
    // The offscreen menu probe covers actual mouse delivery. Exercise the real
    // preload/Core action here independently of macOS moving focus between apps.
    await evaluate(`document.querySelector('[data-pet-action="${id}"]').click();void 0`)
  }
  await openPetMenu()
  await clickPetMenu('settings')
  const settings=await waitFor(()=>companion.getSettingsWindow(),Boolean,'right-click opens real integrated settings')
  await waitFor(()=>settings.webContents.getURL(),value=>value.includes('/coopanion/#/pet'),'desktop pet settings route')
  await waitFor(()=>settings.webContents.isLoading(),value=>!value,'real settings finishes loading before closing')
  await waitFor(()=>settings.webContents.executeJavaScript('document.body.innerText'),
    text=>text.includes('习惯') && text.includes('装扮'),'integrated settings navigation renders')
  assert.equal(settings.getTitle(),'Minduck 桌宠设置')
  console.log('Context menu probe: real settings opened')
  settings.close()
  await waitFor(()=>companion.getSettingsWindow(),value=>!value,'settings closes normally')
  await openPetMenu()
  await clickPetMenu('hide')
  const hidden=await waitFor(()=>companion.panel('state'),value=>value?.connected && !value.onDesktop,'right-click hides only the pet window')
    .catch(async error=>{
      const state=await companion.panel('state');
      console.error('Context hide diagnostic:',{connected:state?.connected,inWindow:state?.inWindow,onDesktop:state?.onDesktop,exceptions,
        page:await evaluate('({clicks:menuClicks,shown:menuShown,menuHidden:document.getElementById("menu").hidden})')});
      throw error;
    })
  assert.equal(hidden.skin.figure,'minduck-duck')
  assert.equal(companion.status().state,'running','hiding does not stop Core or the main client')
  await companion.show()
  await waitFor(()=>companion.panel('state'),value=>value?.connected && value.onDesktop,'hidden pet can be shown again')
  console.log('PASS: native right-click menu opens the integrated pet settings and hides/reopens only the pet without stopping Core')
}
