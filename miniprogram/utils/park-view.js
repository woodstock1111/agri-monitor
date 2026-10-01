// Plot slots on the park painting. Outlines come from the artwork's delivered plot data
// (park-regions.js, generated); one world unit is one px of assets/park/park-world.jpg.
const { IMAGE_WIDTH, IMAGE_HEIGHT, REGIONS } = require('./park-regions.js')
const WORLD_WIDTH = IMAGE_WIDTH
const WORLD_HEIGHT = IMAGE_HEIGHT
// Slots fill in id order, which runs top to bottom, so a small park stays at the top.
const slotById = new Map()
function geometry(records) {
  const used = new Set()
  const slots = new Map()
  for (const record of records) {
    const slot = slotById.get(record.id)
    if (slot !== undefined && !used.has(slot)) { slots.set(record.id,slot); used.add(slot) }
  }
  for (const record of records) {
    if (slots.has(record.id)) continue
    const slot = REGIONS.findIndex((_,index)=>!used.has(index))
    if (slot >= 0) { slots.set(record.id,slot);slotById.set(record.id,slot);used.add(slot) }
  }
  return records.map(record=>{
    const region=REGIONS[slots.get(record.id)]
    if(!region)return {...record,mapped:false,slot:-1,swatch:'#c9c7b4',points:[],cx:WORLD_WIDTH/2,cy:WORLD_HEIGHT/2,left:0,top:0,size:0,h:0}
    const points=region.points.map(([x,y])=>({x,y}))
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y)
    const left=Math.min(...xs),top=Math.min(...ys)
    return {...record,mapped:true,slot:slots.get(record.id),swatch:region.swatch,glow:region.glow,glowSrc:'/assets/park/glow/'+region.id+'.png',points,cx:region.center[0],cy:region.center[1],left,top,size:Math.max(...xs)-left,h:Math.max(...ys)-top}
  })
}
// Screen placement (px inside the map view) for tags and halos at the page's rpx ratio.
function place(plots,ratio){
  const r=v=>Math.round(v*ratio*10)/10
  return plots.map(p=>p.mapped?{...p,tagX:r(p.cx),tagY:r(p.cy),glowStyle:`left:${r(p.glow.x)}px;top:${r(p.glow.y)}px;width:${r(p.glow.w)}px;height:${r(p.glow.h)}px`}:p)
}
// The unlocked area: an ellipse round the plots in use, sized so every plot outline sits inside
// 80% of it (fog only starts fading in at 86%). Everything outside is under fog, like a game map.
function clearing(plots){
  const mapped=plots.filter(p=>p.mapped)
  if(!mapped.length)return {cx:WORLD_WIDTH/2,cy:WORLD_HEIGHT*.2,rx:WORLD_WIDTH*.3,ry:WORLD_HEIGHT*.12}
  const e=extent(plots),cx=(e.left+e.right)/2,cy=(e.top+e.bottom)/2
  let rx=(e.right-e.left)/2*1.42+60,ry=(e.bottom-e.top)/2*1.42+80,k=0
  for(const p of mapped)for(const q of p.points)k=Math.max(k,Math.hypot((q.x-cx)/rx,(q.y-cy)/ry))
  const grow=Math.max(1,k/.8)
  return {cx,cy,rx:rx*grow,ry:ry*grow}
}
// Fog layer in screen px (inside the map view). Only the lower half of the clearing's surroundings
// is fogged — a dome-shaped frontier below the unlocked plots; above them the map stays open.
// One radial-gradient wash starting at the clearing's centre line, plus cloud puffs along the arc.
function fog(plots,ratio){
  const c=clearing(plots),r=v=>Math.round(v*ratio*10)/10
  const tint='rgba(240,237,224,'
  const wash=`top:${r(c.cy)}px;height:${r(WORLD_HEIGHT-c.cy)}px;background:radial-gradient(${r(c.rx)}px ${r(c.ry)}px at ${r(c.cx)}px 0px,${tint}0) 0%,${tint}0) 86%,${tint}.45) 94%,${tint}.7) 100%)`
  // Puffs sit just outside the arc so they soften it without reaching into the clearing.
  const puffs=[],count=16
  for(let i=0;i<=count;i++){
    const a=i/count*Math.PI
    for(const [k,size,alpha] of [[1.08,300,.9],[1.32,420,.65]]){
      const x=c.cx+Math.cos(a)*c.rx*k,y=c.cy+Math.sin(a)*c.ry*k
      if(x<-size/2||x>WORLD_WIDTH+size/2||y>WORLD_HEIGHT+size/2||y<c.cy+size*.2)continue
      puffs.push({id:i+'-'+k,flip:i%2===1,style:`left:${r(x-size/2)}px;top:${r(y-size*.4)}px;width:${r(size)}px;height:${r(size*.8)}px;opacity:${alpha}`})
    }
  }
  return {wash,puffs}
}
// Camera box (world px): far enough round the plots in use that each can sit at the view centre,
// and no further — the map does not scroll on into the fog.
function cameraBox(plots,viewW,viewH){
  const mapped=plots.filter(p=>p.mapped)
  const xs=mapped.length?mapped.map(p=>p.cx):[WORLD_WIDTH/2],ys=mapped.length?mapped.map(p=>p.cy):[WORLD_HEIGHT*.2]
  let left=Math.min(...xs)-viewW/2,right=Math.max(...xs)+viewW/2,top=Math.min(...ys)-viewH/2,bottom=Math.max(...ys)+viewH/2
  left=Math.max(0,left);top=Math.max(0,top);right=Math.min(WORLD_WIDTH,Math.max(right,left+viewW));bottom=Math.min(WORLD_HEIGHT,Math.max(bottom,top+viewH))
  return {left,top,width:right-left,height:bottom-top}
}
// Plot under a world point, or failing that the one with the nearest centre.
function nearest(plots,x,y){
  let best=null,distance=Infinity
  for(const p of plots){
    if(!p.mapped)continue
    if(contains(p.points,x,y))return p
    const d=Math.hypot(p.cx-x,p.cy-y);if(d<distance){best=p;distance=d}
  }
  return best
}
// World box covering the plots in use; the camera may roam this plus a forest margin.
function extent(plots){
  const mapped=plots.filter(p=>p.mapped)
  if(!mapped.length)return {left:0,top:0,right:WORLD_WIDTH,bottom:WORLD_HEIGHT}
  return {left:Math.min(...mapped.map(p=>p.left)),top:Math.min(...mapped.map(p=>p.top)),right:Math.max(...mapped.map(p=>p.left+p.size)),bottom:Math.max(...mapped.map(p=>p.top+p.h))}
}
function contains(points,x,y){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if(((a.y>y)!==(b.y>y))&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside}return inside}
module.exports={WORLD_WIDTH,WORLD_HEIGHT,REGIONS,geometry,place,fog,cameraBox,nearest,extent,contains}
