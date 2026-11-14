import { Layer } from '../layers.js';
import { drawClouds } from './sky.js';
import { drawFar, drawMid, drawNear } from './landscape.js';
import { drawTrackside } from './trackside.js';
import { drawPlatform, PLAT_F } from './station.js';
import { drawTruss, TRUSS_F } from './bridge.js';
import { drawTunnel, TUN_F } from './tunnel.js';

export const clouds = new Layer(1, 0.012, 320, drawClouds, 1, 0);   // 以下、末尾の2つは pan（カーブで横へ流れる量）と drop（高架で下がるドット数）
export const far = new Layer(2, 0.09, 256, drawFar, 1, 2);
export const mid = new Layer(3, 0.28, 256, drawMid, 0.55, 6);
export const near = new Layer(4, 0.6, 256, drawNear, 0.22, 13);
export const track = new Layer(5, 1.0, 256, drawTrackside);
export const plat = new Layer(6, PLAT_F, 256, drawPlatform); // 駅のホーム（架線より手前。駅の近くでだけ描く）
export const truss = new Layer(7, TRUSS_F, 256, drawTruss); // トラス橋の鉄骨（架線より手前。橋の近くでだけ描く）
export const tunnel = new Layer(8, TUN_F, 256, drawTunnel); // トンネルの壁と坑門（架線より手前。トンネルの近くでだけ描く）
export const layers = [clouds, far, mid, near, track, plat, truss, tunnel];
