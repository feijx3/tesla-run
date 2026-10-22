// 全局可调参数
export const LANE_X = [-3.4, 0, 3.4];
export const GRAVITY = 36;
export const JET_VY = 16;          // 地面起飞初速
export const JET_VY_AIR = 14.5;    // 空中二段喷气初速
export const ENERGY_MAX = 100;
export const JET_COST = 50;        // 一次喷气翻滚消耗
export const ENERGY_REGEN_GROUND = 50;
export const ENERGY_REGEN_AIR = 10;
export const CELL_ENERGY = 20;     // 每个电芯回复的能量
export const ROLL_TIME = 0.78;     // 一圈侧向桶滚耗时（秒）
export const FLIP_TIME = 0.86;     // 一圈后空翻耗时（秒）
export const SPAWN_Z = -280;
export const DESPAWN_Z = 16;

// 车体碰撞盒（略小于模型，手感更宽容）
export const CAR_HALF_W = 0.78;
export const CAR_HALF_L = 1.8;
export const CAR_H = 1.15;
export const CAR_PIVOT = 0.55;     // 车身中心离地高度

export const PAINTS = [
  { name: '珍珠白', color: 0xd3d7dd },
  { name: '烈焰红', color: 0xb00a14 },
  { name: '星际银', color: 0x9aa3ad },
  { name: '深海蓝', color: 0x0c3ca8 },
  { name: '隐形黑', color: 0x121217 },
];
