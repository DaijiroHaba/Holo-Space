// CSS-screen placement, independent of camera framing and anatomy transforms.
export function fitFloatingPanel(position,{width,height,panelWidth,panelHeight,margin=8}){
 const w=Math.max(1,Number.isFinite(width)?width:1),h=Math.max(1,Number.isFinite(height)?height:1);
 const m=Math.max(0,Math.min(Number.isFinite(margin)?margin:8,w/2,h/2));
 const pw=Math.max(0,Number.isFinite(panelWidth)?panelWidth:240),ph=Math.max(0,Number.isFinite(panelHeight)?panelHeight:262);
 const maxX=Math.max(m,w-pw-m),maxY=Math.max(m,h-ph-m);
 const x=Number.isFinite(position?.x)?position.x:maxX,y=Number.isFinite(position?.y)?position.y:h*.58;
 return {x:Math.max(m,Math.min(maxX,x)),y:Math.max(m,Math.min(maxY,y))};
}
