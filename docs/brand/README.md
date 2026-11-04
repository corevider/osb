# OSB brand files

- `readme-header.jpg`: the header image at the top of the README (2560 × 640).
- `social-preview.jpg`: the GitHub social preview (1280 × 640). Upload it under Settings > General > Social preview.
- `osb-mark-small.svg`: the small OSB seal (32 px grid). `build-lean.py` embeds it as the panel's title bar mark and as the userscript `@icon`.

All three come from the OSB brand masters in the OSB Manager repository (`brand/`, guide in `brand/README.md`). Regenerate the images with `python scripts/brand/build-share-art.py --bot <this repository>` there; it also copies `osb-mark-small.svg` here. Then run `build-lean.py`. Do not edit these files by hand.
