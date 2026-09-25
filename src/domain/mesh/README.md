# Indexed material-boundary kernel

The workbench stores the original crystal independently from its CUT planes.
This module intersects that crystal with each ordered `normal · point <= offset`
half-space. It preserves concavity, disconnected components, inward cavity
shells, and section holes. Each source polygon must be planar and convex; the
OBJ adapter triangulates concave planar polygons first.

`index.js` is the application boundary. `createMeshSolid` and `parseMeshOBJ`
validate topology, vertex links, local face geometry, triangle self-intersections
through a BVH, and shell containment/orientation. Validation rejects intersecting
or touching unrelated shells and does not repair polygon soup. Convex preview
adaptation instead verifies a single closed spherical boundary and all outward
half-spaces. Validated immutable sources and cutter outputs avoid repeat import
validation. Never mutate their arrays in place.

Cuts classify shared vertices once, cache intersections by shared edge, trace
oriented boundary loops, and triangulate caps including holes. Collinear section
vertices are restored after triangulation so adjacent faces share identical edge
indices. Cap patches have unique `id` values and a shared logical `facetId`.
A singular branching section reports `PolyhedronError` rather than replacing
material with a convex hull. The caller must keep that draft recoverable.

For one cut the topology walk costs O(V + E + F); cap triangulation depends on
section size and Earcut's behavior. Repeated cuts cost the sum of those evolving
mesh sizes, not constant time. BVH candidate pairs can still become quadratic
for heavily overlapping bounds. No unconditional 20 ms or 10,000-face latency
claim is implied by this algorithm.

## Round-tool subtraction

`boolean.js` is the only mesh module allowed to import a runtime mathematical
dependency: the pinned, MIT-licensed `@jscad/modeling` 2.13.0. It uses JSCAD's
solid difference, sphere/cylinder primitives, and T-junction insertion directly,
without copying their implementation. Narrow module imports avoid including
unrelated modeling operations in the browser. The exact pin matters because the
BSP subtraction and T-junction helpers are internal modules; upgrades require Boolean regression and
browser build verification. This dependency has no React, DOM or renderer state.

The adapter conditions input to a centered 100,000-unit box for JSCAD's
absolute splitting epsilon and restores machine coordinates before strict
validation. Tool dimensions below one millionth of stock extent fail explicitly.
It retains authored source planes, traces result patches to their source,
welds coincident positions without grid snapping, and completes T junctions
using existing boundary vertices. BSP patches are preserved without final
retessellation, which can erase narrow cutter-tip wedges. Only nonconvex patches
created by junction completion are triangulated, preserving every edge.
Full topology, orientation, embedding and cavity checks validate the result.
Triangle intersection tests use stable whole-patch normals and finite-edge
contact distances so acute, nearly coplanar corners cannot amplify roundoff
into fictitious crossings. Actual intersecting or overlapping shells still fail.
Sphere/cylinder/V-wheel walls retain their tool ownership; cylinder end caps
and the five faces of the adjustable triangular prism are planar tool surfaces.
This is tessellated solid CSG, not an analytic curved-surface optical solver or a
machining-kinematics model. `documentGeometry.js` composes the independent
parameter groups and owns immutable caching; no document state enters this
mesh adapter. See the [JSCAD Boolean API](https://jscad.app/docs/module-modeling_booleans.html)
and the dependency's installed `LICENSE` for implementation attribution.

## Attribution

`cut.js`, `section.js`, `types.js`, `validate.js`, `import-obj.js`, vector helpers
and test fixtures adapt the MIT-licensed experimental core of
[GemstoneCuttingSystem](https://github.com/yuyou-dev/GemstoneCuttingSystem),
copyright 2026 yuyou-dev. The MIT notice is retained in [LICENSE](LICENSE).
The workbench adds its geometry facade, face ownership, import embedding checks
and convex preview validation. Mapbox Earcut 3.0.2 remains under its separate
ISC license; see [vendor/README.md](vendor/README.md).
