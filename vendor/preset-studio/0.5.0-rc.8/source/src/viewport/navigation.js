import { createViewportCamera } from '../../vendor/viewport-navigation/1.0.0/index.js';
export * from '../../vendor/viewport-navigation/1.0.0/index.js';
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
// This renderer orbits the camera; the shared controller rotates the model.
export const cameraFromPose = pose => createViewportCamera({ yaw: -rad(pose.yaw), pitch: -rad(pose.elevation), zoom: pose.zoom, panX: pose.pan[0], panY: pose.pan[1] });
export const poseFromCamera = camera => ({ yaw: -deg(camera.yaw), elevation: -deg(camera.pitch), zoom: camera.zoom, pan: [camera.panX, camera.panY] });
