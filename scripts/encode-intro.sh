#!/bin/sh
# Encodes rendered frames + original audio into the web intro files and posters.
set -e
A=assets-src/intro-audio.wav
O=public/video
mkdir -p "$O"
X264="-c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -movflags +faststart"
VP9="-c:v libvpx-vp9 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p"
# landscape 1080p
ffmpeg -y -v error -framerate 30 -i frames/land/f%04d.jpg -i $A $X264 -crf 22 -maxrate 6M -bufsize 12M -c:a aac -b:a 128k -shortest "$O/nearvolt-intro-1080.mp4"
ffmpeg -y -v error -framerate 30 -i frames/land/f%04d.jpg -i $A $VP9 -b:v 0 -crf 34 -c:a libopus -b:a 96k -shortest "$O/nearvolt-intro-1080.webm"
# landscape 720p (mobile landscape / slower connections)
ffmpeg -y -v error -framerate 30 -i frames/land/f%04d.jpg -i $A -vf scale=1280:720:flags=lanczos $X264 -crf 24 -maxrate 2.5M -bufsize 5M -c:a aac -b:a 96k -shortest "$O/nearvolt-intro-720.mp4"
ffmpeg -y -v error -framerate 30 -i frames/land/f%04d.jpg -i $A -vf scale=1280:720:flags=lanczos $VP9 -b:v 0 -crf 37 -c:a libopus -b:a 80k -shortest "$O/nearvolt-intro-720.webm"
# portrait 720x1280 (phones)
ffmpeg -y -v error -framerate 30 -i frames/port/f%04d.jpg -i $A $X264 -crf 24 -maxrate 2.5M -bufsize 5M -c:a aac -b:a 96k -shortest "$O/nearvolt-intro-portrait.mp4"
ffmpeg -y -v error -framerate 30 -i frames/port/f%04d.jpg -i $A $VP9 -b:v 0 -crf 37 -c:a libopus -b:a 80k -shortest "$O/nearvolt-intro-portrait.webm"
# posters: final frame = live hero start frame (WebGL fallback + handoff), mid frame = share image
LAST_L=$(ls frames/land | tail -1); LAST_P=$(ls frames/port | tail -1)
ffmpeg -y -v error -i "frames/land/$LAST_L" -q:v 3 "$O/hero-land.jpg"
ffmpeg -y -v error -i "frames/port/$LAST_P" -q:v 3 "$O/hero-port.jpg"
ffmpeg -y -v error -i frames/land/f0205.jpg -q:v 3 "$O/nearvolt-intro-poster.jpg"
ls -la "$O"
