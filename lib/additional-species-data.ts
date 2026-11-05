/** Additional researched candidates. Ages/day windows are UI priors, not measured campus growth. */
export type AdditionalSpeciesId = 'camphor' | 'acer' | 'ophiopogon';
export interface AdditionalSpeciesRecord {
 id: AdditionalSpeciesId; name: string; latin: string; english: string; type: string;
 evidence: string; confirmed: boolean; maxAge: number; unit: string; defaultAge: number;
 color: string; summary: string; habit: string; growth: string; phenology: string;
 mechanics: string; source: string; campus: string | null; stages: string[];
 windows: (string | number)[][];
}
export const additionalSpecies: AdditionalSpeciesRecord[] = [
 {
  id:'camphor',name:'香樟',latin:'Cinnamomum camphora',english:'CAMPHOR TREE',type:'常绿大乔木',
  evidence:'云谷已确认 · 个体待量测',confirmed:true,maxAge:120,unit:'年',defaultAge:24,color:'#72926a',
  summary:'离基三出脉、互生革质叶与广展的常绿树冠。',
  habit:'常绿大乔木，喜光，适宜湿润且排水良好的生境。植物志叶长6—12 cm、宽2.5—5.5 cm，叶柄2—3 cm，互生、近革质，离基三出脉明显；树高可达30 m，非校园默认测量值。',
  growth:'出苗建立 → 主轴与侧枝伸长 → 枝序增加、冠幅扩展 → 干枝次生增粗。幼叶与老叶替换、修剪及移植历史需要独立记录，不能仅整体缩放树冠。',
  phenology:'常绿并持续更新旧叶。植物志记载4—5月开花、8—11月果期；绿白至淡黄小花约3 mm，成熟果紫黑、直径6—8 mm。逐日换叶与春梢日期为待校准先验，冬季不落光。',
  mechanics:'宽展枝冠与常绿叶量影响全年风载，自重作用在倾斜枝上产生弯矩。当前地下部分按泛化木本侧根角色展示，根深、根长、刚度、阻尼和风阻均为未校准先验，不代表校园香樟实测。',
  source:'https://www.efloras.org/florataxon.aspx?flora_id=2&taxon_id=200008697',
  campus:'https://en.westlake.edu.cn/news_events/westlakenews/UniversityNews/202403/t20240305_37607.html',
  stages:['幼苗建立','侧枝伸长','树冠扩展','成熟结构'],
  windows:[['春梢 / 换叶示意',60,125],['开花',91,151],['果期',213,334],['常绿维持',1,365]]
 },
 {
  id:'acer',name:'鸡爪槭',latin:'Acer palmatum',english:'JAPANESE MAPLE',type:'落叶小乔木',
  evidence:'杭州栽培有研究依据 · 校园待核实',confirmed:false,maxAge:80,unit:'年',defaultAge:14,color:'#b37150',
  summary:'对生掌状裂叶，从夏绿到秋色的细枝层次。',
  habit:'落叶乔木或灌木，叶对生、掌状5—7裂，部分园艺型更多裂或细裂。植物志叶片约3—6×4—8 cm；暖热环境适宜疏荫、湿润且排水良好的土壤，避炎热干燥与强风。品种未鉴定，不能默认红枫品种。',
  growth:'种子或嫁接苗建立 → 细枝与对生芽形成 → 多级分枝、层状冠幅展开 → 木质结构增粗。嫁接、修剪和品种会显著改变树形与生长速度。',
  phenology:'默认普通绿叶型：春季展叶、夏季绿叶、秋季转黄橙红后落叶，冬季保留木质骨架。杭州原始研究曾于10月下旬至12月上旬跟踪转色，逐年窗口仍须实测；品种未知时不得全季红。',
  mechanics:'细枝、叶柄与掌状叶分别承受风载，自重使倾斜枝弯曲；落叶后冠层风载下降。当前地下部分为泛化木本侧根角色，未还原嫁接砧木或校园根系；根与枝叶材料参数均未校准。',
  source:'https://www.iplant.cn/foc/pdf/Acer.pdf',campus:null,
  stages:['苗木建立','细枝分化','层状冠扩展','成熟结构'],
  windows:[['展叶 / 春花示意',90,151],['夏季绿叶',152,285],['秋色观察窗',295,340],['落叶 / 休眠示意',335,365]]
 },
 {
  id:'ophiopogon',name:'麦冬',latin:'Ophiopogon japonicus',english:'MONDO GRASS',type:'常绿根茎地被',
  evidence:'浙江分布 · 校园待核实',confirmed:false,maxAge:8,unit:'年',defaultAge:2,color:'#5e8062',
  summary:'狭长弧形叶、六枚花被与地下克隆扩展。',
  habit:'多年生常绿草本，形似草但非禾本科。叶基生丛集，条状，通常长10—50 cm、宽2—4 mm；喜半阴至阴处、湿润且排水良好的土壤。不可与山麦冬属Liriope混同。',
  growth:'种子或分株建立 → 基生叶丛形成 → 地下匍匐茎 / 根茎横向扩展并形成子株 → 须根部分膨大储藏 → 开花及种子发育。膨大根是根组织，不能画成匍匐茎上的分株芽。',
  phenology:'常绿地上叶丛持续更新，不能每年冬季归零。植物志花期5—8月、种子成熟期8—9月；花葶通常6—15 cm且明显短于叶，花下垂，白至淡紫、6枚花被，成熟蓝色种子直径7—8 mm。',
  mechanics:'细长叶以基部固定的柔性条带表达弯曲，叶群风载与自重随叶长改变；地下匍匐结构、细根与膨大根为不同器官。当前根系采用泛化根茎 / 须根角色，尚非物种实测根网或吸水模型，根深、膨大根及材料参数均未校准。',
  source:'https://www.efloras.org/florataxon.aspx?flora_id=2&taxon_id=200027794',campus:null,
  stages:['分株建立','叶丛形成','地下横向扩展','多年生地被'],
  windows:[['叶丛 / 分株生长示意',60,180],['开花',121,243],['蓝色种子成熟',213,273],['常绿维持',1,365]]
 }
];
/** Alias for data consumers; the records have the same keys as species.ts. */
export const additionalSpeciesData = additionalSpecies;
