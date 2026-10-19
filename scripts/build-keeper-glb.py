# Build public/models/keeper.glb from the Mixamo downloads in
# assets-src/mixamo/keeper/ (see docs/art-direction/mixamo-downloads.md).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
#     --python scripts/build-keeper-glb.py -- assets-src/mixamo/keeper public/models/keeper.glb
#
# One file: the character (mesh, skeleton, textures) plus every clip as a
# named animation (idle, step_L, dive_high_R, ...), so the game loads one
# GLB instead of ten FBX files. Textures are cut to game size: the keeper is
# about 140 px tall on screen, and the 4096 px Mixamo maps were most of the
# 52 MB.
import os
import sys

import bpy

ROLES = ['idle', 'step_L', 'step_R', 'dive_high_L', 'dive_high_R', 'dive_low_L', 'dive_low_R', 'catch', 'getup']
TEXTURE_SIZE = {'Ch38_1001': 1024, 'Ch38_1002': 512}   # body atlas, hair
FPS = 30   # Mixamo exports at the 30 fps chosen in the download settings

src, out = sys.argv[sys.argv.index('--') + 1:][:2]


def import_fbx(path):
    before = set(bpy.data.objects)
    if hasattr(bpy.ops.wm, 'fbx_import'):   # Blender 4.5+ built-in importer
        bpy.ops.wm.fbx_import(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    return arm, new


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

# The character. Its own action is just the T-pose; drop it.
char, _ = import_fbx(os.path.join(src, 'keeper_character.fbx'))
char.name = 'Keeper'
if char.animation_data and char.animation_data.action:
    bpy.data.actions.remove(char.animation_data.action)
char.animation_data_create()

# Each clip: take its action, put it on the character as an NLA track named
# after its role (the exporter makes one glTF animation per track), then
# throw away the clip's own copy of the skeleton.
for role in ROLES:
    arm, objs = import_fbx(os.path.join(src, f'keeper_{role}.fbx'))
    action = arm.animation_data.action
    action.name = role
    action.use_fake_user = True
    track = char.animation_data.nla_tracks.new()
    track.name = role
    # at frame 0, so each animation starts at time 0 (Blender counts from frame 1)
    strip = track.strips.new(role, 0, action)
    if hasattr(strip, 'action_slot') and action.slots:   # Blender 4.4+ slotted actions
        strip.action_slot = action.slots[0]
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f'clip {role}: frames {tuple(action.frame_range)}')

# Materials: keep the colour and normal maps (what the game's material
# uses), drop the gloss and specular maps, and shrink the images.
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    for node in list(mat.node_tree.nodes):
        if node.type == 'TEX_IMAGE' and node.image and any(k in node.image.name for k in ('Glossiness', 'Specular')):
            mat.node_tree.nodes.remove(node)
for img in bpy.data.images:
    for prefix, size in TEXTURE_SIZE.items():
        if img.name.startswith(prefix) and img.size[0] > size:
            img.scale(size, size)
    print(f'image {img.name}: {tuple(img.size)}')
for img in [i for i in bpy.data.images if i.users == 0]:
    bpy.data.images.remove(img)

os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_yup=True,
    export_skins=True,
    export_morph=False,
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_force_sampling=True,
    export_optimize_animation_size=True,   # drops keys that don't change anything
    export_frame_step=1,
    export_reset_pose_bones=True,
    export_image_format='JPEG',
    export_jpeg_quality=85,
)
print(f'wrote {out}: {os.path.getsize(out) / 1e6:.1f} MB')
