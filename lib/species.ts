import {additionalSpecies} from './additional-species-data.ts';
export type SpeciesId = 'ginkgo' | 'osmanthus' | 'iris' | 'oxalis' | 'camphor' | 'acer' | 'ophiopogon';
export type Scenario = { species: SpeciesId; age: number; day: number; seed: number; density: number; wind: number; gravity: number; stiffness: number; moisture:number; compaction:number; soilDepth:number };
export const initialScenario: Scenario = { species: 'ginkgo', age: 45, day: 180, seed: 42, density: 1, wind: 3.2, gravity: 1, stiffness: 1, moisture:.62,compaction:.25,soilDepth:2.5 };
const baseSpecies = [
 {id:'ginkgo' as const,name:'银杏',latin:'Ginkgo biloba',english:'GINKGO',type:'落叶乔木',evidence:'云谷已确认',confirmed:true,maxAge:80,unit:'年',defaultAge:18,color:'#c9ac42',summary:'扇叶、长短枝与一整年的金色叙事。',habit:'喜光，适宜排水良好的土壤；不耐长期积水。长枝构成树冠，短枝承载簇生扇叶。雌雄异株，种子具有肉质外种皮。',growth:'幼苗建立 → 主轴伸长 → 长短枝分化 → 冠幅扩展与干枝增粗。树龄控制拓扑，不强制按统一年龄进入繁殖期。',phenology:'春芽展开，夏季绿叶，秋季逐渐黄化并脱落；冬季木质骨架保留。日期窗为杭州原型先验，需校园复拍校准。',mechanics:'叶簇增加迎风面积；落叶后风载下降。较粗主干更硬，细枝的摆幅和相位不同。',source:'https://plants.ces.ncsu.edu/plants/ginkgo-biloba/',campus:'https://en.westlake.edu.cn/news_events/westlakenews/UniversityNews/202511/t20251117_61335.html',stages:['幼苗建立','主轴伸长','树冠形成','成熟结构'],windows:[['萌芽',70,110],['展叶 / 伸长',100,190],['叶色转变',275,325],['落叶 / 休眠',320,365]]},
 {id:'osmanthus' as const,name:'桂花',latin:'Osmanthus fragrans',english:'SWEET OSMANTHUS',type:'常绿小乔木',evidence:'云谷已确认',confirmed:true,maxAge:40,unit:'年',defaultAge:12,color:'#7b9762',summary:'对生革质叶与藏在叶腋的细小花簇。',habit:'全日照至半阴，湿润且排水良好。浓密冠层常受园艺修剪影响；对生叶、小型叶腋花簇是关键辨识特征。',growth:'育苗 → 新梢伸长 → 多级分枝 → 冠层形成 → 具有繁殖能力后开花。苗木来源与修剪会显著影响形态。',phenology:'常绿，嫩叶逐渐硬化并更新旧叶。当前采用秋花型桂花的 9—10 月窗口；四季桂不可沿用同一花期。',mechanics:'常绿冠层全年保留风载；枝序、叶龄与叶簇质量影响下垂，不能在冬季将叶片全部清空。',source:'https://plants.ces.ncsu.edu/plants/osmanthus-fragrans/',campus:'https://en.westlake.edu.cn/news_events/westlakenews/UniversityNews/202502/t20250227_53204.html',stages:['苗木建立','新梢分枝','冠层形成','成熟结构'],windows:[['新梢 / 嫩叶',65,140],['叶片硬化',130,220],['秋花窗口',245,300],['常绿维持',300,365]]},
 {id:'iris' as const,name:'鸢尾',latin:'Iris tectorum',english:'ROOF IRIS',type:'根状茎草本',evidence:'浙江分布 · 校园待核实',confirmed:false,maxAge:5,unit:'年',defaultAge:2,color:'#8b86bb',summary:'扇状剑叶与三外三内的蓝紫色花。',habit:'多年生根状茎草本。叶长 15—50 cm、宽 1.5—3.5 cm，花茎 20—40 cm。根状茎扩展形成新叶扇。',growth:'根状茎建立 → 扇状叶丛 → 分株扩展 → 抽薹开花 → 蒴果发育。花谢后地下根状茎仍存活。',phenology:'植物志记载 4—5 月花期、6—8 月果期；蓝紫花含三枚外花被和三枚内花被，外花被带白色鸡冠。',mechanics:'剑叶是具有方向刚度的条带；花茎在花和蒴果负载下弯曲。首版采用简化弯曲与风动。',source:'https://www.efloras.org/florataxon.aspx?flora_id=3&taxon_id=200028218',campus:null,stages:['根茎建立','叶扇形成','分株扩展','多年生丛'],windows:[['营养生长',60,120],['开花',90,151],['果期',152,243],['地下部维持',270,365]]},
 {id:'oxalis' as const,name:'酢浆草',latin:'Oxalis corniculata',english:'CREEPING WOODSORREL',type:'匍匐草本',evidence:'浙江分布 · 校园待核实',confirmed:false,maxAge:2,unit:'年',defaultAge:.8,color:'#9eaa44',summary:'贴地扩展、三出心形叶与五瓣黄花。',habit:'低矮匍匐，可一年生或多年生；茎节生根，三出复叶，心形小叶，黄花五瓣。不能与粉花或紫叶酢浆草混淆。',growth:'本模型从带根匍匐茎节建立：首批三出叶 → 匍匐节间伸长 → 新节生根与分枝 → 暖季花结构。蒴果发育和种子弹射尚未求解；既有克隆植株不在每年一月自动归零。',phenology:'暖季可持续生长；具体杭州开花窗和热旱响应待校准。当前花量为演示先验，未模拟种子弹射或昼夜叶片运动。',mechanics:'细长叶柄与贴地匍匐茎分别响应风；冠层覆盖变化影响迎风面积。叶片睡眠运动暂未纳入。',source:'https://efloras.org/florataxon.aspx?flora_id=2&taxon_id=200012375',campus:null,stages:['出苗','匍匐伸长','节生根','群落扩展'],windows:[['生长窗口',60,170],['花 / 蒴果',90,300],['热旱敏感',180,245],['低温减缓',305,365]]}
];
export const species=[...baseSpecies,...additionalSpecies];
export function getSpecies(id:SpeciesId){return species.find(s=>s.id===id)!;}
export function dateLabel(day:number){const d=new Date(Date.UTC(2025,0,Math.max(1,Math.min(365,Math.floor(day)))));return `${d.getUTCMonth()+1}月${d.getUTCDate()}日`;}
export function seasonLabel(day:number){return day<60||day>334?'冬季 · 静候新生':day<152?'春季 · 萌芽展叶':day<244?'夏季 · 冠层生长':'秋季 · 季相演替';}
export function validateScenario(input:unknown):Scenario{
 if(!input||typeof input!=='object')throw new Error('无效场景');
 const v={moisture:.62,compaction:.25,soilDepth:2.5,...input} as Record<string,unknown>;
 if(!species.some(s=>s.id===v.species))throw new Error('未知物种');
 const sp=getSpecies(v.species as SpeciesId);
 const limits:Record<string,[number,number]>={age:[0,sp.maxAge],day:[1,365],seed:[1,999999],density:[.3,1.8],wind:[0,12],gravity:[0,2],stiffness:[.2,3],moisture:[0,1],compaction:[0,1],soilDepth:[.05,8]};
 for(const [key,[min,max]] of Object.entries(limits))if(typeof v[key]!=='number'||!Number.isFinite(v[key])||(v[key] as number)<min||(v[key] as number)>max)throw new Error(`参数 ${key} 超出范围`);
 return Object.fromEntries(['species',...Object.keys(limits)].map(k=>[k,v[k]])) as Scenario;
}
