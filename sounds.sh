#!/usr/bin/env bash
set -e

SRC="recordings"
DST="asterisk-sounds"

mkdir -p "$DST"

for f in "$SRC"/*; do
  [ -f "$f" ] || continue

  base="$(basename "$f")"
  name="${base%.*}"

  echo "Converting: $base → $name.wav"

  ffmpeg -y -loglevel error \
    -i "$f" \
    -ar 8000 \
    -ac 1 \
    -c:a pcm_s16le \
    "$DST/$name.wav"
done

echo "Done."

