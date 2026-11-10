const $ = id => document.getElementById(id);
const cam=$('cam'),ref=$('ref'),range=$('range'),view=$('view');
function show(){
 const close=false;
 ref.options[0].disabled=close;
 if(close && ref.value==='photo')ref.value='r4';
 $('right').src='views/'+cam.value+'-r6.webp';
 $('left').src='views/'+cam.value+'-'+ref.value+'.webp';
 $('ll').textContent='左：'+ref.selectedOptions[0].textContent;
 $('caption').textContent=close?'贴地机位没有对应的实拍微距。这里可比较上版、新版与八卡离线渲染。':'照片和模型使用同一配准机位。建筑和行人不在重建范围。';
}
function split(v){range.value=Math.min(100,Math.max(0,v));view.style.setProperty('--pos',range.value+'%')}
cam.addEventListener('change',show);ref.addEventListener('change',show);
range.addEventListener('input',()=>split(range.value));
function relocate(e){const r=view.getBoundingClientRect();split((e.clientX-r.x)/r.width*100)}
view.addEventListener('pointerdown',e=>{if(e.button!==0)return;view.setPointerCapture(e.pointerId);relocate(e)});
view.addEventListener('pointermove',e=>{if(view.hasPointerCapture(e.pointerId))relocate(e)});
