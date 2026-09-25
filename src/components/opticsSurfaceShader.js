// Consume the fixed laboratory's accepted BSDF, VNDF and random-dimension code
// directly. This adapter supplies the host's boundary traversal, environment
// sampling, camera and accumulation only.
import { traceShader } from '../../vendor/pattern-lab/0.6.0-rc.3.main.b88db469903c/source/src/render/shaders.js';
import { FRAGMENT_SHADER } from './opticsWebglRenderer.js';
import { MAX_SURFACE_PLANES } from '../domain/opticsSurface.js';

const between = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Optics shader anchor missing: ${start}`);
  return source.slice(from, to);
};
const replaceOnce = (source, anchor, replacement) => {
  if (source.split(anchor).length !== 2) throw new Error(`Optics shader anchor must occur once: ${anchor}`);
  return source.replace(anchor, replacement);
};

/** Lab GLSL: mixbits/rnd/powerHeuristic/basis and fresnel/lambda/Dggx/visibleNormal/evalBSDF. */
export const LAB_RANDOM_SOURCE = between(traceShader, 'uint mixbits(', 'vec3 rotateZ(');
export const LAB_BSDF_SOURCE = between(traceShader, 'float fresnel(', 'vec3 capAxis(');

/** The host environment's four light panels, shared by radiance and its sampler.
 * Values mirror environmentRadiance() in the host shader; a test keeps them equal. */
export const ENVIRONMENT_PANELS = Object.freeze([
  { axis: [-0.72, -0.36, 0.58], power: 42, pick: .30 },
  { axis: [0.78, 0.18, 0.52], power: 70, pick: .22 },
  { axis: [0.08, 0.18, 0.98], power: 110, pick: .10 },
  { axis: [-0.15, 0.96, 0.22], power: 95, pick: .10 },
]);
const glslFloat = value => Number.isInteger(value) ? `${value}.0` : String(value);
const panelArray = (type, values) => `${type}[4](${values.join(', ')})`;

let base = FRAGMENT_SHADER.slice(0, FRAGMENT_SHADER.indexOf('void main() {'));
base = replaceOnce(base, 'precision highp float;', 'precision highp float;\nprecision highp int;');
base = replaceOnce(base, 'out vec4 outColor;', 'layout(location = 0) out vec4 outColor;\nlayout(location = 1) out vec4 outGuide;');
base = replaceOnce(base, 'hitNormal = meshTexel(uTriangles, index * 4 + 3).xyz;',
  'hitNormal = meshTexel(uTriangles, index * 4 + 3).xyz;\n        materialSlot = index;');
base = replaceOnce(base, 'uniform vec2 uResolution;', `uniform sampler2D uMaterials;
uniform sampler2D uPrevious;
uniform int uAccumulatedSamples;
uniform int uBatchSamples;
uniform bool uConvex;
uniform bool uPlaneMode;
// Convex solids: half-spaces and [alpha, scatter, face id, 0] in constant memory.
layout(std140) uniform SurfacePlanes {
  vec4 surfacePlanes[${MAX_SURFACE_PLANES}];
  vec4 surfaceMaterials[${MAX_SURFACE_PLANES}];
};
int materialSlot;
bool stochastic;
uint seed;
int dimension;
int uSample;
const float PI = 3.141592653589793;
uniform vec2 uResolution;`);

export const surfaceFragmentShader = `${base}
${LAB_RANDOM_SOURCE}
${LAB_BSDF_SOURCE}
const vec3 PANEL_AXES[4] = ${panelArray('vec3', ENVIRONMENT_PANELS.map(({ axis }) => `normalize(vec3(${axis.map(glslFloat).join(', ')}))`))};
const float PANEL_POWERS[4] = ${panelArray('float', ENVIRONMENT_PANELS.map(({ power }) => glslFloat(power)))};
const float PANEL_PICKS[4] = ${panelArray('float', ENVIRONMENT_PANELS.map(({ pick }) => glslFloat(pick)))};
const float UNIFORM_PICK = ${glslFloat(1 - ENVIRONMENT_PANELS.reduce((sum, { pick }) => sum + pick, 0))};
const float SURFACE_EPSILON = 0.000002;
const int MAX_BATCH = 16;

vec3 unrotateEnvironment(vec3 direction) {
  float angle = radians(uEnvironmentRotation);
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec3(cosine * direction.x + sine * direction.y, -sine * direction.x + cosine * direction.y, direction.z);
}

// Mixture of a uniform sphere and one power-cosine lobe per light panel; the
// observation-scope environment has no panels and uses the uniform term only.
float environmentPdf(vec3 worldDirection) {
  float pdf = (uEnvironment == 3 ? 1.0 : UNIFORM_PICK) / (4.0 * PI);
  if (uEnvironment == 3) return pdf;
  vec3 direction = rotateEnvironment(normalize(worldDirection));
  for (int panel = 0; panel < 4; panel += 1) {
    pdf += PANEL_PICKS[panel] * (PANEL_POWERS[panel] + 1.0) / (2.0 * PI)
      * pow(max(0.0, dot(direction, PANEL_AXES[panel])), PANEL_POWERS[panel]);
  }
  return pdf;
}

vec3 sampleEnvironment() {
  float pick = rnd();
  float height = rnd();
  float azimuth = 2.0 * PI * rnd();
  if (uEnvironment == 3 || pick < UNIFORM_PICK) {
    float z = 1.0 - 2.0 * height;
    float radius = sqrt(max(0.0, 1.0 - z * z));
    return vec3(radius * cos(azimuth), radius * sin(azimuth), z);
  }
  pick -= UNIFORM_PICK;
  int chosen = 3;
  for (int panel = 0; panel < 3; panel += 1) {
    if (pick < PANEL_PICKS[panel]) { chosen = panel; break; }
    pick -= PANEL_PICKS[panel];
  }
  float z = pow(height, 1.0 / (PANEL_POWERS[chosen] + 1.0));
  float radius = sqrt(max(0.0, 1.0 - z * z));
  return unrotateEnvironment(basis(PANEL_AXES[chosen]) * vec3(radius * cos(azimuth), radius * sin(azimuth), z));
}

float strongest(vec3 value) { return max(value.r, max(value.g, value.b)); }

vec4 slotMaterial() {
  return uPlaneMode ? surfaceMaterials[materialSlot] : meshTexel(uMaterials, materialSlot);
}

// Convex half-space boundary with its slot: the entry from outside, or the
// first exit ahead of an interior ray (the leaving face faces away from it).
bool hitPlanes(vec3 origin, vec3 direction, bool inside, out float hitT, out vec3 hitNormal) {
  float nearT = -1e5;
  float farT = 1e5;
  int nearSlot = -1;
  int farSlot = -1;
  for (int index = 0; index < ${MAX_SURFACE_PLANES}; index += 1) {
    if (index >= uPlaneCount) break;
    vec4 plane = surfacePlanes[index];
    float denominator = dot(plane.xyz, direction);
    float signedDistance = plane.w - dot(plane.xyz, origin);
    if (abs(denominator) < 1e-9) {
      if (!inside && signedDistance < 0.0) return false;
      continue;
    }
    float distance = signedDistance / denominator;
    if (denominator < 0.0) {
      if (!inside && distance > nearT) { nearT = distance; nearSlot = index; }
    } else if (distance < farT && (!inside || distance > 1e-7)) {
      farT = distance;
      farSlot = index;
    }
    if (!inside && nearT > farT) return false;
  }
  materialSlot = inside ? farSlot : nearSlot;
  hitT = inside ? farT : nearT;
  if (materialSlot < 0 || (!inside && nearT < 0.0)) return false;
  hitNormal = surfacePlanes[materialSlot].xyz;
  return true;
}

bool hitSurface(vec3 origin, vec3 direction, bool inside, out float hitT, out vec3 hitNormal, out vec3 hitPoint) {
  if (!uPlaneMode) return intersectMesh(origin, direction, hitT, hitNormal, hitPoint);
  bool hit = hitPlanes(origin, direction, inside, hitT, hitNormal);
  hitPoint = origin + direction * hitT;
  return hit;
}


struct Ray {
  vec3 origin;
  vec3 direction;
  vec3 weight;
  int depth;
  bool inside;
  float lastPdf; // BSDF pdf of a frosted continuation; zero after a smooth boundary.
};

Ray continuation(vec3 origin, vec3 direction, vec3 weight, int depth, bool inside, float lastPdf) {
  Ray ray;
  ray.origin = origin;
  ray.direction = direction;
  ray.weight = weight;
  ray.depth = depth;
  ray.inside = inside;
  ray.lastPdf = lastPdf;
  return ray;
}

vec3 escapeRadiance(Ray ray) {
  float mis = ray.lastPdf > 0.0 ? powerHeuristic(ray.lastPdf, environmentPdf(ray.direction)) : 1.0;
  return ray.weight * environmentRadiance(ray.direction) * mis;
}

// One boundary interaction. A smooth boundary splits deterministically exactly
// as traceMeshGem does, so polished-only light paths match the full-polished
// image and carry no noise. A frosted boundary follows the laboratory GGX/VNDF
// estimator with one continuation plus a light-panel sample, combined by the
// power heuristic. Radiance compression by eta^2 is omitted everywhere: every
// path starts and ends outside, so entry and exit factors cancel as in the
// polished tracer. On a convex solid an outgoing ray cannot meet the gem again,
// so it reads the environment at once (as traceGem does): at most one
// continuation remains. Returns the number of continuations written.
int interact(Ray ray, float distance, vec3 normal, vec3 point, float ior, vec3 absorptionColor,
  inout vec3 radiance, out Ray first, out Ray second) {
  vec3 weight = ray.weight;
  if (ray.inside) weight *= exp(-absorptionColor * distance);
  vec2 finish = slotMaterial().xy;
  bool entering = dot(ray.direction, normal) < 0.0;
  vec3 incidentNormal = entering ? normal : -normal;
  int count = 0;
  if (finish.x < 0.0001) {
    float n1 = entering ? 1.0 : ior;
    float n2 = entering ? ior : 1.0;
    float reflectance = dielectricFresnel(dot(-ray.direction, incidentNormal), n1, n2);
    vec3 reflection = reflect(ray.direction, incidentNormal);
    vec3 reflectionWeight = weight * reflectance;
    if (uConvex && entering) {
      radiance += reflectionWeight * environmentRadiance(reflection);
    } else if (strongest(reflectionWeight) >= 0.002) {
      first = continuation(point + incidentNormal * SURFACE_EPSILON, reflection, reflectionWeight, ray.depth + 1, !entering, 0.0);
      count = 1;
    }
    vec3 transmission = refract(ray.direction, incidentNormal, n1 / n2);
    vec3 transmissionWeight = weight * (1.0 - reflectance);
    if (dot(transmission, transmission) <= 1e-7) return count;
    if (uConvex && !entering) {
      radiance += transmissionWeight * environmentRadiance(transmission);
    } else if (strongest(transmissionWeight) >= 0.002) {
      Ray refracted = continuation(point - incidentNormal * SURFACE_EPSILON, transmission, transmissionWeight, ray.depth + 1, entering, 0.0);
      if (count == 0) first = refracted; else second = refracted;
      count += 1;
    }
    return count;
  }
  stochastic = true;
  float eta = entering ? ior : 1.0 / ior;
  mat3 frame = basis(incidentNormal);
  vec3 wo = transpose(frame) * -ray.direction;
  if (wo.z <= 0.0) return 0;
  // Light panels are reachable only on the outer side of the boundary.
  vec3 light = sampleEnvironment();
  if (dot(light, normal) > 0.0) {
    vec3 wi = transpose(frame) * light;
    vec2 bsdf = evalBSDF(wo, wi, finish.x, eta, finish.y);
    float lightPdf = environmentPdf(light);
    float blockedT;
    vec3 blockedNormal;
    vec3 blockedPoint;
    if (bsdf.y > 0.0 && lightPdf > 0.0
      && (uConvex || !intersectMesh(point + normal * SURFACE_EPSILON, light, blockedT, blockedNormal, blockedPoint))) {
      float compression = wi.z < 0.0 ? eta * eta : 1.0;
      radiance += weight * environmentRadiance(light)
        * (bsdf.x * abs(wi.z) / lightPdf * compression * powerHeuristic(lightPdf, bsdf.y));
    }
  }
  vec3 wi;
  if (rnd() < finish.y) {
    float radius = sqrt(rnd());
    float azimuth = 2.0 * PI * rnd();
    wi = vec3(radius * cos(azimuth), radius * sin(azimuth), sqrt(max(0.0, 1.0 - radius * radius)));
  } else {
    vec3 microNormal = visibleNormal(wo, finish.x);
    bool reflected = rnd() < fresnel(dot(wo, microNormal), eta);
    wi = reflected ? reflect(-wo, microNormal) : refract(-wo, microNormal, 1.0 / eta);
    if (dot(wi, wi) < 0.1 || (reflected && wi.z <= 0.0) || (!reflected && wi.z >= 0.0)) return 0;
  }
  vec2 bsdf = evalBSDF(wo, wi, finish.x, eta, finish.y);
  if (bsdf.y < 1e-20) return 0;
  vec3 nextWeight = weight * (bsdf.x * abs(wi.z) / bsdf.y * (wi.z < 0.0 ? eta * eta : 1.0));
  vec3 next = normalize(frame * wi);
  bool nextInside = dot(next, normal) < 0.0;
  Ray scattered = continuation(point + (nextInside ? -normal : normal) * SURFACE_EPSILON, next, nextWeight, ray.depth + 1, nextInside, bsdf.y);
  if (uConvex && !nextInside) {
    radiance += escapeRadiance(scattered);
    return 0;
  }
  if (strongest(nextWeight) < 0.002) return 0;
  first = scattered;
  return 1;
}

// Convex solids: a single path, no pending stack. Returns -1 when the camera ray misses.
vec3 traceConvexSurface(vec3 origin, vec3 direction, float ior, vec3 absorptionColor) {
  Ray ray = continuation(origin, direction, vec3(1.0), 0, false, 0.0);
  vec3 radiance = vec3(0.0);
  for (int step = 0; step <= MAX_BOUNCES; step += 1) {
    float distance;
    vec3 normal;
    vec3 point;
    if (!hitSurface(ray.origin, ray.direction, ray.inside, distance, normal, point)) {
      if (step == 0) return vec3(-1.0);
      return radiance + escapeRadiance(ray);
    }
    if (ray.depth >= uMaxBounces) break;
    Ray first, second;
    if (interact(ray, distance, normal, point, ior, absorptionColor, radiance, first, second) == 0) break;
    ray = first;
  }
  return radiance;
}

// Concave or multi-part meshes: depth-first like traceMeshGem, since outgoing
// rays may meet the gem again. Eight interactions need at most nine pending rays.
vec3 traceMeshSurface(vec3 origin, vec3 direction, float ior, vec3 absorptionColor) {
  Ray pending[9];
  pending[0] = continuation(origin, direction, vec3(1.0), 0, false, 0.0);
  int count = 1;
  vec3 radiance = vec3(0.0);
  for (int path = 0; path < 511; path += 1) {
    if (count == 0) break;
    count -= 1;
    Ray ray = pending[count];
    float distance;
    vec3 normal;
    vec3 point;
    if (!intersectMesh(ray.origin, ray.direction, distance, normal, point)) {
      if (path == 0) return vec3(-1.0);
      radiance += escapeRadiance(ray);
      continue;
    }
    if (ray.depth >= uMaxBounces) continue;
    Ray first, second;
    int next = interact(ray, distance, normal, point, ior, absorptionColor, radiance, first, second);
    if (next > 0) pending[count++] = first;
    if (next > 1) pending[count++] = second;
  }
  return radiance;
}

vec3 cameraRay(vec2 pixelPosition) {
  vec2 centered = (pixelPosition / uResolution - 0.5) * 2.0;
  centered.x *= uResolution.x / max(uResolution.y, 1.0);
  centered.x += uFocalOffset;
  centered -= uPan;
  return normalize(uCameraForward + uCameraRight * centered.x * uCameraScale + uCameraUp * centered.y * uCameraScale);
}

// Store the backdrop as the linear value that display maps back to the same
// color, so jittered silhouettes average gem and backdrop in one space.
vec3 displayToLinear(vec3 color) {
  vec3 y = clamp(pow(max(color, vec3(0.0)), vec3(2.2)), 0.0, 0.999);
  vec3 a = 2.43 * y - 2.51;
  vec3 b = 0.59 * y - 0.03;
  vec3 c = 0.14 * y;
  return (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a) * exp2(-uExposure);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  seed = mixbits(uint(pixel.x) * 1973u + uint(pixel.y) * 9277u);
  vec3 absorptionColor = vec3(uAbsorption) - log(max(uBodyColor, vec3(0.02))) * 0.9;
  float iors[3] = float[3](max(1.001, uIor - uDispersion * 0.48), uIor, uIor + uDispersion * 0.52);
  int bands = uDispersion > 0.0 ? 3 : 1;

  stochastic = false;
  vec3 sum = vec3(0.0);
  float moment = 0.0;
  for (int sampleIndex = 0; sampleIndex < MAX_BATCH; sampleIndex += 1) {
    if (sampleIndex >= uBatchSamples) break;
    uSample = uAccumulatedSamples + sampleIndex;
    dimension = 0;
    vec2 jitter = vec2(rnd(), rnd());
    vec3 rayDirection = cameraRay(vec2(pixel) + jitter);
    vec3 color = vec3(0.0);
    bool missed = false;
    // Bands share random dimensions, keeping dispersion noise correlated.
    for (int band = 0; band < 3; band += 1) {
      if (band >= bands) break;
      dimension = 2;
      float ior = iors[bands == 1 ? 1 : band];
      vec3 value = uConvex ? traceConvexSurface(uCameraPosition, rayDirection, ior, absorptionColor)
        : traceMeshSurface(uCameraPosition, rayDirection, ior, absorptionColor);
      if (value.r < 0.0) { missed = true; break; }
      if (bands == 1) color = value;
      else color[band] = value[band];
    }
    if (missed) color = displayToLinear(sceneBackground(uCameraPosition, rayDirection));
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    sum += color;
    moment += luminance * luminance;
  }
  // The denoising guide is written by the first batch only: the camera-ray
  // facet and normal, negated when no sample met a frosted boundary.
  outGuide = vec4(0.0);
  float guideT;
  vec3 guideNormal;
  vec3 guidePoint;
  if (uAccumulatedSamples == 0 && hitSurface(uCameraPosition, cameraRay(gl_FragCoord.xy), false, guideT, guideNormal, guidePoint)) {
    outGuide = vec4(guideNormal, slotMaterial().z * (stochastic ? 1.0 : -1.0));
  }
  vec4 batch = vec4(sum, moment) / float(uBatchSamples);
  outColor = uAccumulatedSamples == 0 ? batch
    : mix(texelFetch(uPrevious, pixel, 0), batch, float(uBatchSamples) / float(uAccumulatedSamples + uBatchSamples));
}`;
