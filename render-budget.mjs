export function renderPixelRatio(width,height,dpr=1,light=false){
 const pixels=Math.max(1,width)*Math.max(1,height),budget=light?1280*720:1920*1080;
 return Math.min(Number.isFinite(dpr)&&dpr>0?dpr:1,light?1:1.5,Math.sqrt(budget/pixels));
}
