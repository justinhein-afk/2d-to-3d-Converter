"""Convert a GLB file to a .blend file.

Runs inside Blender:   blender -b --factory-startup --python blend_convert.py -- in.glb out.blend
or with the bpy module: python blend_convert.py in.glb out.blend
"""

import sys

import bpy


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if len(argv) != 2:
        sys.exit("usage: blend_convert.py <input.glb> <output.blend>")
    src, dst = argv

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    # Show the figure's vertex colours through its material, both in the
    # viewport (Material Preview) and in renders.
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.data.color_attributes:
            continue
        mat = bpy.data.materials.new("FigureMaterial")
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        attr = nodes.new("ShaderNodeVertexColor")
        attr.layer_name = obj.data.color_attributes[0].name
        attr.location = (bsdf.location.x - 300, bsdf.location.y)
        mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.6
        obj.data.materials.clear()
        obj.data.materials.append(mat)

    bpy.ops.wm.save_as_mainfile(filepath=dst)


if __name__ == "__main__":
    main()
