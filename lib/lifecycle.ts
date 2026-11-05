/** Age is years since the start of the illustrative seed timeline, not years since campus planting. */
export interface LifecycleStage {
  id: string; label: string; ageStart: number; ageEnd: number;
  description: string;
  /** True means a geometric stage proxy exists, not that its biological mechanisms are solved. */
  implemented: boolean;
  evidence: { type: 'literature-and-engineering-prior'; sources: string[]; note: string };
}
const germinationSource = 'https://doi.org/10.1002/fedr.201400008';
const rootSource = 'https://doi.org/10.3732/ajb.1500312';
const floraSource = 'https://efloras.org/florataxon.aspx?flora_id=2&taxon_id=200005235';
const note = '年龄阈值为交互叙事工程先验，未以校园个体校准；implemented仅表示已有几何阶段代理，不表示该阶段生理机制完整实现；非固定物候日、繁殖成熟年龄或寿命预测。';
export const ginkgoLifecycleLimitations = '当前是种子、胚根、幼苗与成年结构的参数化几何阶段代理；未求解休眠解除、碳分配、光合生长、根水吸收、雌雄繁殖、衰老或死亡，不能称已完成真实全生命周期。';
export const ginkgoStages: LifecycleStage[] = [
  { id: 'seed', label: '种子', ageStart: 0, ageEnd: .02, description: '种子中的胚与储藏组织维持早期发育。画面展示种壳；休眠解除条件与激素过程未模拟。', implemented: true, evidence: { type: 'literature-and-engineering-prior', sources: [germinationSource], note } },
  { id: 'germination', label: '萌发', ageStart: .02, ageEnd: .12, description: '胚根先延伸，芽向上生长。银杏为地下留土萌发，子叶保留于种子内，不画成出土绿子叶；随后出现真叶。', implemented: true, evidence: { type: 'literature-and-engineering-prior', sources: [germinationSource, rootSource], note } },
  { id: 'seedling', label: '幼苗', ageStart: .12, ageEnd: 2, description: '主根与侧根建立，地上主轴、真叶和早期枝芽形成。比例与节奏为程序化原型，尚无校园幼苗量测。', implemented: true, evidence: { type: 'literature-and-engineering-prior', sources: [rootSource, floraSource], note } },
  { id: 'juvenile', label: '幼树', ageStart: 2, ageEnd: 20, description: '主轴和冠层逐步扩展，长枝与短枝分化，木质骨架增粗；修剪与移植历史会改变树形。', implemented: true, evidence: { type: 'literature-and-engineering-prior', sources: [floraSource], note } },
  { id: 'adult', label: '成年结构', ageStart: 20, ageEnd: 100, description: '展示较完整的多级树冠与粗根侧根。此标签指形态阶段，不据此自动生成雌株种子或推断已达繁殖成熟。', implemented: true, evidence: { type: 'literature-and-engineering-prior', sources: [floraSource], note } },
  { id: 'old', label: '老龄 / 衰老待校准', ageStart: 100, ageEnd: 1500, description: '老龄不等于衰败或临近死亡。仅保留扩展入口；空洞、枯枝、断裂、病害及生理衰老尚未实现，不能把树龄直接变成健康损失。', implemented: false, evidence: { type: 'literature-and-engineering-prior', sources: [floraSource, 'https://doi.org/10.1111/1365-2745.13856'], note } }
];
export function getGinkgoStage(age: number): LifecycleStage {
  const safe = Number.isFinite(age) ? Math.max(0, age) : 0;
  return ginkgoStages.find((s, i) => safe >= s.ageStart && (safe < s.ageEnd || i === ginkgoStages.length - 1))!;
}
