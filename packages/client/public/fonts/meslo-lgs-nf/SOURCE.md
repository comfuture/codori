# MesloLGS NF webfont provenance

These WOFF2 files are converted derivatives of the four MesloLGS NF TTF files
published by the official Powerlevel10k media repository.

- Source repository: <https://github.com/romkatv/powerlevel10k-media>
- Source commit: `145eb9fbc2f42ee408dacd9b22d8e6e0e553f83d`
- Font copyright: Copyright 2009, 2010, 2013 André Berg
- License: Apache License 2.0; see `LICENSE.txt` in this directory
- Conversion tool: fonttools 4.63.0 with WOFF2 support
- Conversion: load each original TTF with `fontTools.ttLib.TTFont`, set
  `font.flavor = "woff2"`, and save without subsetting.

## Original TTF SHA-256

- Regular: `d97946186e97f8d7c0139e8983abf40a1d2d086924f2c5dbf1c29bd8f2c6e57d`
- Bold: `b6c0199cf7c7483c8343ea020658925e6de0aeb318b89908152fcb4d19226003`
- Italic: `6f357bcbe2597704e157a915625928bca38364a89c22a4ac36e7a116dcd392ef`
- Bold Italic: `56b4131adecec052c4b324efb818dd326d586dbc316fc68f98f1cae2eb8d1220`

## Converted WOFF2 SHA-256

- `MesloLGS-NF-Regular.woff2`: `f8dbaabcfc030a3839b1f9491769a5b997d4b15421f6d7072545788451892a52`
- `MesloLGS-NF-Bold.woff2`: `3ebdff3af00308999546bb6cbdd0166d1f4faa81022da6312ac58d49bb4acd2e`
- `MesloLGS-NF-Italic.woff2`: `e62c7e2463db04bf30b0629cf7f0a02397a870e4440d5a4aac2992052200e1d4`
- `MesloLGS-NF-BoldItalic.woff2`: `d6ff859ef6a419f7e6c6e51fb712f28d82de28872a0d89a77846579b10246c43`
