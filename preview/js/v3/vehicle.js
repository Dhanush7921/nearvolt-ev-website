// Licensed vehicle asset pipeline. Drop the approved GLB at public/models/vehicle.glb (or pass ?model=URL)
// and set `enabled: true`. Everything below normalises any well-formed glTF to the scene's conventions.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
export const VEHICLE = {
    enabled: true,
    url: 'models/vehicle.glb', // 4K textures (desktop)
    urlLite: 'models/vehicle-m.glb', // 2K textures (phones, low-end)
    length: 4.55, // metres after normalisation
    forward: 'auto', // nose direction in the source file
    paintColor: null, // null keeps the prepared paint atlas (pearl white, see scripts/car/prepare_goblin.py)
    claddingColor: '#0c0e0e',
    /** Charge port: x side (>=0.5 = right/+X), y fraction of height, z fraction of half-length forward of centre. */
    port: { x: 0.5, y: 0.62, z: 0.2 },
    credit: '“Fictional supercar – V12 Goblin” by ollitei, CC BY 4.0, https://sketchfab.com/3d-models/fictional-supercar-v12-goblin-0a20e49ad5774d778567cb5c3f345786 (modified)',
    match: {
        paint: /paint|body|carpaint|exterior|shell/i,
        shadow: /shadow/i,
        cladding: /cladding|trim|plastic|black|bumper_low|arch/i,
        glass: /glass|window|windshield|windscreen/i,
        head: /head.?(lamp|light)|drl|front.?light|lamp_f/i,
        tail: /tail|rear.?light|brake|lamp_r/i,
    },
};
export async function loadVehicle(url, env, onProgress) {
    const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
    const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
    const src = gltf.scene;
    // orientation: nose to +Z
    let box = new THREE.Box3().setFromObject(src);
    const s = box.getSize(new THREE.Vector3());
    const f = VEHICLE.forward === 'auto' ? (s.x > s.z ? '+x' : '+z') : VEHICLE.forward;
    const rotY = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }[f];
    const pivot = new THREE.Group();
    pivot.add(src);
    src.rotation.y = rotY;
    pivot.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(pivot);
    const k = VEHICLE.length / box.getSize(new THREE.Vector3()).z;
    src.scale.multiplyScalar(k);
    pivot.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(pivot);
    const c = box.getCenter(new THREE.Vector3());
    src.position.x -= c.x;
    src.position.z -= c.z;
    src.position.y -= box.min.y;
    pivot.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(pivot);
    const size = box.getSize(new THREE.Vector3());
    const heads = [], tails = [];
    const M = VEHICLE.match;
    src.traverse((o) => {
        const mesh = o;
        if (!mesh.isMesh)
            return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (M.shadow.test(`${mesh.material.name} ${mesh.name}`)) { // baked contact shadow from the source model
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.renderOrder = -1;
            const sm = mesh.material;
            sm.transparent = true;
            sm.depthWrite = false;
            sm.opacity = 0.85;
            return;
        }
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
        mats.forEach((m, i) => {
            const key = `${m.name} ${mesh.name}`;
            if (env)
                m.envMap = env;
            m.envMapIntensity = 1;
            if (M.glass.test(key)) {
                m.transparent = true;
                m.opacity = 0.42;
                m.roughness = 0.03;
                m.metalness = 0;
                m.color?.set('#0a1210');
                m.depthWrite = false;
            }
            else if (M.head.test(key)) {
                m.emissive = new THREE.Color('#dfeaff');
                m.emissiveIntensity = 0;
                heads.push(m);
            }
            else if (M.tail.test(key)) {
                m.emissive = new THREE.Color('#ff2a1a');
                m.emissiveIntensity = 0;
                tails.push(m);
            }
            else if (M.paint.test(key)) {
                const keep = VEHICLE.paintColor === null; // atlas materials carry paint, trim and lamps in one texture set
                const p = new THREE.MeshPhysicalMaterial({
                    color: keep ? m.color : VEHICLE.paintColor, map: keep ? m.map : null,
                    metalness: keep ? m.metalness : 0.15, roughness: keep ? m.roughness : 0.28,
                    metalnessMap: keep ? m.metalnessMap : null, roughnessMap: keep ? m.roughnessMap : null,
                    clearcoat: 1, clearcoatRoughness: 0.035, normalMap: m.normalMap, aoMap: m.aoMap, aoMapIntensity: 1, envMap: env, envMapIntensity: 0.95,
                });
                if (Array.isArray(mesh.material))
                    mesh.material[i] = p;
                else
                    mesh.material = p;
            }
            else if (M.cladding.test(key)) {
                m.color?.set(VEHICLE.claddingColor);
                m.roughness = Math.max(m.roughness ?? 0.6, 0.55);
            }
        });
    });
    const P = VEHICLE.port;
    const port = new THREE.Vector3((P.x >= 0.5 ? 1 : -1) * size.x * 0.485, P.y * size.y, P.z * size.z * 0.5);
    const headPos = [-1, 1].map((sx) => new THREE.Vector3(sx * size.x * 0.33, size.y * 0.55, size.z / 2 - 0.08));
    return { root: pivot, size, heads, tails, port, headPos };
}
