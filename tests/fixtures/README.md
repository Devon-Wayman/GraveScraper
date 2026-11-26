`gradient.heic` is a synthetic 160 × 96 RGB gradient generated for this project's HEIC tests. It contains a camera capture timestamp of `2026:11:21 14:35:20` and no personal photo content.

It was created by generating a JPEG with Sharp, then converting it using macOS ImageIO: `sips -s format heic input.jpg --out gradient.heic`. Tests read the committed fixture; macOS image tools are not required to run them. The packaged-app smoke test also uploads this fixture to verify the bundled HEIC worker.
