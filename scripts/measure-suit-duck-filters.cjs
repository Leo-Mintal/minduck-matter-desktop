// Authoring tool: measure local filter geometry in the existing Electron Chromium.
const {app,BrowserWindow}=require('electron')
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..')
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:700,height:500,webPreferences:{offscreen:true,backgroundThrottling:false}})
 const result={}
 try{
  const project=JSON.parse(fs.readFileSync(path.join(root,'assets/companion-suit-duck/project.json'),'utf8'))
  for(const {file} of Object.values(project.flows)){
   const filename=path.join(root,'assets/companion-suit-duck/source',file)
   await win.loadFile(filename)
   const bounds=await win.webContents.executeJavaScript(`(()=>{
    document.getAnimations().forEach(a=>{a.pause();a.currentTime=0});
    const result={};
    for(const filter of document.querySelectorAll('filter')){
     if(!['x','y','width','height'].some(k=>/inf|nan/i.test(filter.getAttribute(k)||'')))continue;
     const refs=[...document.querySelectorAll('[filter]')].filter(n=>n.getAttribute('filter')==='url(#'+filter.id+')');
     if(refs.length!==1)throw new Error('Expected a single filter owner: '+filter.id);
     if(refs[0].querySelector('[transform]'))throw new Error('Review nested transform bounds');
     const b=refs[0].getBBox();
     if(!(b.width>0&&b.height>0))throw new Error('Empty filter geometry');
     const blur=filter.querySelector('feGaussianBlur');
     const sigma=(blur?.getAttribute('stdDeviation')||'0').trim().split(/[ ,]+/).map(Number);
     const px=4*sigma[0],py=4*(sigma[1]??sigma[0]);
     result[filter.id]=[b.x-px,b.y-py,b.width+2*px,b.height+2*py].map(v=>Math.round(v*1e6)/1e6);
    }return result;
   })()`)
   result[file]={sha256:crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),bounds}
  }
  fs.writeFileSync(path.join(root,'assets/companion-suit-duck/filter-bounds.json'),JSON.stringify(result,null,2)+'\n')
  console.log(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,Object.keys(v.bounds).length])))
 }finally{win.destroy();app.quit()}
}).catch(e=>{console.error(e);app.exit(1)})
