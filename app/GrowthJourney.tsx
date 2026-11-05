'use client';
import {Play,Pause,Info,Plus,Sprout} from 'lucide-react';
import {getSpecies,dateLabel,type Scenario} from '../lib/species';
import {getGinkgoStage} from '../lib/lifecycle';
import {ageAtProgress,progressAtAge,selectGrowthAge,springObservation,type GrowthClock} from '../lib/growth-timeline';
export {ageAtProgress,progressAtAge} from '../lib/growth-timeline';

export default function GrowthJourney({scenario:s,update,clock,setClock,playing,setPlaying,onSave,onStart}:{scenario:Scenario;update:(v:Partial<Scenario>)=>void;clock:GrowthClock;setClock:(v:GrowthClock)=>void;playing:boolean;setPlaying:(v:boolean|((x:boolean)=>boolean))=>void;onSave:()=>void;onStart:()=>void}){
 const p=getSpecies(s.species),stage=s.species==='ginkgo'?getGinkgoStage(s.age):null;
 const text=s.age<1?`${Math.round(s.age*365)} 天龄`:`${s.age.toFixed(s.age<5?1:0)} 年`;
 const points=s.species==='ginkgo'?[['种子',.005],['胚根 / 芽',.06],['真叶幼苗',.5],['幼树',8],['成年树冠',45]] as const:p.stages.map((v,i)=>[v,p.maxAge*i/(p.stages.length-1)] as const);
 const active=stage?['seed','germination','seedling','juvenile','adult'].indexOf(stage.id):Math.min(points.length-1,Math.floor(s.age/p.maxAge*(points.length-1)));
 const q=clock==='day'?(s.day-1)/364:clock==='life'?progressAtAge(s.age,p.maxAge):s.age/p.maxAge;
 const ended=clock!=='day'&&s.age>=p.maxAge;
 const clockLabel=clock==='day'?'季节':clock==='life'?'全程生长':'年龄';
 function pauseUpdate(patch:Partial<Scenario>){setPlaying(false);update(patch);}
 return <div className="timeline growth-journey">
  <div className="growth-actions"><button className="grow-from-seed" onClick={onStart}><Play size={14}/>{s.species==='ginkgo'?'从种子播放至成年':'从起点播放生长阶段'}</button><button className="spring-preset" onClick={()=>pauseUpdate(springObservation())}>春季观测预设 · {dateLabel(120)}</button></div>
  <div className="timeline-top"><div className="time-switch" role="group" aria-label="选择时间轴">{([['life','全程生长'],['age','年龄'],['day','季节']] as const).map(([id,label])=><button key={id} aria-pressed={clock===id} onClick={()=>{setClock(id);setPlaying(false);}} className={clock===id?'active':''}>{label}</button>)}</div><div className="time-value"><strong>{clock==='day'?dateLabel(s.day):text}</strong><span>{clock==='life'?'非匀速时间':clock==='age'?'生物年龄':'年内物候'}</span></div><button className="play-button" disabled={ended} aria-label={playing?`暂停${clockLabel}演进`:`继续${clockLabel}演进`} aria-pressed={playing} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={15}/>:<Play size={15}/>}</button></div>
  <p className="growth-playback" role="status">{ended?'已到年龄轴终点，可选择阶段或从起点重播':playing?`正在播放${clockLabel}，可随时暂停`:`${clockLabel}已暂停，可继续播放`} · {clock==='day'?'年龄保持不变':'观测日期保持不变'}</p>
  <input aria-label={clock==='day'?'年内物候时间轴':clock==='life'?'完整生长时间轴':'生长年龄时间轴'} aria-valuetext={clock==='day'?dateLabel(s.day):text} className="time-slider" type="range" min={clock==='day'?1:0} max={clock==='day'?365:clock==='life'?1:p.maxAge} step={clock==='life'?.001:clock==='age'?.001:1} value={clock==='day'?Math.floor(s.day):clock==='life'?progressAtAge(s.age,p.maxAge):s.age} onChange={e=>{const n=+e.target.value;pauseUpdate(clock==='day'?{day:n}:selectGrowthAge(clock==='life'?ageAtProgress(n,p.maxAge):n));}} style={{'--progress':`${q*100}%`} as React.CSSProperties}/>
  <div className="timeline-ticks" role="group" aria-label={clock==='day'?'选择观测月份':'选择生长阶段'}>{clock==='day'?['一月','四月','七月','十月'].map((v,i)=><button key={v} onClick={()=>pauseUpdate({day:[15,110,200,290][i]})}><span/>{v}</button>):points.map(([v,a],i)=><button key={v} className={active===i?'active':''} aria-pressed={active===i} onClick={()=>pauseUpdate(selectGrowthAge(a))}><span/>{v}</button>)}</div>
  <div className="growth-stage"><Sprout size={18}/><div><b>当前阶段 · {stage?.label||points[active]?.[0]||p.type}</b><p>{stage?.description||p.growth}</p><p className="growth-clocks">年龄 {text} · 年内第 {Math.floor(s.day)} 天（{dateLabel(s.day)}）· 风动秒钟由视窗独立控制</p></div></div>
  <div className="timeline-foot"><span><Info size={14}/>阶段年龄为未校准工程先验；春季预设只改变日期。</span><button onClick={onSave}>保存参数快照 <Plus size={14}/></button></div>
 </div>;
}
