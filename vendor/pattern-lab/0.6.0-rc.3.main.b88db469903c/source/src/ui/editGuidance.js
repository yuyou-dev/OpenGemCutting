/** Display guidance supplements the solver's actual reason; it never changes constraints. */
export function editGuidance(result) {
  const actions = {
    PHYSICAL_SCALE_REQUIRED: '先测量宝石的 X 向宽度，再通过“标定尺寸”设置毫米尺度。',
    STOCK_BOUNDARY: '毛坯边界不可移动。请沿原边界选择目标，或改选内部交点。',
    OFF_GEAR_EDIT: '在整体属性中主动选择精确方向模式后重试；已有小数方向不会自动修正。',
    TARGET_NOT_VERTEX: '该目标不是当前实体的真实交点。请选择可保留交点的目标，并核对编辑模式。',
    TOPOLOGY: '请核对是否允许拓扑变化；只有明确接受合并时才更改编辑模式。',
    SYMMETRY: '请核对对称联动与来源的对称信息，再决定是否仅编辑局部。',
    SYMMETRY_UNAVAILABLE: '请核对对称联动与来源的对称信息，再决定是否仅编辑局部。',
  };
  return { code: result.error, action: result.error === 'PHYSICAL_SCALE_REQUIRED' ? 'scale' : 'constraints',
    next: actions[result.error] ?? '打开“编辑设置”核对腰平面锁定、切角上限与编辑模式；可缩小目标位移后重试。当前约束未自动调整。' };
}
