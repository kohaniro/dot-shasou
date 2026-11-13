import { Layer } from '../layers.js';
import { drawClouds } from './sky.js';
import { drawFar, drawMid, drawNear } from './city.js';
import { drawTrackside } from './trackside.js';

export const clouds = new Layer(1, 0.012, 320, drawClouds);
export const far = new Layer(2, 0.09, 256, drawFar);
export const mid = new Layer(3, 0.28, 256, drawMid);
export const near = new Layer(4, 0.6, 256, drawNear);
export const track = new Layer(5, 1.0, 256, drawTrackside);
export const layers = [clouds, far, mid, near, track];
