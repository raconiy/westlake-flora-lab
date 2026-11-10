export const roles = Object.freeze({
  botany: '植物生长与形态',
  physics: '力学、根系与土壤',
  scene: '校园布局与渲染',
  infra: '助手、网关与基础设施',
  qa: '测试与发布验收',
});

export const roleIds = Object.keys(roles);

export function workerRoles(index, count) {
  return roleIds.filter((_, i) => i % count === index);
}
