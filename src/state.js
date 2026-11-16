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
  // 線形（course.js）: curve −1..1（正 = 窓がカーブの外側）と elev 0..1（高架）は窓の中央の地点の値で、main.js の render() が書く。
  // lean は curve をなめらかに追わせた値（つり革の傾き。journey.js が書く）
  curve: 0, elev: 0, lean: 0,
  // 時間帯と天気（clock.js）。todFix / wxFix はデバッグ用の固定（null = 自動。todFix は時刻の数値、wxFix は 'clear' | 'cloud' | 'rain' | 'snow'。'rain:0.5' のように強さも付けられる）。
  // hour（0..24）と wx（{ cloud, rain, snow } 各 0..1）は窓の中央の地点の連続値、tone は景色に今かかっているトーン（段階に丸めた値。tone.js）。
  // 切り替えのクロスフェード中は toneTo が次のトーン、toneK が進み具合 0..1。toneSnap を立てると次の描画でフェードせずに作り直す
  todFix: null, wxFix: null, hour: 12, wx: { cloud: 0, rain: 0, snow: 0 }, tone: null, toneTo: null, toneK: 0, toneSnap: false,
  rate: 1,// 再生速度（デバッグ用。1フレームに update() を rate 回くり返す。0 は停止。1 以外の間は音を止める）
  passMode: 'on' // 乗客の表示: 'on'（あり）| 'sil'（シルエット）| 'off'（なし）
};
