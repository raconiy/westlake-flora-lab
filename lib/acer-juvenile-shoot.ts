import {organGrowth} from './development.ts';
/** New lifecycle scenario, not a retrospective rescaling of a grown plant.
 * All targets/windows below are engineering priors for normal growing-season
 * development, without environment/carbon feedback. Posta et al. 2025 Fig.2
 * motivates expanded upper leaves near the apex only: its unscaled photograph
 * supplies no millimetres and its inconsistent dates supply no exact DAS clock.
 * Mature centreline geometry and all already formed material sites are fixed.
 */
export const acerJuvenileShootPrior = {
 calibrated: false,
 source: 'https://doi.org/10.17707/AgricultForest.71.4.06',
 internodeTargetsM: [.006,.009,.012,.015,.018,.021],
 extensionWindowsYears: [[.025,.07],[.07,.115],[.115,.16],[.16,.205],[.205,.25],[.25,.295]],
 leafBirthsYears: [.07,.115,.16,.205,.25,.295],
 joinAge: .6,
 assumptions: 'independent internode, phyllochron and blade expansion clocks; bounded juvenile extension; normal growing season; no environment/carbon feedback; not a healthy first-year longitudinal calibration',
} as const;
export const acerAdultHeightAt = (age:number) => (.025+6.5*(1-Math.exp(-age/15)))*organGrowth(.025,.25,age);
export function acerJuvenileNodeHeight(index:number) {
 return acerJuvenileShootPrior.internodeTargetsM.slice(0,index+1).reduce((a,b)=>a+b,0);
}
export function acerShootHeightAt(age:number) {
 const p=acerJuvenileShootPrior,end=p.extensionWindowsYears[5][1],last=acerJuvenileNodeHeight(5);
 if(age<=end)return p.internodeTargetsM.reduce((h,length,i)=>{
  const [birth,finish]=p.extensionWindowsYears[i];return h+length*organGrowth(birth,finish-birth,age);
 },0);
 if(age>=p.joinAge)return acerAdultHeightAt(age);
 // Monotone cubic Hermite: zero speed at the final juvenile segment, old
 // positive height derivative at the join. No age-dependent global scaling.
 const duration=p.joinAge-end,t=(age-end)/duration,delta=acerAdultHeightAt(p.joinAge)-last,
  slope=6.5/15*Math.exp(-p.joinAge/15)*duration;
 return last+(3*delta-slope)*t*t+(slope-2*delta)*t*t*t;
}
/** Actual arrival inverse includes the emergence gate, unlike the old leader
 * inverse. Beyond the juvenile bound, use the unchanged exact adult inverse so
 * branch births, RNG, dimensions and nonjuvenile leaf matrices stay identical.
 */
export function acerShootArrival(height:number) {
 if(height<=0)return .025;
 if(height>=acerAdultHeightAt(acerJuvenileShootPrior.joinAge))
  return -15*Math.log((6.525-height)/6.5);
 let lo:number=.025,hi:number=acerJuvenileShootPrior.joinAge;
 for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(acerShootHeightAt(mid)<height)lo=mid;else hi=mid;}
 return (lo+hi)/2;
}
