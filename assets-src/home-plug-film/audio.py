# Original score + sound design for the 18 s NEARVOLT EV "Home Plug" film. Fully synthesised (no samples).
import sys, wave
import numpy as np

SR = 48000
DUR = 18.0
N = int(SR * DUR)
L = np.zeros(N)
R = np.zeros(N)
t = np.arange(N) / SR
rng = np.random.default_rng(3)


def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    j = min(N, i + len(sig))
    if j <= i:
        return
    s = sig[: j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan))
    R[i:j] += s * np.sqrt(0.5 * (1 + pan))


def env(n, a, d, sustain=1.0, r=None):
    e = np.ones(n) * sustain
    ai = max(1, int(a * SR))
    e[:ai] = np.linspace(0, 1, ai) * (1 if sustain >= 1 else 1)
    if r is not None:
        ri = max(1, int(r * SR))
        e[-ri:] *= np.linspace(1, 0, ri)
    di = int(d * SR)
    if di:
        e[ai:ai + di] = np.linspace(1, sustain, min(di, n - ai))[: len(e[ai:ai + di])]
    return e


def tone(freq, dur, kind='sine', a=0.005, decay=0.3):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    ph = 2 * np.pi * freq * tt
    if kind == 'sine':
        s = np.sin(ph)
    elif kind == 'bell':
        s = np.sin(ph) + 0.35 * np.sin(2.76 * ph) + 0.18 * np.sin(5.4 * ph)
    elif kind == 'saw':
        s = sum(np.sin(k * ph) / k for k in range(1, 9))
    e = np.minimum(1, tt / a) * np.exp(-tt / decay)
    return s * e


def lowpass(x, cutoff):
    # one-pole low-pass, cutoff may be an array
    y = np.zeros_like(x)
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def noise(dur):
    return rng.standard_normal(int(dur * SR))


# ---- warm pad: chord progression under the whole film (A major-ish, hopeful)
chords = [(0, [220.0, 277.18, 329.63, 440.0]), (3, [196.0, 246.94, 293.66, 392.0]), (6, [174.61, 220.0, 261.63, 349.23]), (9, [196.0, 246.94, 329.63, 392.0]), (13, [220.0, 277.18, 329.63, 493.88]), (16, [220.0, 277.18, 369.99, 440.0])]
pad = np.zeros(N)
for idx, (st, notes) in enumerate(chords):
    en = chords[idx + 1][0] if idx + 1 < len(chords) else DUR
    i0, i1 = int(st * SR), int(min(DUR, en + 0.6) * SR)
    tt = np.arange(i1 - i0) / SR
    seg = np.zeros(i1 - i0)
    for k, f in enumerate(notes):
        det = 1 + (k - 1.5) * 0.0015
        seg += np.sin(2 * np.pi * f * det * tt + k) + 0.4 * np.sin(2 * np.pi * f * 2.003 * tt) * 0.3
    fade = np.minimum(1, tt / 0.8) * np.minimum(1, (tt[-1] - tt) / 0.6 + 0.0001)
    pad[i0:i1] += seg * fade
pad = lowpass(pad, 900 + 700 * (t / DUR))
lvl = 0.05 + 0.05 * np.clip((t - 3) / 10, 0, 1) + 0.05 * np.clip((t - 15.6) / 0.6, 0, 1)
add(pad * lvl, 0, -0.15)
add(pad * lvl, 0, 0.15)

# ---- soft pulse (heartbeat of the story) from 3 s to 16 s, 100 bpm
beat = 60 / 100
for k in np.arange(3.0, 15.9, beat):
    n = int(0.35 * SR)
    tt = np.arange(n) / SR
    f = 52 + 70 * np.exp(-tt * 30)
    kick = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9)
    add(kick, k, 0, 0.22 if k < 9 else 0.28)

# ---- neighbourhood ambience at the open: air + distant birds
amb = lowpass(noise(3.4), 600) * 0.05
add(amb * np.minimum(1, np.arange(len(amb)) / SR / 0.5), 0)
for bt in [0.4, 0.9, 1.9, 2.4]:
    n = int(0.12 * SR)
    tt = np.arange(n) / SR
    chirp = np.sin(2 * np.pi * (3200 + 1800 * np.sin(tt * 90)) * tt) * np.exp(-tt * 30) * 0.05
    add(chirp, bt, rng.uniform(-0.7, 0.7))
# EV motor whine while driving
n = int(3.0 * SR)
tt = np.arange(n) / SR
whine = (np.sin(2 * np.pi * 420 * tt) + 0.5 * np.sin(2 * np.pi * 840 * tt)) * 0.012 * np.minimum(1, tt / 0.4) * np.minimum(1, (3 - tt) / 0.3)
add(whine, 0, 0)

# ---- low battery alert (two soft descending tones, twice)
for st in [1.0, 1.75]:
    add(tone(880, 0.22, 'sine', 0.004, 0.09), st, 0.1, 0.16)
    add(tone(659.25, 0.3, 'sine', 0.004, 0.12), st + 0.16, 0.1, 0.16)

# ---- whooshes on scene changes
for st, up in [(2.85, True), (5.85, True), (8.85, False), (12.85, True), (15.8, True)]:
    n = int(0.6 * SR)
    tt = np.arange(n) / SR
    cut = (300 + 5000 * (tt / 0.6) ** 2) if up else (5300 - 5000 * (tt / 0.6) ** 0.5)
    w = lowpass(noise(0.6), cut) * np.sin(np.pi * tt / 0.6) ** 2 * 0.35
    add(w, st, -0.3)
    add(w[::-1] * 0.3, st, 0.3)

# ---- map pins popping in (plucks), route drawn
for i in range(9):
    add(tone([659.25, 783.99, 987.77][i % 3] * (1 + 0.5 * (i // 3)), 0.25, 'bell', 0.002, 0.08), 3.0 + 0.45 + i * 0.12, (i % 3 - 1) * 0.5, 0.07)
n = int(1.2 * SR)
tt = np.arange(n) / SR
add(np.sin(2 * np.pi * (500 + 500 * tt) * tt) * np.sin(np.pi * tt / 1.2) * 0.02, 4.4, 0)

# ---- app taps + reservation confirmed
for st in [6.85, 7.65]:
    click = noise(0.02) * np.exp(-np.arange(int(0.02 * SR)) / SR * 300) * 0.25
    add(click, st, 0.25)
    add(tone(1800, 0.05, 'sine', 0.001, 0.015), st, 0.25, 0.06)
add(tone(783.99, 0.6, 'bell', 0.003, 0.3), 7.95, 0, 0.12)
add(tone(1174.66, 0.9, 'bell', 0.003, 0.45), 8.07, 0, 0.12)

# ---- arrival: motor winding down, tyres on paving
n = int(1.8 * SR)
tt = np.arange(n) / SR
f = 460 - 300 * (tt / 1.8)
wind = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.014 * (1 - tt / 1.8)
add(wind, 9.0, -0.2)
add(lowpass(noise(1.8), 400) * 0.06 * (1 - tt / 1.8), 9.0, 0)

# ---- connector: slide, latch click, charging swell
n = int(0.25 * SR)
tt = np.arange(n) / SR
add(lowpass(noise(0.25), 1500) * 0.08 * np.sin(np.pi * tt / 0.25), 11.4, 0.2)
clunk = (np.sin(2 * np.pi * 140 * tt) * np.exp(-tt * 40) + noise(0.25) * np.exp(-tt * 120) * 0.4) * 0.5
add(clunk, 11.75, 0.2)
add(tone(2400, 0.08, 'sine', 0.001, 0.02), 11.77, 0.2, 0.08)
n = int(2.2 * SR)
tt = np.arange(n) / SR
swell = (np.sin(2 * np.pi * (220 + 60 * tt) * tt) + 0.5 * np.sin(2 * np.pi * (330 + 90 * tt) * tt)) * np.minimum(1, tt / 0.9) * np.minimum(1, (2.2 - tt) / 0.5) * 0.05
add(swell, 12.0, 0)
add(tone(1318.5, 0.8, 'bell', 0.003, 0.35), 12.1, 0.3, 0.08)

# ---- network reveal: rising shimmer + marker pings
n = int(3.0 * SR)
tt = np.arange(n) / SR
sh = lowpass(noise(3.0), 2500 + 3000 * tt / 3) * 0.03 * np.minimum(1, tt / 1.5) * np.minimum(1, (3 - tt) / 0.3)
add(sh, 13.0, -0.4)
add(sh[::-1].copy(), 13.0, 0.4)
for i in range(14):
    at = 13.55 + (0 if i == 0 else 0.12 + (i / 14) * 1.1)
    add(tone([1046.5, 1318.5, 1567.98, 1975.53][i % 4], 0.35, 'bell', 0.002, 0.12), at, (i % 5 - 2) * 0.35, 0.05)

# ---- logo: soft impact + chime, then a warm hand-off
n = int(1.6 * SR)
tt = np.arange(n) / SR
boom = np.sin(2 * np.pi * (60 + 40 * np.exp(-tt * 6)) * tt) * np.exp(-tt * 2.5) * 0.4
add(boom, 16.0, 0)
for f, d in [(880, 0.0), (1108.73, 0.08), (1318.5, 0.16), (1760, 0.3)]:
    add(tone(f, 1.6, 'bell', 0.004, 0.7), 16.05 + d, (d - 0.15) * 2, 0.06)

mix = np.stack([L, R], axis=1)
mix = np.tanh(mix * 1.6) / 1.6  # gentle glue
fo = np.ones(N)
fo[-int(0.6 * SR):] = np.linspace(1, 0, int(0.6 * SR))
mix *= fo[:, None]
mix /= max(1e-6, np.abs(mix).max()) / 0.89
pcm = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote', sys.argv[1])
