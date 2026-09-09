import { getTechnicalViewBasis } from "../domain/technicalPreview.js";
import { getMeshPreviewBuffers, fillMeshPreviewColors } from "../domain/meshPreviewBuffers.js";

const projectSource = `
uniform vec3 horizontal, vertical, observer;
uniform vec2 center, scale;
uniform float depthScale;
vec3 projectPoint(vec3 p) { return vec3((vec2(dot(p,horizontal),dot(p,vertical))-center)*scale, -dot(p,observer)*depthScale); }
`;
const meshVertex = `#version 300 es
in vec3 position, color;
out vec3 fillColor;
${projectSource}
void main(){ gl_Position=vec4(projectPoint(position),1.); fillColor=color; }`;
const meshFragment = `#version 300 es
precision highp float;
in vec3 fillColor;
out vec4 result;
void main(){result=vec4(fillColor,1.);}`;
const lineVertex = `#version 300 es
in vec3 start, end;
in vec2 corner;
uniform vec2 viewport;
uniform float lineWidth;
${projectSource}
void main(){
 vec3 a=projectPoint(start), b=projectPoint(end);
 vec2 direction=(b.xy-a.xy)*viewport;
 float lengthSquared=dot(direction,direction);
 vec2 perpendicular=lengthSquared>1.e-16 ? vec2(-direction.y,direction.x)*inversesqrt(lengthSquared) : vec2(0.);
 vec3 position=mix(a,b,corner.x);
 position.xy+=perpendicular*corner.y*lineWidth/viewport;
 gl_Position=vec4(position,1.);
}`;
const lineFragment = `#version 300 es
precision highp float;
out vec4 result;
void main(){ result=vec4(52./255.,57./255.,54./255.,1.); }`;

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const shaders = [];
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    shaders.forEach(shader => gl.deleteShader(shader));
  }
}

let shared;
function renderer() {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, depth: true, preserveDrawingBuffer: false });
  if (!gl) return null;
  const mesh = createProgram(gl, meshVertex, meshFragment);
  let line;
  try {
    line = createProgram(gl, lineVertex, lineFragment);
  } catch (error) {
    gl.deleteProgram(mesh);
    throw error;
  }
  const uniforms = program => Object.fromEntries(
    ["horizontal", "vertical", "observer", "center", "scale", "depthScale", "viewport", "lineWidth"]
      .map(name => [name, gl.getUniformLocation(program, name)]),
  );
  shared = {
    canvas, gl, mesh, line,
    meshUniforms: uniforms(mesh), lineUniforms: uniforms(line),
    position: gl.createBuffer(), colors: gl.createBuffer(), lines: gl.createBuffer(),
    meshVao: gl.createVertexArray(), lineVao: gl.createVertexArray(),
    solid: null, colorKey: null,
  };
  gl.bindVertexArray(shared.meshVao);
  bindAttribute(gl, mesh, "position", 3, shared.position);
  bindAttribute(gl, mesh, "color", 3, shared.colors);
  gl.bindVertexArray(shared.lineVao);
  bindAttribute(gl, line, "start", 3, shared.lines, 32, 0);
  bindAttribute(gl, line, "end", 3, shared.lines, 32, 12);
  bindAttribute(gl, line, "corner", 2, shared.lines, 32, 24);
  gl.bindVertexArray(null);
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    shared = null;
  }, { once: true });
  return shared;
}
const vector=p=>[p.x,p.y,p.z];
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
function projection(solid,view,width,height) {
  const basis=getTechnicalViewBasis(view);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,maxDepth=0;
  for(const p of solid.vertices) {
    const x=dot(p,basis.horizontal),y=dot(p,basis.vertical);
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    maxDepth=Math.max(maxDepth,Math.abs(dot(p,basis.view)));
  }
  // Match SVG viewBox 320×240 with 20-unit padding and xMidYMid meet.
  const fit=Math.min(280/Math.max(maxX-minX,1e-6),200/Math.max(maxY-minY,1e-6));
  const frameScale=Math.min(width/320,height/240);
  return {basis,center:[(minX+maxX)/2,(minY+maxY)/2],scale:[fit*frameScale*2/width,fit*frameScale*2/height],depthScale:0.8/Math.max(maxDepth,1)};
}
function bindAttribute(gl,program,name,size,buffer,stride=0,offset=0) {
  const location=gl.getAttribLocation(program,name);
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location,size,gl.FLOAT,false,stride,offset);
}
function setProjection(gl,uniforms,values) {
  gl.uniform3fv(uniforms.horizontal,vector(values.basis.horizontal));gl.uniform3fv(uniforms.vertical,vector(values.basis.vertical));gl.uniform3fv(uniforms.observer,vector(values.basis.view));
  gl.uniform2fv(uniforms.center,values.center);gl.uniform2fv(uniforms.scale,values.scale);gl.uniform1f(uniforms.depthScale,values.depthScale);
}

/** One shared GPU context serves every preview/card. Depth-tested triangles and
 * screen-space boundary lines are copied immediately to each persistent canvas;
 * opening many projects therefore does not exhaust browser WebGL contexts. */
export function renderTechnicalMesh(target,solid,view,colors={}, { pixelRatio = target.clientWidth ? target.width / target.clientWidth : 1 } = {}) {
  const state=renderer();
  if(!state)return false;
  const {gl,canvas}=state;
  if(gl.isContextLost())return false;
  const width=target.width,height=target.height;
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  gl.viewport(0,0,width,height);gl.clearColor(1,1,1,1);gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  if(solid.vertices.length) {
    const buffers=getMeshPreviewBuffers(solid);
    const colorKey=JSON.stringify([colors.activeOperationId,colors.previewOperationId,colors.highlightOperationId]);
    const needsUpload = state.solid !== solid || state.colorKey !== colorKey;
    if(state.solid!==solid) {
      gl.bindBuffer(gl.ARRAY_BUFFER,state.position);gl.bufferData(gl.ARRAY_BUFFER,buffers.positions,gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,state.lines);gl.bufferData(gl.ARRAY_BUFFER,buffers.lines,gl.DYNAMIC_DRAW);
    }
    if(state.solid!==solid||state.colorKey!==colorKey) {
      gl.bindBuffer(gl.ARRAY_BUFFER,state.colors);gl.bufferData(gl.ARRAY_BUFFER,fillMeshPreviewColors(buffers,colors),gl.DYNAMIC_DRAW);
    }
    // WebGL allocation/upload failures set an error flag rather than throwing.
    // Only cache a complete upload, so the caller can use its SVG fallback and
    // a later call can retry all buffers instead of drawing stale GPU geometry.
    if (needsUpload && gl.getError() !== gl.NO_ERROR) {
      state.solid = null;
      state.colorKey = null;
      return false;
    }
    state.solid = solid;
    state.colorKey = colorKey;
    const values=projection(solid,view,width,height);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
    gl.useProgram(state.mesh);setProjection(gl,state.meshUniforms,values);
    gl.bindVertexArray(state.meshVao);
    gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);gl.drawArrays(gl.TRIANGLES,0,buffers.positions.length/3);gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.useProgram(state.line);setProjection(gl,state.lineUniforms,values);
    gl.uniform2f(state.lineUniforms.viewport,width,height);gl.uniform1f(state.lineUniforms.lineWidth,.85*pixelRatio);
    gl.bindVertexArray(state.lineVao);
    gl.drawArrays(gl.TRIANGLES,0,buffers.lines.length/8);
    gl.bindVertexArray(null);
  }
  const context=target.getContext("2d",{alpha:false});
  context.drawImage(canvas,0,0);
  return true;
}
