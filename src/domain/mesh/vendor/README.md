# Earcut attribution

This directory vendors **Mapbox Earcut 3.0.2** under its ISC license. The
implementation is unchanged except for attribution and a file-level Biome
exclusion. A local declaration supplies its TypeScript signature. No package
runtime dependency is added.

- Source: <https://github.com/mapbox/earcut/tree/v3.0.2>
- Original file: <https://raw.githubusercontent.com/mapbox/earcut/v3.0.2/src/earcut.js>
- Full license: [earcut.LICENSE](./earcut.LICENSE)

Earcut is a pragmatic triangulator, not an exact CAD boolean kernel. The caller
projects valid section rings, simplifies tolerance-collinear vertices, restores
their boundary chains and checks oriented edge pairing and area. These checks
do not prove absence of all possible geometric overlaps. Arbitrary polygon
soup repair is outside the experimental contract.
