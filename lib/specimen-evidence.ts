import type {SpeciesId} from './species';
import {physicalPriors} from './physical-priors.ts';

export type ReferencePhoto = {
  species?: SpeciesId; file: string; author: string; license: string;
  source: string; original: string; licenseUrl: string;
};
type OrganEvidence = {organ: string; literature: string; model: string};
type SpecimenRecord = {
  ncStateSlug: string;
  organs: OrganEvidence[];
  establishment: [string, string, string, string];
  implemented: string;
  remaining: string;
};

/** Morphology is a literature constraint, never a measurement of a Yungu individual.
 * NC State links are references for review; no live retrieval is implied. */
export const specimenEvidence: Record<SpeciesId, SpecimenRecord> = {
  ginkgo: {
    ncStateSlug: 'ginkgo-biloba',
    organs: [
      {organ: '叶', literature: '互生扇叶；短枝上叶片紧密成簇。', model: '扇形叶片、叶柄及枝上叶簇几何。'},
      {organ: '枝', literature: '长枝伸长构冠，短枝节间紧缩。', model: '区分长短枝；主轴与侧枝按年龄建立。'},
      {organ: '地下部', literature: '幼苗先建立胚根，再形成侧根。', model: '主根与侧根的程序化示意，非实测根网。'},
    ],
    establishment: ['种子与胚根', '主轴与真叶', '长短枝分化', '冠幅扩展、干枝增粗'],
    implemented: '种子到成树的几何阶段、扇叶与长短枝、季节叶色和落叶。',
    remaining: '雌雄繁殖、种子形成与休眠解除；枝序和尺度仍待个体采样。',
  },
  osmanthus: {
    ncStateSlug: 'osmanthus-fragrans',
    organs: [
      {organ: '叶', literature: '对生、革质常绿叶。', model: '成对叶节点与叶柄；冬季保留叶冠。'},
      {organ: '花与枝', literature: '叶腋小花簇；花冠四裂。', model: '叶腋花簇与多级分枝；花期由日期窗口控制。'},
      {organ: '地下部', literature: '苗木建立涉及胚根及后续侧根。', model: '胚根和侧根示意；苗木繁殖来源未知。'},
    ],
    establishment: ['种子建立示意', '胚根、芽与对生真叶', '节点侧枝增加', '常绿冠层与叶腋花簇'],
    implemented: '种子、萌发和分枝幼株几何；对生叶及秋花型窗口。',
    remaining: '品种与修剪史、常绿叶龄周转、花芽诱导；不能通用于四季桂。',
  },
  iris: {
    ncStateSlug: 'iris-tectorum',
    organs: [
      {organ: '叶', literature: '二列扇状基生剑叶。', model: '基生叶扇与弯曲条带。'},
      {organ: '花', literature: '三枚外花被、三枚内花被；外花被具鸡冠。', model: '蓝紫色花与鸡冠几何；日期控制花量。'},
      {organ: '地下部', literature: '近表层横向根茎，伴生须根。', model: '表层根茎与须根示意，非水力网络。'},
    ],
    establishment: ['根茎建立', '二列叶扇形成', '根茎横向分株', '多年生叶丛与抽薹'],
    implemented: '叶扇、花被结构和地下根茎示意。',
    remaining: '根茎芽的资源分配、分株存活和蒴果发育；早期建立仅为形态代理。',
  },
  oxalis: {
    ncStateSlug: 'oxalis-corniculata',
    organs: [
      {organ: '叶', literature: '三出复叶，三枚小叶呈倒心形。', model: '三枚心形小叶与细叶柄几何。'},
      {organ: '茎与花', literature: '匍匐茎、节生根；五瓣黄花。', model: '贴地茎连线、叶簇与黄花示意。'},
      {organ: '地下部', literature: '茎节形成不定根，支持贴地扩展。', model: '节点根示意；未求解节点生根概率。'},
    ],
    establishment: ['带根匍匐茎节建立', '匍匐节间伸长', '茎节生根、分枝', '覆盖扩展与开花'],
    implemented: '三出心形叶、五瓣黄花及贴地扩展的几何代理。',
    remaining: '节点生根概率、克隆个体追踪、叶片睡眠运动和种子弹射。',
  },
  camphor: {
    ncStateSlug: 'cinnamomum-camphora',
    organs: [
      {organ: '叶', literature: '互生近革质叶，离基三出脉明显。', model: '互生叶序与叶片几何；叶脉精细结构待校准。'},
      {organ: '树冠', literature: '广展常绿冠层，旧叶持续更新。', model: '主轴和多级侧枝；全年保留叶冠。'},
      {organ: '地下部', literature: '根系受土层、移植与生境影响。', model: '主根与扩展侧根先验，非校园香樟实测根系。'},
    ],
    establishment: ['种子、幼苗建立', '主轴与互生叶', '侧枝、冠幅扩展', '常绿冠层、干枝增粗'],
    implemented: '独立互生叶序、年龄驱动枝序和常绿冠层几何。',
    remaining: '逐叶周转、真实叶脉、修剪移植史与花果发育。',
  },
  acer: {
    ncStateSlug: 'acer-palmatum',
    organs: [
      {organ: '叶', literature: '对生掌状裂叶，常见五至七裂。', model: '对生叶节点、叶柄与掌裂叶几何。'},
      {organ: '枝与季相', literature: '细枝构冠；落叶型，秋季转色。', model: '分层枝冠与夏绿、秋色、冬季落叶窗口。'},
      {organ: '地下部', literature: '嫁接砧木及生境影响根系。', model: '泛化侧根示意，未还原砧木。'},
    ],
    establishment: ['种子或苗木建立', '对生芽、细枝形成', '层状冠幅扩展', '干枝增粗、季节换叶'],
    implemented: '对生掌裂叶、层状冠与季节转色；默认普通绿叶型。',
    remaining: '园艺品种、嫁接与修剪史；转色的色素生理和温度响应。',
  },
  ophiopogon: {
    ncStateSlug: 'ophiopogon-japonicus',
    organs: [
      {organ: '叶', literature: '狭长基生叶丛；常绿地被，非禾本科。', model: '柔性窄叶条带与持续叶丛。'},
      {organ: '地下部', literature: '根茎横向扩展；须根中部分膨大储藏。', model: '根茎、须根和膨大根分别示意。'},
      {organ: '花与种子', literature: '花葶短于叶，六枚花被；成熟种子蓝色。', model: '短花葶与小花几何；种子发育未完整求解。'},
    ],
    establishment: ['新分株建立', '基生狭叶丛形成', '地下根茎、子株扩展', '须根与多年生地被'],
    implemented: '营养分株年龄轴、窄叶、地下克隆结构与夏季小花。',
    remaining: '膨大根的储藏代谢、子株碳交换及蓝色种子发育。',
  },
};

export function ncStateSource(speciesId: SpeciesId) {
  return `https://plants.ces.ncsu.edu/plants/${specimenEvidence[speciesId].ncStateSlug}/`;
}

const httpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

/** Only legacy ginkgo records may be identified by filename. Explicit species wins. */
export function selectReferencePhotos(input: unknown, speciesId: SpeciesId): ReferencePhoto[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.filter((item): item is ReferencePhoto => {
    if (!item || typeof item !== 'object') return false;
    const p = item as Record<string, unknown>;
    if (typeof p.file !== 'string' || !/^[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$/i.test(p.file)) return false;
    const matches = p.species === speciesId ||
      (p.species === undefined && speciesId === 'ginkgo' && /^ginkgo[-.]/i.test(p.file));
    if (!matches || seen.has(p.file) || typeof p.author !== 'string' || !p.author.trim() ||
      typeof p.license !== 'string' || !p.license.trim() ||
      !httpsUrl(p.source) || !httpsUrl(p.original) || !httpsUrl(p.licenseUrl)) return false;
    seen.add(p.file);
    return true;
  });
}

export function referenceAssetUrl(baseUrl: string, file: string) {
  return `${baseUrl.replace(/\/?$/, '/')}references/${encodeURIComponent(file)}`;
}

/** Same baseline as PlantScene; the component has no wind/stiffness multiplier props. */
export function specimenMaterialPriors(speciesId: SpeciesId, age: number) {
  if (!Number.isFinite(age) || age < 0) return null;
  return physicalPriors(speciesId, age);
}

export const unsolvedProcesses = ['光合与碳分配', '休眠解除', '根水吸收与水力输运', '繁殖与种子传播', '衰老与死亡'] as const;
