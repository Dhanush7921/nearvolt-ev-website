"""Prepares the licensed vehicle for the V3 scene.

Source: "Fictional supercar - V12 Goblin" by ollitei, CC BY 4.0
https://sketchfab.com/3d-models/fictional-supercar-v12-goblin-0a20e49ad5774d778567cb5c3f345786

Changes (all permitted by CC BY 4.0, credited on legal.html):
  * KHR_materials_pbrSpecularGlossiness converted to core metallic-roughness (three.js no longer reads spec-gloss)
  * body paint recoloured to NEARVOLT pearl white; the separate black "clearcoat" shell mesh removed
    (the renderer applies a physical clear coat instead)
  * textures re-encoded (JPEG for colour/roughness), a 2K variant written for phones

usage: python3 scripts/car/prepare_goblin.py <source.glb> <out_dir>
"""
import io, json, struct, sys
import numpy as np
from PIL import Image

PAINT = np.array([0.78, 0.795, 0.79])  # pearl white (linear-ish sRGB values)
SRC, OUT = sys.argv[1], sys.argv[2]

raw = open(SRC, 'rb').read()
jl = struct.unpack('<I', raw[12:16])[0]
J = json.loads(raw[20:20 + jl])
BIN = raw[20 + jl + 8:]


def bv_bytes(i):
    bv = J['bufferViews'][i]
    o = bv.get('byteOffset', 0)
    return BIN[o:o + bv['byteLength']]


def img(i):
    return Image.open(io.BytesIO(bv_bytes(J['images'][i]['bufferView'])))


def tex_img(tex_index):
    return img(J['textures'][tex_index]['source'])


def convert(max_size):
    j = json.loads(json.dumps(J))
    new_images = []  # (index placeholder) -> bytes, mime

    def add_image(pil, fmt):
        b = io.BytesIO()
        if fmt == 'JPEG':
            pil.convert('RGB').save(b, 'JPEG', quality=90, optimize=True)
        else:
            pil.save(b, 'PNG', optimize=True)
        new_images.append((b.getvalue(), 'image/jpeg' if fmt == 'JPEG' else 'image/png'))
        return ('new', len(new_images) - 1)

    def fit(p):
        if max(p.size) > max_size:
            s = max_size / max(p.size)
            p = p.resize((round(p.size[0] * s), round(p.size[1] * s)), Image.LANCZOS)
        return p

    tex_defs = []  # textures for the output: (image ref, sampler)

    def new_tex(ref, like):
        tex_defs.append({'img': ref, 'sampler': J['textures'][like].get('sampler')})
        return len(tex_defs) - 1

    def keep_tex(t):
        return new_tex(('old', J['textures'][t]['source']), t)

    for m in j['materials']:
        sg = m.get('extensions', {}).pop('KHR_materials_pbrSpecularGlossiness', None)
        if not m.get('extensions'):
            m.pop('extensions', None)
        if sg is None:
            continue
        df = np.array(sg.get('diffuseFactor', [1, 1, 1, 1]), dtype=np.float32)
        sf = np.array(sg.get('specularFactor', [1, 1, 1]), dtype=np.float32)
        gf = float(sg.get('glossinessFactor', 1))
        pbr = {}
        if 'specularGlossinessTexture' in sg and 'diffuseTexture' in sg:
            # full per-pixel conversion (body atlas)
            d = fit(tex_img(sg['diffuseTexture']['index']).convert('RGB'))
            sgi = fit(tex_img(sg['specularGlossinessTexture']['index']).convert('RGBA')).resize(d.size)
            D = np.asarray(d, np.float32) / 255 * df[:3]
            S = np.asarray(sgi, np.float32) / 255
            spec, gloss = S[..., :3] * sf, S[..., 3] * gf
            smax = spec.max(-1)
            metal = np.clip((smax - 0.06) / 0.4, 0, 1)
            base = D * (1 - metal[..., None]) + spec * metal[..., None]
            # body paint: strongly coloured metallic specular -> NEARVOLT pearl white, satin metallic
            r, g, b = spec[..., 0], spec[..., 1], spec[..., 2]
            paint = (smax > 0.12) & (g > r * 1.25) & (g > b * 1.25)
            base[paint] = PAINT
            metal[paint] = 0.5
            rough = 1 - gloss
            rough[paint] = 0.27
            base_img = Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8))
            mr = np.zeros((*rough.shape, 3), np.uint8)
            mr[..., 0] = 255
            mr[..., 1] = (np.clip(rough, 0.04, 1) * 255).astype(np.uint8)
            mr[..., 2] = (metal * 255).astype(np.uint8)
            t_base = new_tex(add_image(base_img, 'JPEG'), sg['diffuseTexture']['index'])
            t_mr = new_tex(add_image(Image.fromarray(mr), 'JPEG'), sg['specularGlossinessTexture']['index'])
            pbr = {'baseColorTexture': {'index': t_base}, 'metallicRoughnessTexture': {'index': t_mr}, 'metallicFactor': 1, 'roughnessFactor': 1}
            m['name'] = 'body_paint_atlas'
        elif 'specularGlossinessTexture' in sg:
            # tyres: roughness from the gloss channel
            sgi = fit(tex_img(sg['specularGlossinessTexture']['index']).convert('RGBA'))
            A = np.asarray(sgi, np.float32)[..., 3] / 255 * gf
            mr = np.zeros((*A.shape, 3), np.uint8)
            mr[..., 0] = 255
            mr[..., 1] = (np.clip(1 - A, 0.35, 1) * 255).astype(np.uint8)
            t_mr = new_tex(add_image(Image.fromarray(mr), 'JPEG'), sg['specularGlossinessTexture']['index'])
            pbr = {'baseColorFactor': [0.025, 0.025, 0.025, 1], 'metallicFactor': 0, 'roughnessFactor': 1, 'metallicRoughnessTexture': {'index': t_mr}}
        else:
            pbr = {'baseColorFactor': [float(x) for x in df], 'metallicFactor': 0, 'roughnessFactor': float(max(0.03, 1 - gf))}
            if 'diffuseTexture' in sg:
                pbr['baseColorTexture'] = {'index': keep_tex(sg['diffuseTexture']['index'])}
        m['pbrMetallicRoughness'] = pbr
        for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            if k in m:
                m[k]['index'] = keep_tex(m[k]['index'])

    # drop the opaque black "clearcoat" shell (replaced by a physical clear coat at runtime)
    cc = next(i for i, m in enumerate(j['materials']) if m.get('name') == 'clearcoat')
    for n in j['nodes']:
        if 'mesh' in n and all(p.get('material') == cc for p in j['meshes'][n['mesh']]['primitives']):
            del n['mesh']
    for ext in ('extensionsUsed', 'extensionsRequired'):
        if ext in j:
            j[ext] = [e for e in j[ext] if e != 'KHR_materials_pbrSpecularGlossiness']
            if not j[ext]:
                del j[ext]

    # rebuild images/textures and the binary chunk with only referenced data
    out = bytearray()
    bviews = []

    def push(data, target=None, stride=None):
        while len(out) % 4:
            out.append(0)
        bv = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target:
            bv['target'] = target
        if stride:
            bv['byteStride'] = stride
        out.extend(data)
        bviews.append(bv)
        return len(bviews) - 1

    used_meshes = {n['mesh'] for n in j['nodes'] if 'mesh' in n}
    acc_map = {}
    remap_mesh = {}
    meshes = []
    for mi in sorted(used_meshes):
        mesh = j['meshes'][mi]
        for p in mesh['primitives']:
            for key in list(p['attributes']):
                if key.startswith('TANGENT') or key in ('TEXCOORD_2',):
                    del p['attributes'][key]  # unused by the material set
            for a in list(p['attributes'].values()) + [p['indices']]:
                acc_map.setdefault(a, None)
        remap_mesh[mi] = len(meshes)
        meshes.append(mesh)
    accessors, bv_map = [], {}
    for a in sorted(acc_map):
        acc = dict(j['accessors'][a])
        if acc['bufferView'] not in bv_map:  # accessors share source buffer views: copy each once
            src_bv = j['bufferViews'][acc['bufferView']]
            bv_map[acc['bufferView']] = push(bv_bytes(acc['bufferView']), src_bv.get('target'), src_bv.get('byteStride'))
        acc['bufferView'] = bv_map[acc['bufferView']]
        acc_map[a] = len(accessors)
        accessors.append(acc)
    for mesh in meshes:
        for p in mesh['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            p['indices'] = acc_map[p['indices']]
    for n in j['nodes']:
        if 'mesh' in n:
            n['mesh'] = remap_mesh[n['mesh']]

    images, img_cache = [], {}
    for t in tex_defs:
        key = t['img']
        if key not in img_cache:
            if key[0] == 'old':
                pil = fit(img(key[1]))
                b = io.BytesIO()
                pil.save(b, 'PNG', optimize=True)
                data, mime = b.getvalue(), 'image/png'
            else:
                data, mime = new_images[key[1]]
            img_cache[key] = len(images)
            images.append({'bufferView': push(data), 'mimeType': mime})
        t['source'] = img_cache[key]
    j['textures'] = [{k: v for k, v in (('source', t['source']), ('sampler', t['sampler'])) if v is not None} for t in tex_defs]
    j['images'] = images
    j['meshes'] = meshes
    j['accessors'] = accessors
    j['bufferViews'] = bviews
    j['buffers'] = [{'byteLength': len(out)}]
    j.setdefault('asset', {})['copyright'] = 'Based on "Fictional supercar - V12 Goblin" by ollitei, CC BY 4.0; modified for NEARVOLT EV'
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(out) % 4:
        out.append(0)
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    return glb


for size, name in ((4096, 'vehicle.glb'), (2048, 'vehicle-m.glb')):
    data = convert(size)
    open(f'{OUT}/{name}', 'wb').write(data)
    print(name, round(len(data) / 1e6, 2), 'MB')
