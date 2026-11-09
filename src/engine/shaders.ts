// GLSL ES 3.00 shaders for the NEARVOLT studio renderer.
const LIGHTS = /* glsl */ `
uniform vec3 uLC[4]; uniform vec3 uLR[4]; uniform vec3 uLU[4]; uniform vec2 uLS[4]; uniform vec3 uLCol[4];
uniform float uAmb;
// analytic studio: four rectangular softboxes, edges soften with roughness
vec3 envRad(vec3 d, float rough){
  float w = 0.012 + rough*rough*1.4;
  vec3 acc = vec3(0.0);
  for(int i=0;i<4;i++){
    float c = dot(d, uLC[i]);
    if(c <= 0.02) continue;
    vec3 p = d / c;
    vec2 s = uLS[i];
    float fx = 1.0 - smoothstep(s.x - w, s.x + w, abs(dot(p, uLR[i])));
    float fy = 1.0 - smoothstep(s.y - w, s.y + w, abs(dot(p, uLU[i])));
    acc += uLCol[i] * fx * fy * (s.x/(s.x+w)) * (s.y/(s.y+w)) * smoothstep(0.02, 0.3, c);
  }
  acc += mix(vec3(0.004,0.005,0.005), vec3(0.03,0.034,0.033), clamp(d.y*0.5+0.5,0.0,1.0)) * uAmb;
  return acc;
}
vec3 irr(vec3 n){
  vec3 a = vec3(0.0);
  for(int i=0;i<4;i++) a += uLCol[i] * (4.0*uLS[i].x*uLS[i].y) * max(dot(n, uLC[i]), 0.0);
  return a + mix(vec3(0.02), vec3(0.09), clamp(n.y*0.5+0.5,0.0,1.0)) * uAmb;
}
vec2 envBRDF(float NoV, float r){
  const vec4 c0 = vec4(-1.0,-0.0275,-0.572,0.022); const vec4 c1 = vec4(1.0,0.0425,1.04,-0.04);
  vec4 q = r*c0 + c1; float a = min(q.x*q.x, exp2(-9.28*NoV))*q.x + q.y;
  return vec2(-1.04,1.04)*a + q.zw;
}`;

export const PBR_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv0; layout(location=3) in vec2 aUv1;
uniform mat4 uVP; uniform mat4 uModel; uniform mat3 uNrmM;
out vec3 vW; out vec3 vN; out vec2 vUv0; out vec2 vUv1;
void main(){ vec4 w = uModel*vec4(aPos,1.0); vW = w.xyz; vN = uNrmM*aNrm; vUv0 = aUv0; vUv1 = aUv1; gl_Position = uVP*w; }`;

export const PBR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec2 vUv0; in vec2 vUv1;
uniform vec3 uEye;
uniform vec4 uBase; uniform float uMetal, uRough, uCC, uOccS, uNrmS, uAlpha, uMirror;
uniform vec3 uEmis; uniform int uHas; uniform int uOccSet; uniform vec4 uNrmXf;
uniform sampler2D tBase, tMR, tNrm, tOcc, tEmis;
uniform vec3 uPL; uniform vec3 uPLCol;
${LIGHTS}
out vec4 o;
vec3 perturb(vec3 N, vec3 p, vec2 uv, vec3 tn){
  vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 du1 = dFdx(uv), du2 = dFdy(uv);
  vec3 a = cross(dp2, N), b = cross(N, dp1);
  vec3 T = a*du1.x + b*du2.x; vec3 B = a*du1.y + b*du2.y;
  float m = max(dot(T,T), dot(B,B)); if(m < 1e-12) return N;
  float inv = inversesqrt(m);
  return normalize(mat3(T*inv, B*inv, N)*tn);
}
void main(){
  vec4 base = uBase; if((uHas&1)!=0) base *= texture(tBase, vUv0);
  float rough = uRough, metal = uMetal;
  if((uHas&2)!=0){ vec4 mr = texture(tMR, vUv0); rough *= mr.g; metal *= mr.b; }
  rough = clamp(rough, 0.04, 1.0);
  vec3 Ng = normalize(vN); if(!gl_FrontFacing) Ng = -Ng;
  vec3 N = Ng;
  if((uHas&4)!=0){ vec2 uv = vUv0*uNrmXf.xy + uNrmXf.zw; vec3 tn = texture(tNrm, uv).xyz*2.0-1.0; tn.xy *= uNrmS; N = perturb(Ng, vW, uv, normalize(tn)); }
  float ao = 1.0; if((uHas&8)!=0) ao = mix(1.0, texture(tOcc, uOccSet==1 ? vUv1 : vUv0).r, uOccS);
  vec3 V = normalize(uEye - vW); float NoV = clamp(dot(N,V), 1e-3, 1.0);
  vec3 F0 = mix(vec3(0.04), base.rgb, metal);
  vec2 AB = envBRDF(NoV, rough);
  vec3 col = (base.rgb*(1.0-metal)*irr(N)/3.14159 + envRad(reflect(-V,N), rough)*(F0*AB.x+AB.y))*ao;
  vec3 Lv = uPL - vW; float d2 = dot(Lv,Lv); vec3 L = Lv*inversesqrt(d2); vec3 H = normalize(L+V);
  float NoL = max(dot(N,L),0.0); float a2 = rough*rough; a2 *= a2; float NoH = max(dot(N,H),0.0);
  float dd = NoH*NoH*(a2-1.0)+1.0;
  col += uPLCol*NoL/(1.0+d2*14.0)*(base.rgb*(1.0-metal)/3.14159 + F0*a2/(3.14159*dd*dd)*0.25);
  if(uCC > 0.0){
    float Fc = (0.04 + 0.96*pow(1.0-clamp(dot(Ng,V),0.0,1.0), 5.0))*uCC;
    col = col*(1.0-Fc) + envRad(reflect(-V,Ng), 0.05)*Fc*ao;
  }
  vec3 em = uEmis; if((uHas&16)!=0) em *= texture(tEmis, vUv0).rgb;
  col += em;
  float alpha = uAlpha < 1.0 ? mix(uAlpha, 1.0, pow(1.0-NoV, 3.0)) : 1.0;
  if(uMirror > 0.5) col *= 0.22*exp(-max(-vW.y,0.0)*3.0);
  o = vec4(col, alpha);
}`;

const BG = /* glsl */ `
uniform vec3 uBgA, uBgB; uniform float uHaze;
vec3 bg(vec2 uv){
  vec3 c = mix(uBgA, uBgB, smoothstep(0.0, 1.0, uv.y));
  c += vec3(0.004,0.016,0.011)*exp(-pow((uv.y-0.45)*3.0,2.0))*uHaze;
  return c;
}`;

export const QUAD_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

export const BG_FS = /* glsl */ `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; ${BG}
void main(){ o = vec4(bg(vUv), 1.0); }`;

export const FLOOR_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uVP; out vec3 vW;
void main(){ vW = aPos; gl_Position = uVP*vec4(aPos,1.0); }`;

export const FLOOR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vW; out vec4 o;
uniform vec2 uRes; uniform float uTop; uniform vec3 uHL[2]; uniform float uHead; uniform vec3 uPL, uPLCol; uniform float uLines; uniform float uTime;
${BG}
float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p)-b+r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  vec2 p = vW.xz;
  float r2 = dot(p - vec2(0.0,0.2), p - vec2(0.0,0.2));
  vec3 c = vec3(0.016,0.019,0.018)*(0.2 + uTop*1.6*exp(-r2/10.0));
  float sd = rbox(p - vec2(0.0,0.24), vec2(0.93,2.08), 0.55);
  float sh = 1.0 - 0.9*(1.0 - smoothstep(-0.45, 0.5, sd));
  vec2 W[4] = vec2[4](vec2(0.98,1.485), vec2(-0.98,1.485), vec2(0.98,-1.314), vec2(-0.98,-1.314));
  for(int i=0;i<4;i++){ vec2 q = (p - W[i])*vec2(5.5,2.6); sh *= 1.0 - 0.75*exp(-dot(q,q)); }
  c *= sh;
  for(int i=0;i<2;i++){
    vec2 d = p - uHL[i].xz;
    if(d.y > 0.0){ float lat = d.x/(0.16 + d.y*0.36); c += vec3(0.7,0.82,1.0)*uHead*exp(-lat*lat)*exp(-d.y*0.2)*smoothstep(0.0,0.7,d.y)*0.5; }
  }
  vec2 dp = p - uPL.xz; c += uPLCol*0.05*exp(-dot(dp,dp)*2.5);
  // faint charging-network lines radiating from the charger
  if(uLines > 0.0){
    vec2 q = p - vec2(2.2, -0.55); float ang = atan(q.y, q.x); float rr = length(q);
    float ray = pow(abs(cos(ang*6.0)), 260.0) * smoothstep(0.4, 1.2, rr) * exp(-rr*0.28);
    float pulse = smoothstep(0.85, 1.0, fract(rr*0.35 - uTime*0.4));
    c += vec3(0.05,0.9,0.55)*ray*(0.05 + pulse*0.35)*uLines;
  }
  vec3 b = bg(gl_FragCoord.xy/uRes);
  float fog = smoothstep(5.5, 15.0, length(p));
  o = vec4(mix(c, b, fog), mix(0.8, 1.0, fog));
}`;

export const PART_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aSeed;
uniform mat4 uVP; uniform vec3 uB0, uB1, uB2, uB3, uPort; uniform float uTime, uFlow, uAura, uPx;
out float vA;
vec3 bez(float t){ float s = 1.0-t; return s*s*s*uB0 + 3.0*s*s*t*uB1 + 3.0*s*t*t*uB2 + t*t*t*uB3; }
void main(){
  vec3 p; float a;
  if(aSeed.z < 0.7){
    float t = fract(aSeed.x + uTime*0.42);
    float ang = aSeed.y*6.2832 + uTime*3.0 + t*24.0;
    p = bez(t) + vec3(0.0, cos(ang), sin(ang))*0.02*(0.4+aSeed.y);
    a = uFlow*smoothstep(0.0,0.08,t)*(1.0-smoothstep(0.9,1.0,t));
  } else {
    float ph = fract(aSeed.y*13.0 + uTime*0.7);
    float ang = aSeed.x*6.2832 + uTime*(0.8+aSeed.y);
    float rr = 0.05 + 0.07*ph;
    p = uPort + vec3(ph*0.16, cos(ang)*rr, sin(ang)*rr);
    a = uAura*(1.0-ph);
  }
  vec4 c = uVP*vec4(p,1.0); gl_Position = c; gl_PointSize = uPx*(0.5+aSeed.y)/c.w; vA = a;
}`;

export const PART_FS = /* glsl */ `#version 300 es
precision highp float; in float vA; out vec4 o;
void main(){ float d = length(gl_PointCoord-0.5); float k = 1.0 - smoothstep(0.0, 0.5, d); o = vec4(vec3(0.2,1.0,0.62)*k*k*vA*4.0, 0.0); }`;

export const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D t; uniform vec2 uTexel; uniform float uTh;
void main(){
  vec3 c = (texture(t, vUv+uTexel*vec2(-0.5,-0.5)).rgb + texture(t, vUv+uTexel*vec2(0.5,-0.5)).rgb + texture(t, vUv+uTexel*vec2(-0.5,0.5)).rgb + texture(t, vUv+uTexel*vec2(0.5,0.5)).rgb)*0.25;
  float l = max(c.r, max(c.g, c.b)); o = vec4(c*max(l-uTh,0.0)/max(l,1e-4), 1.0);
}`;

export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D t; uniform vec2 uDir;
void main(){
  vec3 c = texture(t, vUv).rgb*0.2270;
  c += (texture(t, vUv+uDir*1.3846).rgb + texture(t, vUv-uDir*1.3846).rgb)*0.3162;
  c += (texture(t, vUv+uDir*3.2308).rgb + texture(t, vUv-uDir*3.2308).rgb)*0.0703;
  o = vec4(c, 1.0);
}`;

export const COMP_FS = /* glsl */ `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D tS, tB1, tB2; uniform float uBloom, uExposure, uFade, uGrain, uTime; uniform vec2 uRes;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
void main(){
  vec3 c = texture(tS, vUv).rgb + (texture(tB1, vUv).rgb*0.55 + texture(tB2, vUv).rgb*0.9)*uBloom;
  c = aces(c*uExposure);
  vec2 q = vUv-0.5; c *= 1.0 - dot(q,q)*0.55;
  c = pow(c, vec3(1.0/2.2));
  c += (hash(vUv*uRes + fract(uTime)*91.0) - 0.5)*uGrain;
  o = vec4(c*uFade, 1.0);
}`;
