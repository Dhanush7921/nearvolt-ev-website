/* eslint-disable @typescript-eslint/no-explicit-any */
// Runtime CDN modules (resolved by the import map in v3.html). Loosely typed shims: three.js is not installed locally.
declare module 'three' {
  export class WebGLRenderer { constructor(...a: any[]); [k: string]: any }
  export class Scene { constructor(...a: any[]); [k: string]: any }
  export class PerspectiveCamera { constructor(...a: any[]); [k: string]: any }
  export class Texture { constructor(...a: any[]); [k: string]: any }
  export class RectAreaLight { constructor(...a: any[]); [k: string]: any }
  export class DirectionalLight { constructor(...a: any[]); [k: string]: any }
  export class HemisphereLight { constructor(...a: any[]); [k: string]: any }
  export class Mesh { constructor(...a: any[]); [k: string]: any }
  export class MeshStandardMaterial { constructor(...a: any[]); [k: string]: any }
  export class MeshPhysicalMaterial { constructor(...a: any[]); [k: string]: any }
  export class Points { constructor(...a: any[]); [k: string]: any }
  export class SpotLight { constructor(...a: any[]); [k: string]: any }
  export class Object3D { constructor(...a: any[]); [k: string]: any }
  export class Group { constructor(...a: any[]); [k: string]: any }
  export class Color { constructor(...a: any[]); [k: string]: any }
  export class Fog { constructor(...a: any[]); [k: string]: any }
  export class PMREMGenerator { constructor(...a: any[]); [k: string]: any }
  export class CircleGeometry { constructor(...a: any[]); [k: string]: any }
  export class PlaneGeometry { constructor(...a: any[]); [k: string]: any }
  export class ShadowMaterial { constructor(...a: any[]); [k: string]: any }
  export class BoxGeometry { constructor(...a: any[]); [k: string]: any }
  export class CylinderGeometry { constructor(...a: any[]); [k: string]: any }
  export class TorusGeometry { constructor(...a: any[]); [k: string]: any }
  export class BufferGeometry { constructor(...a: any[]); [k: string]: any }
  export class BufferAttribute { constructor(...a: any[]); [k: string]: any }
  export class ShaderMaterial { constructor(...a: any[]); [k: string]: any }
  export class Vector2 { constructor(...a: any[]); [k: string]: any }
  export class Vector3 { constructor(...a: any[]); [k: string]: any }
  export class LineSegments { constructor(...a: any[]); [k: string]: any }
  export class EdgesGeometry { constructor(...a: any[]); [k: string]: any }
  export class LineBasicMaterial { constructor(...a: any[]); [k: string]: any }
  export class TubeGeometry { constructor(...a: any[]); [k: string]: any }
  export class CubicBezierCurve3 { constructor(...a: any[]); [k: string]: any }
  export class Box3 { constructor(...a: any[]); [k: string]: any }
  export const SRGBColorSpace: any, ACESFilmicToneMapping: any, PCFSoftShadowMap: any, AdditiveBlending: any, MathUtils: any;
}
declare module 'three/addons/environments/RoomEnvironment.js' {
  export class RoomEnvironment { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/lights/RectAreaLightUniformsLib.js' {
  export class RectAreaLightUniformsLib { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/geometries/RoundedBoxGeometry.js' {
  export class RoundedBoxGeometry { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/objects/Reflector.js' {
  export class Reflector { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/postprocessing/EffectComposer.js' {
  export class EffectComposer { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/postprocessing/RenderPass.js' {
  export class RenderPass { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/postprocessing/UnrealBloomPass.js' {
  export class UnrealBloomPass { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/postprocessing/OutputPass.js' {
  export class OutputPass { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/loaders/GLTFLoader.js' {
  export class GLTFLoader { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/loaders/DRACOLoader.js' {
  export class DRACOLoader { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare module 'three/addons/libs/meshopt_decoder.module.js' {
  export class MeshoptDecoder { constructor(...a: any[]); [k: string]: any; static [k: string]: any }
}
declare const gsap: any;
declare const ScrollTrigger: any;
