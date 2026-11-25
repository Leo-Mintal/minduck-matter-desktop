// Rebuild static action thumbnails with the same figure/kit renderer as the desktop.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-preview-thumbnails-'))
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, profile],
      { stdio: 'inherit', timeout: 60000 })
    process.exitCode = result.status ?? 1
  } finally { fs.rmSync(profile, { recursive: true, force: true }) }
} else {
  const { app, BrowserWindow } = require('electron')
  const project = path.resolve(__dirname, '..')
  app.setPath('userData', process.argv[2])
  app.whenReady().then(async () => {
    const page = new BrowserWindow({ show: false, width: 400, height: 400, transparent: true,
      webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } })
    const html = path.join(process.argv[2], 'preview.html')
    fs.writeFileSync(html, '<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div>')
    try {
      await page.loadFile(html)
      const kit = pathToFileURL(path.join(project,
        'vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/kit/body.js')).href
      for (const id of ['minduck-duck', 'minduck-suit-duck']) {
        const directory = path.join(project, 'src/companion/figures', id)
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'figure.json'), 'utf8'))
        const entry = pathToFileURL(path.join(directory, manifest.entry)).href
        const output = path.join(directory, 'previews')
        fs.mkdirSync(output, { recursive: true })
        const actions = { 'word-neutral': 'neutral', 'word-walk': 'walk',
          ...(id === 'minduck-suit-duck' ? { 'word-write': 'write' } : {}),
          'task-work': 'work', 'task-ask': 'ask', 'task-success': 'happy', 'task-error': 'sad' }
        for (const [name, word] of Object.entries(actions)) {
          await page.webContents.executeJavaScript(`(async()=>{
            window.thumbBody?.dispose();document.querySelector('#root').replaceChildren();
            const kit=await import(${JSON.stringify(kit)});
            const mod=await import(${JSON.stringify(entry)});
            const body=mod[${JSON.stringify(manifest.export)}]('',{kit,host:{root:document.querySelector('#root'),
              bounds:()=>({W:400,H:400,floorY:370,S:.9}),start:{x:185,facing:1,enter:false},emit(){},sound(){}}});
            window.thumbBody=body;body.set({roam:'off'});body.step(.05);body.do(${JSON.stringify(word)});
            for(let i=0;i<50;i++)body.step(.05);
            body.place(185,1);body.step(.001);
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          })()`)
          const snapshot = await page.webContents.capturePage()
          const thumbnail = snapshot.crop({ x: 45, y: 100, width: 300, height: 300 })
            .resize({ width: 160, height: 160 })
          fs.writeFileSync(path.join(output, name + '.png'), thumbnail.toPNG())
          console.log(`Generated ${id}/previews/${name}.png`)
        }
      }
    } finally { page.destroy() }
  }).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
}
