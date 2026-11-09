// Small glTF 2.0 binary loader for the one licensed car model (KHR_mesh_quantization aware).
import { fromTRS, ident, mul, normalMatrix } from './math.js';
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ATTR = { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TEXCOORD_1: 3 };
export async function loadGLB(gl, url, aniso, onProgress) {
    const buf = await fetchWithProgress(url, onProgress);
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67)
        throw new Error('Not a GLB file');
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    const binOff = 20 + jsonLen + 8;
    const bin = new Uint8Array(buf, binOff, dv.getUint32(20 + jsonLen, true));
    // textures (decoded in parallel)
    const imgCache = new Map();
    const texCache = new Map();
    const image = (i) => {
        if (!imgCache.has(i)) {
            const im = json.images[i];
            const bv = json.bufferViews[im.bufferView];
            const blob = new Blob([bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)], { type: im.mimeType });
            imgCache.set(i, createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
        }
        return imgCache.get(i);
    };
    const texture = async (info, srgb) => {
        if (!info)
            return null;
        const t = json.textures[info.index];
        const key = `${t.source}:${srgb}`;
        if (!texCache.has(key)) {
            const bmp = await image(t.source);
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            const s = t.sampler !== undefined ? json.samplers[t.sampler] : {};
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, s.wrapS || gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, s.wrapT || gl.REPEAT);
            const ext = gl.getExtension('EXT_texture_filter_anisotropic');
            if (ext && aniso > 1)
                gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, aniso);
            texCache.set(key, tex);
        }
        const x = info.extensions?.KHR_texture_transform;
        return {
            tex: texCache.get(key),
            set: info.texCoord || 0,
            xf: x ? [x.scale?.[0] ?? 1, x.scale?.[1] ?? 1, x.offset?.[0] ?? 0, x.offset?.[1] ?? 0] : undefined,
        };
    };
    const materials = await Promise.all(json.materials.map(async (m) => {
        const pbr = m.pbrMetallicRoughness || {};
        const name = m.name || '';
        const tag = /^Paint 1/.test(name) ? 'paint'
            : /^Paint 2|^Interior 3|^Brake$/.test(name) ? 'accent'
                : name === 'Glass' ? 'glass'
                    : name === 'Headlight' ? 'head'
                        : name === 'Brakelight' ? 'tail'
                            : name === 'Signallight' ? 'signal'
                                : name === 'Dashboard' ? 'dash' : 'other';
        const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
        const e = (m.emissiveFactor || [0, 0, 0]).map((v) => v * strength);
        return {
            name, tag,
            base: pbr.baseColorFactor || [1, 1, 1, 1],
            metal: pbr.metallicFactor ?? 1,
            rough: pbr.roughnessFactor ?? 1,
            baseTex: await texture(pbr.baseColorTexture, true),
            mrTex: await texture(pbr.metallicRoughnessTexture, false),
            normalTex: await texture(m.normalTexture, false),
            normalScale: m.normalTexture?.scale ?? 1,
            occTex: await texture(m.occlusionTexture, false),
            occStrength: m.occlusionTexture?.strength ?? 1,
            emissive: e,
            emissiveTex: await texture(m.emissiveTexture, true),
            clearcoat: m.extensions?.KHR_materials_clearcoat?.clearcoatFactor ?? 0,
            alpha: m.extensions?.KHR_materials_transmission ? 0.5 : 1,
            doubleSided: !!m.doubleSided,
        };
    }));
    // geometry: one GPU buffer for the whole binary chunk, attributes point into it
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, bin, gl.STATIC_DRAW);
    const meshCache = new Map();
    const mesh = (mi) => {
        if (meshCache.has(mi))
            return meshCache.get(mi);
        const prims = json.meshes[mi].primitives.filter((p) => (p.mode ?? 4) === 4).map((p) => {
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            for (const [name, loc] of Object.entries(ATTR)) {
                const ai = p.attributes[name];
                if (ai === undefined) {
                    gl.disableVertexAttribArray(loc);
                    continue;
                }
                const a = json.accessors[ai];
                const bv = json.bufferViews[a.bufferView];
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, NC[a.type], a.componentType, !!a.normalized, bv.byteStride || 0, (bv.byteOffset || 0) + (a.byteOffset || 0));
            }
            const ia = json.accessors[p.indices];
            const ibv = json.bufferViews[ia.bufferView];
            const size = ia.componentType === 5125 ? 4 : ia.componentType === 5123 ? 2 : 1;
            const start = (ibv.byteOffset || 0) + (ia.byteOffset || 0);
            const ibo = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bin.slice(start, start + ia.count * size), gl.STATIC_DRAW);
            gl.bindVertexArray(null);
            return { vao, count: ia.count, indexType: ia.componentType, mat: p.material ?? 0 };
        });
        meshCache.set(mi, prims);
        return prims;
    };
    const items = [];
    const walk = (ni, parent) => {
        const n = json.nodes[ni];
        const local = n.matrix ? new Float32Array(n.matrix) : fromTRS(n.translation, n.rotation, n.scale);
        const world = mul(parent, local);
        if (n.mesh !== undefined)
            for (const p of mesh(n.mesh))
                items.push({ vao: p.vao, count: p.count, indexType: p.indexType, mat: materials[p.mat], world, nrm: normalMatrix(world) });
        for (const c of n.children || [])
            walk(c, world);
    };
    for (const r of json.scenes[json.scene || 0].nodes)
        walk(r, ident());
    return items;
}
async function fetchWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok || !res.body)
        throw new Error(`Model request failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!total || !onProgress)
        return res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        chunks.push(value);
        got += value.length;
        onProgress(Math.min(0.99, got / total)); // content-length may be the compressed size
    }
    return new Blob(chunks).arrayBuffer();
}
