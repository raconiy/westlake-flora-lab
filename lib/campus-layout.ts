type CampusSpecies = 'ginkgo'|'osmanthus'|'camphor'|'acer'|'iris'|'oxalis'|'ophiopogon';
type Placement = {id:string; species:CampusSpecies; x:number; z:number; age:number; seed:number; scale:number; density:number};

/** Photo-informed layout prior. Positions and dimensions are engineering priors until a measured site survey is supplied. */
export const yunguCampusLayout: Placement[] = [
  {id:'camphor-01',species:'camphor',x:-8,z:4,age:24,seed:401,scale:1.08,density:.9},
  {id:'camphor-02',species:'camphor',x:0,z:4,age:19,seed:402,scale:.93,density:.86},
  {id:'camphor-03',species:'camphor',x:8,z:4,age:22,seed:403,scale:1.02,density:.9},
  {id:'ginkgo-01',species:'ginkgo',x:-6,z:10,age:17,seed:511,scale:.96,density:.86},
  {id:'ginkgo-02',species:'ginkgo',x:0,z:10,age:13,seed:512,scale:.82,density:.78},
  {id:'ginkgo-03',species:'ginkgo',x:6,z:10,age:16,seed:513,scale:.91,density:.84},
  {id:'osmanthus-01',species:'osmanthus',x:-4,z:-5.1,age:8,seed:621,scale:.72,density:.9},
  {id:'osmanthus-02',species:'osmanthus',x:4,z:-5.35,age:10,seed:622,scale:.78,density:.94},
  {id:'acer-01',species:'acer',x:-12,z:9,age:11,seed:731,scale:.8,density:.84},
  {id:'iris-01',species:'iris',x:-10,z:-4,age:2.2,seed:811,scale:.65,density:.7},
  {id:'iris-02',species:'iris',x:10,z:-4,age:2.4,seed:812,scale:.7,density:.72},
  {id:'oxalis-01',species:'oxalis',x:-7,z:-5,age:1.6,seed:821,scale:.8,density:.75},
  {id:'oxalis-02',species:'oxalis',x:7,z:-5,age:1.8,seed:822,scale:.82,density:.78},
  {id:'ophiopogon-01',species:'ophiopogon',x:-2,z:-6,age:4,seed:831,scale:.7,density:.78},
  {id:'ophiopogon-02',species:'ophiopogon',x:2,z:-6,age:4.5,seed:832,scale:.72,density:.8},
];

// Scene units. The paving top, joint and raised curb all occupy walkable ground.
export const campusPaving = [
  {id:'walkway', x:0, y:.04, z:-1, width:42, height:.08, depth:4.2, color:'#b6b9b0', roughness:.9},
  {id:'joint', x:0, y:.085, z:.4, width:42, height:.085, depth:.08, color:'#9fa39d', roughness:1},
  {id:'curb', x:0, y:.07, z:1.15, width:42, height:.14, depth:.18, color:'#d4d5cd', roughness:.94},
] as const;

// Lawn-side fixtures. The photos guide their placement; positions await survey.
export const campusLamps = [
  {id:'lamp-left', x:-10, z:2},
  {id:'lamp-right', x:10, z:2},
  {id:'lamp-rear', x:0, z:14},
] as const;
export const lampRadii = {postBase:.075, shade:.22} as const;
