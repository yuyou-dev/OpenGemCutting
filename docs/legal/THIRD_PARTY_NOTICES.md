# Third-party notices

OpenGemCutting uses third-party packages listed in `package.json` and locked by `package-lock.json`. Their copyright and license terms remain with their respective authors.

- p5.js is distributed under the GNU Lesser General Public License v2.1; see the license shipped with its npm package and the upstream p5.js repository.
- React, React DOM, Vite, pdf-lib, fontkit, Tabler Icons and related build packages use their respective upstream licenses, commonly permissive licenses such as MIT.
- The bundled Noto Serif SC font files in `public/fonts/` use the SIL Open Font License 1.1; the complete text is included at `public/fonts/OFL.txt`.
- Fontsource packages provide font software under the corresponding upstream font licenses; inspect their package metadata when redistributing a build.

## Built-in faceting presets

`public/presets/` contains normalized parameter records and generated technical previews derived from 252 designs indexed by [FacetDiagrams.org](https://facetdiagrams.org/). Every catalog entry preserves the credited designer, source page, source download URL, source SHA-256 and the archive-supplied `Open` declaration and duplicate-source associations so users can review its provenance.

The catalog covers 27 source-defined outline categories. Inclusion requires exact 96-index compatibility, valid final geometry, JSON round-trip stability and unique final cutting planes; these checks do not imply a guarantee of cutting results or aesthetic quality. The archive’s Open-design declaration is recorded as source provenance, not replaced with an independent licensing claim.

The project MIT License covers OpenGemCutting's code and original documentation; it does not override authorship, attribution or any separate rights attached to a named third-party faceting design. Personal contact details present in source-file notes are intentionally omitted from the bundled normalized records.

Consult each installed package's metadata, preset source page or upstream repository for exact notices before redistributing a release bundle. Project branding and original artwork are not third-party software dependencies and are not automatically licensed as trademarks by any future code license.
