// Bundle the shared Matter input and button primitives; never rebuild or edit the shared client for this feature.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const esbuild = require('../vendor/coopanion/runtime/node_modules/esbuild')
const root = path.resolve(__dirname,'..')
const source = path.resolve(process.env.MINDUCK_WEB_SOURCE || path.join(root,'../minduck-matter-web-prod'))
const output = path.join(root,'vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/minduck-qa')
async function build() {
  fs.mkdirSync(output,{recursive:true})
  const styles = ['tokens/colors.css','tokens/typography.css','tokens/motion.css','tokens/geometry.css',
    'primitives/buttons.css']
  const css = await esbuild.build({ stdin:{ contents:styles.map(file => `@import ${JSON.stringify('./'+file)};`).join('\n'),
    resolveDir:path.join(source,'src/design'), loader:'css' }, bundle:true, write:false, minify:true,
    outfile:'qa.css', loader:{'.svg':'dataurl'} })
  const sheet = css.outputFiles[0].text.replace(/:root\[data-theme=["']?(light|dark)["']?\]/gu,':host([data-theme="$1"])')
    .replace(/:root/gu,':host') + fs.readFileSync(path.join(root,'src/companion/ui/qa.css'),'utf8')
  fs.writeFileSync(path.join(output,'styles.js'),`export default ${JSON.stringify(sheet)};\n`)
  const result = await esbuild.build({ entryPoints:[path.join(root,'src/companion/ui/qa.tsx')], bundle:true,
    format:'esm', target:'chrome144', jsx:'automatic', minify:true, metafile:true,
    outfile:path.join(output,'view.js'), loader:{'.svg':'dataurl'}, define:{'process.env.NODE_ENV':'"production"'},
    alias:{ '@matter':path.join(source,'src'), react:path.join(source,'node_modules/react'),
      'react-dom':path.join(source,'node_modules/react-dom') } })
  const inputs = Object.entries(result.metafile.inputs).map(([file,details]) => ({
    source:file.includes('minduck-matter-web-prod/') ? file.split('minduck-matter-web-prod/')[1] : path.relative(root,path.resolve(file)),
    bytes:details.bytes, sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  }))
  fs.writeFileSync(path.join(output,'SOURCE.json'),JSON.stringify({ description:'Desktop QA card with shared Matter ChatInput, Button and design tokens; no backend or shared Web changes.',
    inputs, styles:styles.map(file => ({ source:'src/design/'+file,
      sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'src/design',file))).digest('hex') })) },null,2)+'\n')
  const reactDom = path.dirname(require.resolve('react-dom/package.json',{paths:[source]}))
  const licenses = ['react','react-dom','scheduler'].map(name => {
    const directory = path.dirname(require.resolve(name+'/package.json',{paths:[source,reactDom]}))
    return name+'\n'+fs.readFileSync(path.join(directory,'LICENSE'),'utf8')
  })
  fs.writeFileSync(path.join(output,'LICENSES.txt'),licenses.join('\n\n'))
  console.log('Built compact Matter QA:',output)
}
build().catch(error => { console.error(error);process.exitCode=1 })
