#!/bin/bash
# Encodes the NEARVOLT V3 "Home Plug" film for the web from rendered JPEG frame sets.
# usage: encode-v3.sh <which: port|land|4k> <outDir>
# Web cuts skip the 0.4 s fade-from-black (so the poster == first frame, no black flash) and hold the
# final (hero) frame 0.4 s longer, keeping the film at exactly 18.0 s. The score is shifted to match.
set -euo pipefail
cd "$(dirname "$0")"
OUT="$2"; mkdir -p "$OUT"
A="-i score_norm.wav"
AF="-af atrim=start=0.4,asetpts=PTS-STARTPTS,apad=pad_dur=0.4,atrim=duration=18"
case "$1" in
  port)
    # 30 fps render: skip 12 frames, hold the last for 12
    VF="trim=start_frame=12,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.4,format=yuv420p"
    IN="-framerate 30 -i v3port/f%04d.jpg"
    ffmpeg -y -loglevel error $IN $A -map 0:v -map 1:a -vf "$VF" $AF -c:v libx264 -preset slow -crf 21 -maxrate 4.5M -bufsize 9M -g 60 -profile:v high -level 4.2 -pix_fmt yuv420p -c:a aac -b:a 128k -t 18 -movflags +faststart "$OUT/home-plug-port-1080.tmp.mp4" && mv "$OUT/home-plug-port-1080.tmp.mp4" "$OUT/home-plug-port-1080.mp4"
    M="$OUT/home-plug-port-1080.mp4"
    ffmpeg -y -loglevel error -i "$M" -c:v libvpx-vp9 -b:v 0 -crf 35 -row-mt 1 -deadline good -cpu-used 3 -g 60 -c:a libopus -b:a 96k "$OUT/home-plug-port-1080.tmp.webm" && mv "$OUT/home-plug-port-1080.tmp.webm" "$OUT/home-plug-port-1080.webm"
    ffmpeg -y -loglevel error -i "$M" -vf "scale=720:1280:flags=lanczos" -c:v libx264 -preset slow -crf 23 -maxrate 2M -bufsize 4M -g 60 -profile:v high -level 4.0 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart "$OUT/home-plug-port-720.tmp.mp4" && mv "$OUT/home-plug-port-720.tmp.mp4" "$OUT/home-plug-port-720.mp4"
    ffmpeg -y -loglevel error -i "$M" -vf "scale=720:1280:flags=lanczos" -c:v libvpx-vp9 -b:v 0 -crf 37 -row-mt 1 -deadline good -cpu-used 3 -g 60 -c:a libopus -b:a 80k "$OUT/home-plug-port-720.tmp.webm" && mv "$OUT/home-plug-port-720.tmp.webm" "$OUT/home-plug-port-720.webm"
    ffmpeg -y -loglevel error -i v3port/f0012.jpg -q:v 4 "$OUT/poster-port.jpg"
    ;;
  land)
    # 60 fps render: skip 24 frames, hold the last for 24
    VF="trim=start_frame=24,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.4,format=yuv420p"
    IN="-framerate 60 -i v3land/f%04d.jpg"
    ffmpeg -y -loglevel error $IN $A -map 0:v -map 1:a -vf "$VF" $AF -c:v libx264 -preset slow -crf 21 -maxrate 7M -bufsize 14M -g 120 -profile:v high -level 4.2 -pix_fmt yuv420p -c:a aac -b:a 160k -t 18 -movflags +faststart "$OUT/home-plug-land-1080.tmp.mp4" && mv "$OUT/home-plug-land-1080.tmp.mp4" "$OUT/home-plug-land-1080.mp4"
    M="$OUT/home-plug-land-1080.mp4"
    ffmpeg -y -loglevel error -i "$M" -c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -deadline good -cpu-used 3 -g 120 -c:a libopus -b:a 128k "$OUT/home-plug-land-1080.tmp.webm" && mv "$OUT/home-plug-land-1080.tmp.webm" "$OUT/home-plug-land-1080.webm"
    ffmpeg -y -loglevel error -i "$M" -vf "fps=30,scale=1280:720:flags=lanczos" -c:v libx264 -preset slow -crf 23 -maxrate 2.5M -bufsize 5M -g 60 -profile:v high -level 4.0 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$OUT/home-plug-land-720.tmp.mp4" && mv "$OUT/home-plug-land-720.tmp.mp4" "$OUT/home-plug-land-720.mp4"
    ffmpeg -y -loglevel error -i "$M" -vf "fps=30,scale=1280:720:flags=lanczos" -c:v libvpx-vp9 -b:v 0 -crf 36 -row-mt 1 -deadline good -cpu-used 3 -g 60 -c:a libopus -b:a 96k "$OUT/home-plug-land-720.tmp.webm" && mv "$OUT/home-plug-land-720.tmp.webm" "$OUT/home-plug-land-720.webm"
    ffmpeg -y -loglevel error -i v3land/f0024.jpg -q:v 4 "$OUT/poster-land.jpg"
    ;;
  4k)
    VF="trim=start_frame=24,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.4,format=yuv420p"
    IN="-framerate 60 -i v3land4k/f%04d.jpg"
    # 3840x2160 60 fps master (archive / download)
    ffmpeg -y -loglevel error $IN $A -map 0:v -map 1:a -vf "$VF" $AF -c:v libx264 -preset slow -crf 17 -profile:v high -level 5.2 -pix_fmt yuv420p -c:a aac -b:a 192k -t 18 -movflags +faststart "$OUT/NEARVOLT-EV-Home-Plug-4K60-master.tmp.mp4" && mv "$OUT/NEARVOLT-EV-Home-Plug-4K60-master.tmp.mp4" "$OUT/NEARVOLT-EV-Home-Plug-4K60-master.mp4"
    M="$OUT/NEARVOLT-EV-Home-Plug-4K60-master.mp4"
    # 1440p60 web cut for large, fast desktops (downscaled from the native 4K render)
    ffmpeg -y -loglevel error -i "$M" -vf "scale=2560:1440:flags=lanczos" -c:v libx264 -preset slow -crf 22 -maxrate 11M -bufsize 22M -g 120 -profile:v high -level 5.1 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$OUT/home-plug-land-1440.tmp.mp4" && mv "$OUT/home-plug-land-1440.tmp.mp4" "$OUT/home-plug-land-1440.mp4"
    ffmpeg -y -loglevel error -i "$M" -vf "scale=2560:1440:flags=lanczos" -c:v libvpx-vp9 -b:v 0 -crf 35 -row-mt 1 -deadline good -cpu-used 4 -g 120 -c:a libopus -b:a 128k "$OUT/home-plug-land-1440.tmp.webm" && mv "$OUT/home-plug-land-1440.tmp.webm" "$OUT/home-plug-land-1440.webm"
    ;;
esac
for f in "$OUT"/*.mp4 "$OUT"/*.webm; do [ -f "$f" ] && echo "$(basename "$f") $(stat -c%s "$f") $(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -show_entries format=duration -of compact=p=0:nk=1 "$f" | tr '\n' ' ')"; done
