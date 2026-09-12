import { t } from '../i18n/locale.js';
import { useEffect, useMemo, useRef, useState } from "react";
import { IconCube, IconHandMove, IconRotate3d, IconZoomIn } from "@tabler/icons-react";
import { backgroundColor, resolveOpticsSettings } from "../domain/optics.js";
import { normalizedOpticsPlanes, packOpticsPlaneTexture, normalizedOpticsMesh, packOpticsMeshTextures, opticsMeshFraming } from "../domain/opticsGeometry.js";
import { crossVectors as cross, normalizeVector } from "../utils/vector3.js";
import { clamp } from "../utils/format.js";
import { createOpticsRendererLifecycle } from "./opticsRendererLifecycle.js";
import { createOpticsRenderScheduler } from "./opticsRenderScheduler.js";
import "./OpticsViewport.css";

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uResolution;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uCameraScale;
uniform sampler2D uPlanes;
uniform int uPlaneCount;
uniform bool uMeshMode;
uniform sampler2D uBvhNodes;
uniform sampler2D uTriangles;
uniform int uBvhNodeCount;
uniform float uIor;
uniform float uDispersion;
uniform vec3 uBodyColor;
uniform float uAbsorption;
uniform float uExposure;
uniform float uEnvironmentRotation;
uniform int uEnvironment;
uniform vec3 uObserverDirection;
uniform vec3 uBackground;
uniform int uMaxBounces;
uniform float uFocalOffset;
uniform vec2 uPan;

const int MAX_BOUNCES = 8;
const float EPSILON = 0.0012;

vec4 planeAt(int index) {
  int width = textureSize(uPlanes, 0).x;
  return texelFetch(uPlanes, ivec2(index % width, index / width), 0);
}

bool intersectConvex(vec3 origin, vec3 direction, out float nearT, out float farT, out vec3 nearNormal) {
  nearT = -1e5;
  farT = 1e5;
  nearNormal = vec3(0.0, 0.0, 1.0);
  for (int index = 0; index < uPlaneCount; index += 1) {
    vec4 plane = planeAt(index);
    float denominator = dot(plane.xyz, direction);
    float signedDistance = plane.w - dot(plane.xyz, origin);
    if (abs(denominator) < 1e-6) {
      if (signedDistance < 0.0) return false;
      continue;
    }
    float distance = signedDistance / denominator;
    if (denominator < 0.0 && distance > nearT) {
      nearT = distance;
      nearNormal = plane.xyz;
    } else if (denominator > 0.0) {
      farT = min(farT, distance);
    }
    if (nearT > farT) return false;
  }
  return farT > max(nearT, 0.0);
}

bool nextBoundary(vec3 origin, vec3 direction, out float hitT, out vec3 hitNormal) {
  hitT = 1e5;
  hitNormal = vec3(0.0, 0.0, 1.0);
  for (int index = 0; index < uPlaneCount; index += 1) {
    vec4 plane = planeAt(index);
    float denominator = dot(plane.xyz, direction);
    if (denominator <= 1e-6) continue;
    float distance = (plane.w - dot(plane.xyz, origin)) / denominator;
    if (distance > EPSILON && distance < hitT) {
      hitT = distance;
      hitNormal = plane.xyz;
    }
  }
  return hitT < 1e4;
}

float dielectricFresnel(float cosineIncident, float n1, float n2) {
  float cosI = clamp(abs(cosineIncident), 0.0, 1.0);
  float ratio = n1 / n2;
  float sinTSquared = ratio * ratio * max(0.0, 1.0 - cosI * cosI);
  if (sinTSquared >= 1.0) return 1.0;
  float cosT = sqrt(max(0.0, 1.0 - sinTSquared));
  float parallel = ((n2 * cosI) - (n1 * cosT)) / max(1e-6, (n2 * cosI) + (n1 * cosT));
  float perpendicular = ((n1 * cosI) - (n2 * cosT)) / max(1e-6, (n1 * cosI) + (n2 * cosT));
  return 0.5 * (parallel * parallel + perpendicular * perpendicular);
}

vec3 rotateEnvironment(vec3 direction) {
  float angle = radians(uEnvironmentRotation);
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec3(
    cosine * direction.x - sine * direction.y,
    sine * direction.x + cosine * direction.y,
    direction.z
  );
}

vec3 environmentRadiance(vec3 rawDirection) {
  vec3 worldDirection = normalize(rawDirection);
  vec3 direction = rotateEnvironment(worldDirection);
  float horizon = smoothstep(-0.6, 0.85, direction.z);
  vec3 base = mix(vec3(0.12, 0.14, 0.16), vec3(0.92, 0.91, 0.88), horizon);
  if (uEnvironment == 1) base = mix(vec3(0.035, 0.045, 0.06), vec3(0.82, 0.76, 0.66), horizon);
  if (uEnvironment == 2) base = mix(vec3(0.012, 0.016, 0.022), vec3(0.42, 0.50, 0.60), horizon);

  float leftPanel = pow(max(0.0, dot(direction, normalize(vec3(-0.72, -0.36, 0.58)))), 42.0);
  float rightPanel = pow(max(0.0, dot(direction, normalize(vec3(0.78, 0.18, 0.52)))), 70.0);
  float crownPanel = pow(max(0.0, dot(direction, normalize(vec3(0.08, 0.18, 0.98)))), 110.0);
  float warmStrip = pow(max(0.0, dot(direction, normalize(vec3(-0.15, 0.96, 0.22)))), 95.0);
  float darkCard = pow(max(0.0, dot(direction, normalize(vec3(0.18, -0.92, 0.34)))), 4.0);
  float darkCardTwo = pow(max(0.0, dot(direction, normalize(vec3(-0.64, 0.68, 0.35)))), 5.0);

  vec3 panels = leftPanel * vec3(5.6, 6.0, 6.6)
    + rightPanel * vec3(7.2, 6.4, 5.8)
    + crownPanel * vec3(4.0, 4.4, 5.2)
    + warmStrip * vec3(3.3, 1.9, 0.8);
  float darkStrength = uEnvironment == 2 ? 1.2 : 0.88;
  float observerCard = smoothstep(0.91, 0.985, dot(worldDirection, normalize(uObserverDirection)));
  vec3 radiance = max(vec3(0.006), base + panels - (darkCard + darkCardTwo) * darkStrength);

  if (uEnvironment == 3) {
    float azimuth = atan(worldDirection.y, worldDirection.x);
    float eightFold = 0.5 + 0.5 * cos(8.0 * azimuth);
    float polar = dot(worldDirection, normalize(uObserverDirection));
    float scopeRing = smoothstep(0.22, 0.72, polar) * (1.0 - smoothstep(0.88, 0.97, polar));
    float scopeSegments = mix(0.12, 1.0, smoothstep(0.35, 0.78, eightFold));
    vec3 scopeWhite = vec3(1.55, 1.48, 1.38) * mix(0.34, 1.0, scopeSegments * scopeRing);
    vec3 scopeRed = vec3(1.2, 0.055, 0.11) * (1.0 - scopeSegments) * scopeRing;
    radiance = vec3(0.035) + scopeWhite + scopeRed;
    observerCard = smoothstep(0.84, 0.975, polar);
  }

  return max(vec3(0.004), radiance * mix(1.0, uEnvironment == 3 ? 0.035 : 0.16, observerCard));
}

vec3 traceGem(vec3 rayOrigin, vec3 rayDirection, float ior, vec3 absorptionColor) {
  float nearT;
  float farT;
  vec3 entryNormal;
  if (!intersectConvex(rayOrigin, rayDirection, nearT, farT, entryNormal) || nearT < 0.0) {
    return vec3(-1.0);
  }

  vec3 entryPoint = rayOrigin + rayDirection * nearT;
  float entryFresnel = dielectricFresnel(dot(-rayDirection, entryNormal), 1.0, ior);
  vec3 radiance = environmentRadiance(reflect(rayDirection, entryNormal)) * entryFresnel;
  vec3 insideDirection = refract(rayDirection, entryNormal, 1.0 / ior);
  if (dot(insideDirection, insideDirection) < 1e-7) return radiance;

  vec3 throughput = vec3(1.0 - entryFresnel);
  vec3 insideOrigin = entryPoint + insideDirection * EPSILON;
  for (int bounce = 0; bounce < MAX_BOUNCES; bounce += 1) {
    if (bounce >= uMaxBounces) break;
    float boundaryT;
    vec3 boundaryNormal;
    if (!nextBoundary(insideOrigin, insideDirection, boundaryT, boundaryNormal)) break;
    vec3 boundaryPoint = insideOrigin + insideDirection * boundaryT;
    throughput *= exp(-absorptionColor * boundaryT);
    float fresnel = dielectricFresnel(dot(insideDirection, boundaryNormal), ior, 1.0);
    vec3 exitDirection = refract(insideDirection, -boundaryNormal, ior);
    if (dot(exitDirection, exitDirection) > 1e-7) {
      radiance += throughput * (1.0 - fresnel) * environmentRadiance(exitDirection);
    }
    throughput *= fresnel;
    if (max(throughput.r, max(throughput.g, throughput.b)) < 0.002) break;
    insideDirection = reflect(insideDirection, boundaryNormal);
    insideOrigin = boundaryPoint + insideDirection * EPSILON;
  }
  return radiance;
}

vec4 meshTexel(sampler2D source, int index) {
  int width = textureSize(source, 0).x;
  return texelFetch(source, ivec2(index % width, index / width), 0);
}

bool meshBounds(vec3 origin, vec3 direction, vec3 minimum, vec3 maximum, float limit) {
  float nearT = 0.0;
  float farT = limit;
  for (int axis = 0; axis < 3; axis += 1) {
    if (abs(direction[axis]) < 1e-12) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return false;
    } else {
      float a = (minimum[axis] - origin[axis]) / direction[axis];
      float b = (maximum[axis] - origin[axis]) / direction[axis];
      nearT = max(nearT, min(a, b));
      farT = min(farT, max(a, b));
      if (nearT > farT) return false;
    }
  }
  return true;
}

bool intersectMesh(vec3 origin, vec3 direction, out float hitT, out vec3 hitNormal, out vec3 hitPoint) {
  hitT = 1e20;
  hitNormal = vec3(0.0);
  hitPoint = vec3(0.0);
  int node = 0;
  while (node < uBvhNodeCount) {
    vec4 minimum = meshTexel(uBvhNodes, node * 3);
    vec4 maximum = meshTexel(uBvhNodes, node * 3 + 1);
    if (!meshBounds(origin, direction, minimum.xyz, maximum.xyz, hitT)) {
      node = int(minimum.w);
      continue;
    }
    int start = int(maximum.w);
    int count = int(meshTexel(uBvhNodes, node * 3 + 2).x);
    for (int index = start; index < start + count; index += 1) {
      vec3 a = meshTexel(uTriangles, index * 4).xyz;
      vec3 ab = meshTexel(uTriangles, index * 4 + 1).xyz;
      vec3 ac = meshTexel(uTriangles, index * 4 + 2).xyz;
      vec3 p = cross(direction, ac);
      float determinant = dot(ab, p);
      if (abs(determinant) < 1e-12) continue;
      vec3 relative = origin - a;
      float u = dot(relative, p) / determinant;
      if (u < -1e-6 || u > 1.000001) continue;
      vec3 q = cross(relative, ab);
      float v = dot(direction, q) / determinant;
      if (v < -1e-6 || u + v > 1.000001) continue;
      float distance = dot(ac, q) / determinant;
      if (distance > 1e-7 && distance < hitT) {
        hitT = distance;
        // Stay on the triangle surface. Advancing origin + t * direction can
        // magnify distance error at grazing angles and put the next ray back
        // inside this boundary even after its normal offset.
        hitPoint = a + (u * ab + v * ac);
        hitNormal = meshTexel(uTriangles, index * 4 + 3).xyz;
      }
    }
    node += 1;
  }
  return hitT < 1e19;
}

// Depth-first Fresnel splitting retains both reflection and transmission paths.
// Air paths also query the mesh: a concavity or a second component may be hit.
// Eight user-selected interactions need at most nine pending paths, independent
// of triangle count; the existing bounce limit truncates energy, not geometry.
vec3 traceMeshGem(vec3 origin, vec3 direction, float ior, vec3 absorptionColor) {
  float firstT;
  vec3 firstNormal;
  vec3 firstPoint;
  if (!intersectMesh(origin, direction, firstT, firstNormal, firstPoint)) return vec3(-1.0);
  vec3 origins[9];
  vec3 directions[9];
  vec3 weights[9];
  int depths[9];
  bool interiors[9];
  origins[0] = origin;
  directions[0] = direction;
  weights[0] = vec3(1.0);
  depths[0] = 0;
  interiors[0] = false;
  int pending = 1;
  vec3 radiance = vec3(0.0);
  const float MESH_EPSILON = 0.000002;
  // A complete binary tree of depth eight has 511 paths.
  for (int path = 0; path < 511; path += 1) {
    if (pending == 0) break;
    pending -= 1;
    vec3 rayOrigin = origins[pending];
    vec3 rayDirection = directions[pending];
    vec3 weight = weights[pending];
    int depth = depths[pending];
    bool inside = interiors[pending];
    float distance;
    vec3 normal;
    vec3 point;
    if (!intersectMesh(rayOrigin, rayDirection, distance, normal, point)) {
      radiance += weight * environmentRadiance(rayDirection);
      continue;
    }
    if (depth >= uMaxBounces) continue;
    if (inside) weight *= exp(-absorptionColor * distance);
    bool entering = dot(rayDirection, normal) < 0.0;
    vec3 incidentNormal = entering ? normal : -normal;
    float n1 = entering ? 1.0 : ior;
    float n2 = entering ? ior : 1.0;
    float fresnel = dielectricFresnel(dot(-rayDirection, incidentNormal), n1, n2);
    vec3 reflectionWeight = weight * fresnel;
    if (max(reflectionWeight.r, max(reflectionWeight.g, reflectionWeight.b)) >= 0.002) {
      origins[pending] = point + incidentNormal * MESH_EPSILON;
      directions[pending] = reflect(rayDirection, incidentNormal);
      weights[pending] = reflectionWeight;
      depths[pending] = depth + 1;
      interiors[pending] = !entering;
      pending += 1;
    }
    vec3 transmission = refract(rayDirection, incidentNormal, n1 / n2);
    vec3 transmissionWeight = weight * (1.0 - fresnel);
    if (dot(transmission, transmission) > 1e-7 && max(transmissionWeight.r, max(transmissionWeight.g, transmissionWeight.b)) >= 0.002) {
      origins[pending] = point - incidentNormal * MESH_EPSILON;
      directions[pending] = transmission;
      weights[pending] = transmissionWeight;
      depths[pending] = depth + 1;
      interiors[pending] = entering;
      pending += 1;
    }
  }
  return radiance;
}

vec3 sceneBackground(vec3 rayOrigin, vec3 rayDirection) {
  float vertical = smoothstep(0.0, 1.0, vUv.y);
  vec3 color = uBackground * mix(0.94, 1.035, vertical);
  if (rayDirection.z < -0.0001) {
    float floorT = (-1.08 - rayOrigin.z) / rayDirection.z;
    if (floorT > 0.0) {
      vec3 floorPoint = rayOrigin + rayDirection * floorT;
      float shadow = exp(-2.0 * dot(floorPoint.xy, floorPoint.xy));
      color *= 1.0 - shadow * 0.105;
    }
  }
  vec2 centered = vUv - 0.5;
  color *= 1.0 - 0.055 * dot(centered, centered);
  return color;
}

void main() {
  vec2 centered = (gl_FragCoord.xy / uResolution - 0.5) * 2.0;
  centered.x *= uResolution.x / max(uResolution.y, 1.0);
  centered.x += uFocalOffset;
  centered -= uPan;
  vec3 rayOrigin = uCameraPosition;
  vec3 rayDirection = normalize(
    uCameraForward
    + uCameraRight * centered.x * uCameraScale
    + uCameraUp * centered.y * uCameraScale
  );

  float redIor = max(1.001, uIor - uDispersion * 0.48);
  float blueIor = uIor + uDispersion * 0.52;
  vec3 absorptionColor = vec3(uAbsorption) - log(max(uBodyColor, vec3(0.02))) * 0.9;
  vec3 colorR = uMeshMode ? traceMeshGem(rayOrigin, rayDirection, redIor, absorptionColor) : traceGem(rayOrigin, rayDirection, redIor, absorptionColor);
  if (colorR.r < 0.0) {
    outColor = vec4(sceneBackground(rayOrigin, rayDirection), 1.0);
    return;
  }
  vec3 colorG = uMeshMode ? traceMeshGem(rayOrigin, rayDirection, uIor, absorptionColor) : traceGem(rayOrigin, rayDirection, uIor, absorptionColor);
  vec3 colorB = uMeshMode ? traceMeshGem(rayOrigin, rayDirection, blueIor, absorptionColor) : traceGem(rayOrigin, rayDirection, blueIor, absorptionColor);
  vec3 color = vec3(colorR.r, colorG.g, colorB.b);
  color *= exp2(uExposure);
  color = clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  outColor = vec4(color, 1.0);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  const shaders = [];
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]]) {
      const shader = compileShader(gl, type, source);
      shaders.push(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    // The linked program owns its executable; shader handles need no longer live.
    shaders.forEach((shader) => gl.deleteShader(shader));
  }
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function cameraOrbitForView(viewMode) {
  if (viewMode === "top") return { yaw: 0, elevation: Math.PI / 2 };
  if (viewMode === "bottom") return { yaw: 0, elevation: -Math.PI / 2 };
  if (viewMode === "front") return { yaw: 0, elevation: 0 };
  if (viewMode === "side") return { yaw: Math.PI / 2, elevation: 0 };
  return null;
}

function cameraFrame(camera) {
  const orbit = camera;
  const horizontal = Math.cos(orbit.elevation);
  const position = [
    Math.sin(orbit.yaw) * horizontal * 4.4,
    -Math.cos(orbit.yaw) * horizontal * 4.4,
    Math.sin(orbit.elevation) * 4.4,
  ];
  const forward = normalizeVector(position.map((item) => -item));
  const right = [Math.cos(orbit.yaw), Math.sin(orbit.yaw), 0];
  const up = normalizeVector(cross(right, forward));
  return { position, forward, right, up };
}

function environmentIndex(id) {
  return id === "jewelry" ? 1 : id === "contrast" ? 2 : id === "hearts" ? 3 : 0;
}

function createRenderer(canvas, onError) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) {
    onError("当前浏览器不支持 WebGL 2 光学仿真。");
    return null;
  }
  try {
    const program = createProgram(gl);
    const position = gl.getAttribLocation(program, "aPosition");
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const textures = Array.from({ length: 3 }, (_, unit) => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // All sampler uniforms need complete textures, including inactive branches.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
      return texture;
    });
    const location = (name) => gl.getUniformLocation(program, name);
    const uniforms = Object.fromEntries([
      "uResolution", "uCameraPosition", "uCameraForward", "uCameraRight", "uCameraUp",
      "uCameraScale", "uPlanes", "uPlaneCount", "uMeshMode", "uBvhNodes", "uTriangles", "uBvhNodeCount", "uIor", "uDispersion",
      "uBodyColor", "uAbsorption", "uExposure", "uEnvironmentRotation", "uEnvironment", "uObserverDirection",
      "uBackground", "uMaxBounces", "uFocalOffset", "uPan",
    ].map((name) => [name, location(name)]));
    gl.useProgram(program);
    gl.uniform1i(uniforms.uPlanes, 0);
    gl.uniform1i(uniforms.uBvhNodes, 1);
    gl.uniform1i(uniforms.uTriangles, 2);

    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let uploadedGeometry = null;
    const scheduler = createOpticsRenderScheduler({
      gl, onError,
      render({ geometry, settings, camera, focusOffset = 0 }) {
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5, 1100 / Math.max(canvas.clientWidth, canvas.clientHeight));
        const width = Math.max(2, Math.round(canvas.clientWidth * ratio));
        const height = Math.max(2, Math.round(canvas.clientHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        if (geometry !== uploadedGeometry) {
          try {
            const packed = geometry.mesh
              ? packOpticsMeshTextures(geometry.mesh, maxTextureSize)
              : { planes: packOpticsPlaneTexture(geometry.planes, maxTextureSize) };
            for (const [unit, texture] of [[0, packed.planes], [1, packed.nodes], [2, packed.triangles]]) {
              if (!texture) continue;
              gl.activeTexture(gl.TEXTURE0 + unit);
              gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, texture.width, texture.height, 0, gl.RGBA, gl.FLOAT, texture.data);
            }
            if (gl.getError() !== gl.NO_ERROR) {
              throw new Error("当前显卡无法上传完整实体数据，无法显示光学仿真；未省略任何面片。");
            }
            uploadedGeometry = geometry;
            onError("");
          } catch (error) {
            uploadedGeometry = null;
            gl.clearColor(0.96, 0.96, 0.96, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            onError(error.message);
            return;
          }
        }
        textures.forEach((texture, unit) => {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, texture);
        });
        const frame = cameraFrame(camera);
        let meshFraming;
        if (geometry.mesh) {
          const inspector = focusOffset ? canvas.parentElement?.parentElement?.querySelector(".optics-inspector") : null;
          const canvasBounds = canvas.getBoundingClientRect();
          const covered = inspector ? Math.max(0, canvasBounds.right - inspector.getBoundingClientRect().left + 24) : 0;
          meshFraming = opticsMeshFraming(geometry.mesh, {
            width: canvas.clientWidth, height: canvas.clientHeight, occludedRight: covered,
          });
        }
        gl.uniform2f(uniforms.uResolution, width, height);
        gl.uniform3fv(uniforms.uCameraPosition, frame.position);
        gl.uniform3fv(uniforms.uCameraForward, frame.forward);
        gl.uniform3fv(uniforms.uCameraRight, frame.right);
        gl.uniform3fv(uniforms.uCameraUp, frame.up);
        gl.uniform1f(uniforms.uCameraScale, (meshFraming?.cameraScale ?? 0.34) / camera.zoom);
        gl.uniform1i(uniforms.uPlaneCount, geometry.planes?.length ?? 0);
        gl.uniform1i(uniforms.uMeshMode, geometry.mesh ? 1 : 0);
        gl.uniform1i(uniforms.uBvhNodeCount, geometry.mesh?.nodes.length ?? 0);
        gl.uniform1f(uniforms.uIor, settings.material.ior);
        gl.uniform1f(uniforms.uDispersion, settings.material.dispersion);
        gl.uniform3fv(uniforms.uBodyColor, hexToRgb(settings.material.bodyColor));
        gl.uniform1f(uniforms.uAbsorption, settings.material.absorption);
        gl.uniform1f(uniforms.uExposure, settings.view.exposure);
        gl.uniform1f(uniforms.uEnvironmentRotation, settings.view.environmentRotation);
        gl.uniform1i(uniforms.uEnvironment, environmentIndex(settings.view.environment));
        gl.uniform3fv(uniforms.uObserverDirection, normalizeVector(frame.position));
        gl.uniform3fv(uniforms.uBackground, hexToRgb(backgroundColor(settings)));
        gl.uniform1i(uniforms.uMaxBounces, settings.advanced.maxBounces);
        gl.uniform1f(uniforms.uFocalOffset, meshFraming?.focusOffset ?? focusOffset);
        gl.uniform2f(uniforms.uPan, camera.panX, camera.panY);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        canvas.dataset.renderStage = "complete";
      },
    });
    return {
      gl,
      draw: scheduler.draw,
      destroy() {
        scheduler.destroy();
        textures.forEach((texture) => gl.deleteTexture(texture));
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      },
    };
  } catch (error) {
    onError(`光学着色器初始化失败：${error.message}`);
    return null;
  }
}

export function OpticsViewport({ polyhedron, settings, viewMode = "perspective", onViewModeChange, inspectorOpen = true }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [error, setError] = useState("");
  const cameraRef = useRef({ yaw: -0.62, elevation: 0.42, ...cameraOrbitForView(viewMode), zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef(null);
  const transitionRef = useRef(0);
  const previousViewRef = useRef(viewMode);
  const perspectiveRef = useRef({ yaw: -0.62, elevation: 0.42 });
  const resolvedSettings = useMemo(() => resolveOpticsSettings(settings), [settings]);
  const geometry = useMemo(() => {
    if (polyhedron.kind === "mesh") {
      const mesh = normalizedOpticsMesh(polyhedron);
      return { mesh, faceCount: mesh.faceCount };
    }
    return normalizedOpticsPlanes(polyhedron);
  }, [polyhedron]);
  const drawRef = useRef(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = createOpticsRendererLifecycle(canvas, {
      createRenderer,
      onError(message) {
        setError(message);
        canvas.dataset.error = message;
      },
      onRestore: () => drawRef.current(),
    });
    rendererRef.current = renderer;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, []);

  drawRef.current = () => rendererRef.current?.draw({
    geometry,
    settings: resolvedSettings,
    camera: cameraRef.current,
    focusOffset: inspectorOpen ? 0.23 : 0,
  });

  useEffect(() => {
    drawRef.current();
  }, [geometry, inspectorOpen, resolvedSettings, viewMode]);

  useEffect(() => {
    if (previousViewRef.current === viewMode) return undefined;
    const camera = cameraRef.current;
    if (previousViewRef.current === "perspective") perspectiveRef.current = { yaw: camera.yaw, elevation: camera.elevation };
    previousViewRef.current = viewMode;
    if (dragRef.current) return undefined;
    const target = cameraOrbitForView(viewMode) ?? perspectiveRef.current;
    const start = { yaw: camera.yaw, elevation: camera.elevation };
    const yawDelta = Math.atan2(Math.sin(target.yaw - start.yaw), Math.cos(target.yaw - start.yaw));
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520;
    const started = performance.now();
    const frame = (now) => {
      const t = duration ? Math.min(1, (now - started) / duration) : 1;
      const eased = t * t * (3 - 2 * t);
      camera.yaw = start.yaw + yawDelta * eased;
      camera.elevation = start.elevation + (target.elevation - start.elevation) * eased;
      drawRef.current();
      transitionRef.current = t < 1 ? requestAnimationFrame(frame) : 0;
    };
    transitionRef.current = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(transitionRef.current); transitionRef.current = 0; };
  }, [viewMode]);

  // Match GemViewport's lock: the wheel listener must be non-passive so the
  // canvas zoom never leaks into page scroll, and touchmove stays inside the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      cameraRef.current.zoom = clamp(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.0012), 0.55, 2.4);
      drawRef.current();
    };
    const onTouchMove = (event) => event.preventDefault();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const resetCamera = () => {
    cancelAnimationFrame(transitionRef.current);
    transitionRef.current = 0;
    previousViewRef.current = "perspective";
    cameraRef.current = { yaw: -0.62, elevation: 0.42, zoom: 1, panX: 0, panY: 0 };
    onViewModeChange?.("perspective");
    drawRef.current();
  };

  return (
    <section className="optics-viewport" aria-label={t("宝石光学仿真视口")}>
      <canvas
        ref={canvasRef}
        className="optics-viewport__canvas"
        data-testid="optics-webgl-canvas"
        tabIndex="0"
        role="application"
        aria-label={t("物理宝石光学仿真。拖拽旋转，Shift 加拖拽平移，滚轮缩放，0 键复位。")}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          if (transitionRef.current) {
            cancelAnimationFrame(transitionRef.current);
            transitionRef.current = 0;
            previousViewRef.current = "perspective";
            onViewModeChange?.("perspective");
          }
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            yaw: cameraRef.current.yaw,
            elevation: cameraRef.current.elevation,
            panX: cameraRef.current.panX,
            panY: cameraRef.current.panY,
            pan: event.shiftKey,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (drag.pan) {
            cameraRef.current.panX = drag.panX + dx * 0.002;
            cameraRef.current.panY = drag.panY - dy * 0.002;
          } else {
            cameraRef.current.yaw = drag.yaw + dx * 0.008;
            cameraRef.current.elevation = drag.elevation + dy * 0.008;
            previousViewRef.current = "perspective";
            onViewModeChange?.("perspective");
          }
          drawRef.current();
        }}
        onPointerUp={() => {
          dragRef.current = null;
          drawRef.current();
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          drawRef.current();
        }}
        onDoubleClick={resetCamera}
        onKeyDown={(event) => {
          if (event.key === "0") resetCamera();
          if (event.key === "+" || event.key === "=") cameraRef.current.zoom = Math.min(2.4, cameraRef.current.zoom * 1.08);
          if (event.key === "-") cameraRef.current.zoom = Math.max(0.55, cameraRef.current.zoom / 1.08);
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) {
            event.preventDefault();
            cancelAnimationFrame(transitionRef.current);
            transitionRef.current = 0;
            if (event.key === "ArrowLeft") cameraRef.current.yaw -= 0.08;
            if (event.key === "ArrowRight") cameraRef.current.yaw += 0.08;
            const elevationDelta = event.key === "ArrowUp" ? -0.06 : event.key === "ArrowDown" ? 0.06 : 0;
            cameraRef.current.elevation += elevationDelta;
            previousViewRef.current = "perspective";
            onViewModeChange?.("perspective");
            drawRef.current();
          }
        }}
      />
      {error ? <p className="optics-viewport__error">{t(error)}</p> : null}
      <div className="optics-orientation" aria-hidden="true">
        <IconCube size={27} stroke={1.25} />
        <span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span>
      </div>
      <div className="optics-viewport__hints" aria-label={t("仿真视口操作提示")}>
        <span><IconRotate3d size={15} stroke={1.7} />{t("拖拽旋转")}</span>
        <span><IconZoomIn size={15} stroke={1.7} />{t("滚轮缩放")}</span>
        <span><IconHandMove size={15} stroke={1.7} />{t("Shift + 拖拽平移")}</span>
      </div>
      <span className="optics-viewport__geometry-status">{t("视口实体 ·")} {t(geometry.faceCount)} {polyhedron.kind === "mesh" ? t("面片") : t("面")}{(polyhedron.kind === "mesh" ? polyhedron.faces.some((face) => face.region === "rough" || face.sourceOperationId === "rough-mesh") : polyhedron.faces.some((face) => face.sourceOperationId === "rough-cube")) ? t("（含毛坯面）") : t("（全部为刻面）")}</span>
    </section>
  );
}
