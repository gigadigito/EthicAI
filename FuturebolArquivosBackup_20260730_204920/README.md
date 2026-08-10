# Futurebol humanoid asset

The local file `futurebol-humanoid.glb` is the RobotExpressive example model distributed by the Three.js project.

- Source: <https://threejs.org/examples/models/gltf/RobotExpressive/>
- Original model: Tomás Laulhé
- Modifications and glTF conversion: Don McCurdy
- License: CC0 1.0 Universal (public-domain dedication), as stated in `ROBOT_EXPRESSIVE_ORIGINAL_README.md`
- Runtime network dependency: none
- Exact size: 463,988 bytes (approximately 453 KiB)
- SHA-256: `047F5E5FB3BB6D378BD1DF16CA6137F2A596C99B3A1B5690B4020C05AAF6F319`
- Geometry: 3,237 triangles, 7,214 vertices, 14 meshes / 19 primitives
- Rig: 43 joints (the GLB exposes two skins backed by the same humanoid joint hierarchy)
- Materials: 3; textures/images: 0
- Head mesh: `Head`; resolved head bone: `Head`

Included animation clips:

`Dance`, `Death`, `Idle`, `Jump`, `No`, `Punch`, `Running`, `Sitting`, `Standing`, `ThumbsUp`, `Walking`, `WalkJump`, `Wave`, and `Yes`.

Futurebol maps its semantic states centrally in `futurebol-animation-map.ts`. Pass uses `Punch`; Shoot uses `WalkJump`; goalkeeper dives use `Death` with side-specific visual orientation; Celebrate uses `ThumbsUp`; Disappointed uses `No`. Missing clips always resolve through the ordered fallback map.

The human head mesh is hidden at runtime. The BTC/ETH coin is attached to the resolved head bone. The match state never references the mesh, rig, bones, or animation clip names.
