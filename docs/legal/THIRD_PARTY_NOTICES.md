# Third-party notices

OpenGemCutting uses third-party packages listed in `package.json` and locked by `package-lock.json`. Their copyright and license terms remain with their respective authors.

- `@vgpu/core`, `@vgpu/wgsl` and `@vgpu/wgsl-std` are MIT licensed; see [vercel-labs/vgpu](https://github.com/vercel-labs/vgpu) and the licenses shipped in the installed packages. The optical WebGPU backend is loaded only when its viewport is opened.
- p5.js is distributed under the GNU Lesser General Public License v2.1; see the license shipped with its npm package and the upstream p5.js repository.
- React, React DOM, Vite, pdf-lib, fontkit, Tabler Icons and related build packages use their respective upstream licenses, commonly permissive licenses such as MIT.
- The bundled Noto Serif SC font files in `public/fonts/` use the SIL Open Font License 1.1; the complete text is included at `public/fonts/OFL.txt`.
- Fontsource packages provide font software under the corresponding upstream font licenses; inspect their package metadata when redistributing a build.

## Format interchange

GemCAD and Gem Cut Studio are products of their respective owners; OpenGemCutting reads and writes their file formats for interoperability only, contains no code from either program and implies no endorsement. The read-only GemCAD `.gem` reader is an original implementation whose record layout follows the MIT-licensed [gemcad-file-reader](https://github.com/mbparker/gemcad-file-reader) by Mike Parker. The format core originates from Facet Format Bridge 0.1.0-rc.1 by the OpenGemCutting maintainer, released under MIT.

Test samples in `src/domain/formats/fixtures/`: `smallest-square.asc` is Smallest Square by Robert H. Long, assigned to the public domain by its source page; the two `gcs-1.1-*.gcs` files are the bundled preset 100058 (Norman W. Steele, see the preset catalog) opened and saved by Gem Cut Studio 1.1. They are interoperability data, not recommended cutting designs.

## Built-in faceting presets

`public/presets/` contains normalized parameter records and generated technical previews derived from 252 designs indexed by [FacetDiagrams.org](https://facetdiagrams.org/). Every catalog entry preserves the credited designer, source page, source download URL, source SHA-256 and the archive-supplied `Open` declaration and duplicate-source associations so users can review its provenance.

The catalog covers 27 source-defined outline categories. Inclusion requires exact 96-index compatibility, valid final geometry, JSON round-trip stability and unique final cutting planes; these checks do not imply a guarantee of cutting results or aesthetic quality. The archive’s Open-design declaration is recorded as source provenance, not replaced with an independent licensing claim.

The project MIT License covers OpenGemCutting's code and original documentation; it does not override authorship, attribution or any separate rights attached to a named third-party faceting design. Personal contact details present in source-file notes are intentionally omitted from the bundled normalized records.

Consult each installed package's metadata, preset source page or upstream repository for exact notices before redistributing a release bundle. Project branding and original artwork are not third-party software dependencies and are not automatically licensed as trademarks by any future code license.
