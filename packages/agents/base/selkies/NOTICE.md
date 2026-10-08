# Third-party software in /opt/selkies

The browser panel's stream server: Selkies 2.0.0, pixelflux 2.1.0, pcmflux 2.1.0
and their Python dependencies, installed unmodified from their published wheels
(`requirements.txt` beside the image's build script pins each one by hash).
Every package's license texts are in `site/<package>.dist-info/licenses/`;
pixelflux's and pcmflux's `LICENSES.md` there inventory the native libraries
their wheels bundle. Selkies, pixelflux and pcmflux are MPL-2.0; Selkies
vendors python-xlib (LGPL-2.1, `site/selkies/Xlib/LICENSE`).

The platform runs this software as a separate process and reaches it over a
socket; none of the platform's own code links it.

## GPL-licensed components

The pixelflux wheel links libx264 and bundles FFmpeg built with libx265, all
GPL-2.0-or-later, so the pixelflux extension and those libraries are distributed
under GPL-2.0-or-later. Their source:

- pixelflux 2.1.0, with the recipe its wheels are built by (`pyproject.toml`,
  `before-all`): https://github.com/selkies-project/pixelflux/tree/2.1.0
- FFmpeg n8.1: https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz
- x265 4.2: https://bitbucket.org/multicoreware/x265_git/src/4.2/
- x264, the `stable` branch at the time of the wheel's build (ABI 165):
  https://code.videolan.org/videolan/x264/-/tree/stable

## LGPL-licensed components

pcmflux bundles the PulseAudio client libraries and the libraries they link
(LGPL-2.1-or-later and permissive), as AlmaLinux 8 packages; its SBOM,
`site/pcmflux-2.1.0.dist-info/sboms/auditwheel.cdx.json`, names each package
and version, whose source is AlmaLinux 8's source RPMs at those versions:
https://vault.almalinux.org/
