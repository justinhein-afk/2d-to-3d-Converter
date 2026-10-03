// Minimal binary FBX 7.4 writer for a single coloured mesh.
//
// Three.js ships no FBX exporter, and many tools (Blender included) refuse ASCII
// FBX, so this writes the binary encoding directly. Layout follows the format
// as documented by Blender's io_scene_fbx (encode_bin.py / export_fbx_bin.py).

const VERSION = 7400;
const HEAD_MAGIC = [...'Kaydara FBX Binary  '].map((c) => c.charCodeAt(0)).concat([0x00, 0x1a, 0x00]);
const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOT_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
// The FBX SDK checks that FileId and CreationTime match the footer it expects.
const FILE_ID = [0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1];
const CREATION_TIME = '1970-01-01 10:00:00:000';
const SENTINEL = 13;

const enc = new TextEncoder();

// Property constructors.
const I = (v) => ({ t: 'I', v });
const D = (v) => ({ t: 'D', v });
const L = (v) => ({ t: 'L', v: BigInt(v) });
const C = (v) => ({ t: 'C', v });
const S = (v) => ({ t: 'S', v: enc.encode(v) });
const R = (bytes) => ({ t: 'R', v: Uint8Array.from(bytes) });
const ai = (arr) => ({ t: 'i', v: arr instanceof Int32Array ? arr : Int32Array.from(arr) });
const ad = (arr) => ({ t: 'd', v: arr instanceof Float64Array ? arr : Float64Array.from(arr) });
// "Name::Class" is stored as "Name\0\x01Class" in binary files.
const nameClass = (name, cls) => S(`${name}\u0000\u0001${cls}`);

const node = (name, props = [], children = []) => ({ name: enc.encode(name), props, children });

// A Properties70 "P" entry.
const P = (name, type, label, flags, ...values) => node('P', [S(name), S(type), S(label), S(flags), ...values]);

function propSize(p) {
  switch (p.t) {
    case 'C': return 2;
    case 'I': return 5;
    case 'D': case 'L': return 9;
    case 'S': case 'R': return 5 + p.v.length;
    case 'i': return 13 + 4 * p.v.length;
    case 'd': return 13 + 8 * p.v.length;
  }
  throw new Error(`unknown FBX property type ${p.t}`);
}

function nodeSize(n) {
  if (n.size !== undefined) return n.size;
  n.propsLen = n.props.reduce((s, p) => s + propSize(p), 0);
  let size = SENTINEL + n.name.length + n.propsLen;
  if (n.children.length) size += n.children.reduce((s, c) => s + nodeSize(c), 0) + SENTINEL;
  else if (!n.props.length) size += SENTINEL;
  n.size = size;
  return size;
}

function writeNode(dv, u8, off, n) {
  const end = off + nodeSize(n);
  dv.setUint32(off, end, true);
  dv.setUint32(off + 4, n.props.length, true);
  dv.setUint32(off + 8, n.propsLen, true);
  dv.setUint8(off + 12, n.name.length);
  u8.set(n.name, off + 13);
  off += 13 + n.name.length;
  for (const p of n.props) {
    u8[off++] = p.t.charCodeAt(0);
    switch (p.t) {
      case 'C': u8[off++] = p.v ? 1 : 0; break;
      case 'I': dv.setInt32(off, p.v, true); off += 4; break;
      case 'D': dv.setFloat64(off, p.v, true); off += 8; break;
      case 'L': dv.setBigInt64(off, p.v, true); off += 8; break;
      case 'S': case 'R':
        dv.setUint32(off, p.v.length, true);
        u8.set(p.v, off + 4);
        off += 4 + p.v.length;
        break;
      case 'i': case 'd': {
        const bytes = new Uint8Array(p.v.buffer, p.v.byteOffset, p.v.byteLength);
        dv.setUint32(off, p.v.length, true);
        dv.setUint32(off + 4, 0, true); // encoding: uncompressed
        dv.setUint32(off + 8, bytes.length, true);
        u8.set(bytes, off + 12); // assumes a little-endian host, true for all browsers in practice
        off += 12 + bytes.length;
        break;
      }
    }
  }
  for (const c of n.children) off = writeNode(dv, u8, off, c);
  return end; // the trailing null record (if any) is already zero
}

function encode(topLevel) {
  let size = HEAD_MAGIC.length + 4;
  for (const n of topLevel) size += nodeSize(n);
  size += SENTINEL + FOOT_ID.length + 4;
  const pad = 16 - (size % 16); // 1..16, a full 16 when already aligned
  size += pad + 4 + 120 + FOOT_MAGIC.length;

  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8.set(HEAD_MAGIC, 0);
  dv.setUint32(HEAD_MAGIC.length, VERSION, true);
  let off = HEAD_MAGIC.length + 4;
  for (const n of topLevel) off = writeNode(dv, u8, off, n);
  off += SENTINEL;
  u8.set(FOOT_ID, off);
  off += FOOT_ID.length + 4 + pad;
  dv.setUint32(off, VERSION, true);
  off += 4 + 120;
  u8.set(FOOT_MAGIC, off);
  return buf;
}

/**
 * @param mesh { positions: Float32Array (mm), normals: Float32Array,
 *               colors: Float32Array|null (sRGB 0..1), indices: Uint32Array }
 * @returns ArrayBuffer containing a binary FBX file (Y up, 1 unit = 1 mm).
 */
export function writeFBX({ positions, normals, colors, indices }, { name = 'Figure' } = {}) {
  const ids = { model: 100001, geometry: 100002, material: 100003, document: 100004 };

  const polyIndex = new Int32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    // The last vertex of each polygon is stored as -(index + 1).
    polyIndex[i] = i % 3 === 2 ? -indices[i] - 1 : indices[i];
  }

  const layerElements = [
    node('LayerElementNormal', [I(0)], [
      node('Version', [I(101)]),
      node('Name', [S('')]),
      node('MappingInformationType', [S('ByVertice')]),
      node('ReferenceInformationType', [S('Direct')]),
      node('Normals', [ad(normals)]),
    ]),
  ];
  const layer = [
    node('Version', [I(100)]),
    node('LayerElement', [], [node('Type', [S('LayerElementNormal')]), node('TypedIndex', [I(0)])]),
  ];
  if (colors) {
    const vertexCount = positions.length / 3;
    const rgba = new Float64Array(vertexCount * 4);
    for (let v = 0; v < vertexCount; v++) {
      rgba[v * 4] = colors[v * 3];
      rgba[v * 4 + 1] = colors[v * 3 + 1];
      rgba[v * 4 + 2] = colors[v * 3 + 2];
      rgba[v * 4 + 3] = 1;
    }
    layerElements.push(node('LayerElementColor', [I(0)], [
      node('Version', [I(101)]),
      node('Name', [S('Color')]),
      node('MappingInformationType', [S('ByVertice')]),
      node('ReferenceInformationType', [S('Direct')]),
      node('Colors', [ad(rgba)]),
    ]));
    layer.push(node('LayerElement', [], [node('Type', [S('LayerElementColor')]), node('TypedIndex', [I(0)])]));
  }
  layerElements.push(node('LayerElementMaterial', [I(0)], [
    node('Version', [I(101)]),
    node('Name', [S('')]),
    node('MappingInformationType', [S('AllSame')]),
    node('ReferenceInformationType', [S('IndexToDirect')]),
    node('Materials', [ai([0])]),
  ]));
  layer.push(node('LayerElement', [], [node('Type', [S('LayerElementMaterial')]), node('TypedIndex', [I(0)])]));

  const top = [
    node('FBXHeaderExtension', [], [
      node('FBXHeaderVersion', [I(1003)]),
      node('FBXVersion', [I(VERSION)]),
      node('EncryptionType', [I(0)]),
      node('CreationTimeStamp', [], [
        node('Version', [I(1000)]), node('Year', [I(1970)]), node('Month', [I(1)]), node('Day', [I(1)]),
        node('Hour', [I(10)]), node('Minute', [I(0)]), node('Second', [I(0)]), node('Millisecond', [I(0)]),
      ]),
      node('Creator', [S('2D to 3D Figure Converter')]),
    ]),
    node('FileId', [R(FILE_ID)]),
    node('CreationTime', [S(CREATION_TIME)]),
    node('Creator', [S('2D to 3D Figure Converter')]),
    node('GlobalSettings', [], [
      node('Version', [I(1000)]),
      node('Properties70', [], [
        P('UpAxis', 'int', 'Integer', '', I(1)),
        P('UpAxisSign', 'int', 'Integer', '', I(1)),
        P('FrontAxis', 'int', 'Integer', '', I(2)),
        P('FrontAxisSign', 'int', 'Integer', '', I(1)),
        P('CoordAxis', 'int', 'Integer', '', I(0)),
        P('CoordAxisSign', 'int', 'Integer', '', I(1)),
        P('OriginalUpAxis', 'int', 'Integer', '', I(1)),
        P('OriginalUpAxisSign', 'int', 'Integer', '', I(1)),
        // FBX's base unit is the centimetre; 0.1 means 1 unit = 1 mm.
        P('UnitScaleFactor', 'double', 'Number', '', D(0.1)),
        P('OriginalUnitScaleFactor', 'double', 'Number', '', D(0.1)),
      ]),
    ]),
    node('Documents', [], [
      node('Count', [I(1)]),
      node('Document', [L(ids.document), S('Scene'), S('Scene')], [
        node('Properties70', [], [
          P('SourceObject', 'object', '', ''),
          P('ActiveAnimStackName', 'KString', '', '', S('')),
        ]),
        node('RootNode', [L(0)]),
      ]),
    ]),
    node('References'),
    node('Definitions', [], [
      node('Version', [I(100)]),
      node('Count', [I(4)]),
      node('ObjectType', [S('GlobalSettings')], [node('Count', [I(1)])]),
      node('ObjectType', [S('Model')], [node('Count', [I(1)])]),
      node('ObjectType', [S('Geometry')], [node('Count', [I(1)])]),
      node('ObjectType', [S('Material')], [node('Count', [I(1)])]),
    ]),
    node('Objects', [], [
      node('Geometry', [L(ids.geometry), nameClass(name, 'Geometry'), S('Mesh')], [
        node('Properties70'),
        node('GeometryVersion', [I(124)]),
        node('Vertices', [ad(positions)]),
        node('PolygonVertexIndex', [ai(polyIndex)]),
        ...layerElements,
        node('Layer', [I(0)], layer),
      ]),
      node('Model', [L(ids.model), nameClass(name, 'Model'), S('Mesh')], [
        node('Version', [I(232)]),
        node('Properties70', [], [
          P('DefaultAttributeIndex', 'int', 'Integer', '', I(0)),
          P('InheritType', 'enum', '', '', I(1)),
        ]),
        node('MultiLayer', [I(0)]),
        node('MultiTake', [I(0)]),
        node('Shading', [C(true)]),
        node('Culling', [S('CullingOff')]),
      ]),
      node('Material', [L(ids.material), nameClass(`${name}Material`, 'Material'), S('')], [
        node('Version', [I(102)]),
        node('ShadingModel', [S('phong')]),
        node('MultiLayer', [I(0)]),
        node('Properties70', [], [
          P('DiffuseColor', 'Color', '', 'A', D(1), D(1), D(1)),
          P('Diffuse', 'Vector3D', 'Vector', '', D(1), D(1), D(1)),
        ]),
      ]),
    ]),
    node('Connections', [], [
      node('C', [S('OO'), L(ids.model), L(0)]),
      node('C', [S('OO'), L(ids.geometry), L(ids.model)]),
      node('C', [S('OO'), L(ids.material), L(ids.model)]),
    ]),
  ];
  return encode(top);
}
