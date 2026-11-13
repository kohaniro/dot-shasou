/* ---------- 解像度: 寸法はすべて基準ドット(横320)で書く ---------- */
export const W = 320, SY = 26, SH = 80, VY = 20, VH = 130;
export const SUB = 2; // 2倍の解像度で描き、揺れを半ドットにする
export const RAIL = 250; // 25 m レール（線路際・基準ドットで 1ドット ≒ 10cm）

/* ---------- state（モジュール間で共有する可変状態はここに置く） ---------- */
export const state = {
  seed: 1,
  dist: 0, t: 0, speed: 240, playing: true, last: performance.now(),
  nextJoint: 120, bobs: [], hits: [],
  // 進行（journey.js が書き換える）: phase 'run' | 'brake' | 'stop' | 'depart'、station は stations.js の駅オブジェクト
  phase: 'run', station: null, stopT: 0, door: 0, accel: 0,
  showPass: true
};
