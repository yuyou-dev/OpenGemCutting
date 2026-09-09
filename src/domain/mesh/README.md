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

## Attribution

`cut.js`, `section.js`, `types.js`, `validate.js`, `import-obj.js`, vector helpers
and test fixtures adapt the MIT-licensed experimental core of
[GemstoneCuttingSystem](https://github.com/yuyou-dev/GemstoneCuttingSystem),
copyright 2026 yuyou-dev. The MIT notice is retained in [LICENSE](LICENSE).
The workbench adds its geometry facade, face ownership, import embedding checks
and convex preview validation. Mapbox Earcut 3.0.2 remains under its separate
ISC license; see [vendor/README.md](vendor/README.md).
