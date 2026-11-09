"""Original NEARVOLT EV intro sound design, synthesised from scratch with numpy (no samples).
Output: assets-src/intro-audio.wav (8 s, 48 kHz stereo)."""
import os, wave
import numpy as np

SR, LEN = 48000, 8.0
N = int(SR * LEN)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)

def env(start, attack, decay, length=None):
    e = np.zeros(N)
    i0 = int(start * SR)
    n = int((length or (attack + decay * 6)) * SR)
    x = np.arange(min(n, N - i0)) / SR
    e[i0:i0 + len(x)] = np.minimum(1, x / max(attack, 1e-4)) * np.exp(-np.maximum(0, x - attack) / decay)
    return e

def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR); y = np.zeros_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc; y[i] = acc
    return y

def add(sig, gain=1.0, pan=0.0):
    global L, R
    L += sig * gain * np.sqrt(0.5 * (1 - pan)); R += sig * gain * np.sqrt(0.5 * (1 + pan))

def thump(at, f0=55, gain=1.0, pan=0.0, decay=0.25):
    ph = 2 * np.pi * np.cumsum(f0 * (1 + 2.5 * np.exp(-np.maximum(0, t - at) / 0.03))) / SR
    add(np.sin(ph) * env(at, 0.003, decay), gain, pan)

def click(at, gain=0.3, pan=0.0, bright=6000):
    n = rng.standard_normal(N) * env(at, 0.0005, 0.012)
    add(n - lowpass(n, bright * 0.3), gain, pan)

# sub-bass bed that breathes in
bed = np.sin(2 * np.pi * 36 * t) * 0.5 + np.sin(2 * np.pi * 54.3 * t) * 0.25
bed *= np.clip(t / 2.0, 0, 1) ** 2 * (1 - np.clip((t - 7.2) / 0.8, 0, 1) * 0.6)
add(bed, 0.22)
# headlights: two-stage ignition
for at, g in ((0.55, 0.9), (0.72, 1.0)):
    thump(at, 48, g * 0.8); click(at, 0.35 * g)
whine = np.sin(2 * np.pi * np.cumsum(900 + 1400 * np.clip((t - 0.72) / 0.9, 0, 1)) / SR)
add(whine * env(0.72, 0.4, 0.5) * 0.05, 1.0)
# studio lights snapping on, left to right
for at, pan in ((2.0, -0.7), (2.3, -0.2), (2.6, 0.4), (2.9, 0.8)):
    thump(at, 70, 0.45, pan, 0.18); click(at, 0.22, pan, 4000)
# camera whoosh 2.0-4.6
noise = rng.standard_normal(N)
sweep = lowpass(noise, 900) * np.clip(np.sin(np.pi * np.clip((t - 2.0) / 2.6, 0, 1)), 0, 1) ** 2
add(sweep, 0.5, 0.0)
# connector servo 4.3-5.2 and magnetic lock
servo = np.sign(np.sin(2 * np.pi * np.cumsum(140 + 60 * np.clip((t - 4.3) / 0.9, 0, 1)) / SR))
servo = lowpass(servo, 1200) * ((t > 4.3) & (t < 5.22)) * 0.06
add(servo, 1.0, 0.3)
thump(5.22, 42, 1.3, 0.2, 0.35); click(5.22, 0.6, 0.2, 9000); click(5.25, 0.3, 0.3, 9000)
# rising energy hum 5.3-7.3
f = 70 + 75 * np.clip((t - 5.3) / 1.9, 0, 1)
ph = 2 * np.pi * np.cumsum(f) / SR
hum = sum(np.sin(k * ph) / k for k in range(1, 9))
hum = lowpass(hum, 1600) * np.clip((t - 5.3) / 0.6, 0, 1) * (1 - np.clip((t - 7.1) / 0.9, 0, 1))
add(hum, 0.16)
# particle sparkle 6.0-7.0
for i in range(140):
    at = 6.0 + rng.random() * 1.0
    fr = 2500 + rng.random() * 4500
    s = np.sin(2 * np.pi * fr * (t - at)) * env(at, 0.001, 0.04 + rng.random() * 0.05)
    add(s, 0.02, rng.uniform(-0.9, 0.9))
# logo reveal: deep boom + bright chord
thump(6.9, 38, 1.6, 0, 0.9)
for fr, g in ((220, 0.5), (329.6, 0.35), (440, 0.3), (554.4, 0.22), (659.3, 0.18), (880, 0.1)):
    tone = (np.sin(2 * np.pi * fr * t) + 0.3 * np.sin(2 * np.pi * fr * 2.003 * t)) * env(6.9, 0.02, 0.55, 1.1)
    add(tone, g * 0.22, (fr % 3 - 1) * 0.3)

# simple stereo reverb: exponential-decay noise impulse response via FFT convolution
def reverb(x, seed):
    ir_n = int(1.6 * SR); r = np.random.default_rng(seed)
    ir = r.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR / 0.45); ir[0] = 0
    n = len(x) + ir_n
    y = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[:len(x)]
    return y / np.max(np.abs(ir)) * 0.012
L, R = L + reverb(L, 1), R + reverb(R, 2)
fade = np.clip((LEN - t) / 0.6, 0, 1)
L *= fade; R *= fade
peak = max(np.max(np.abs(L)), np.max(np.abs(R)))
L, R = L / peak * 0.89, R / peak * 0.89
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets-src/intro-audio.wav')
os.makedirs(os.path.dirname(out), exist_ok=True)
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.stack([L, R], 1) * 32767).astype('<i2').tobytes())
print('wrote', out)
