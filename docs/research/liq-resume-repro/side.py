# Side effects of the conditional auto.reload: python3 side.py <C|D> <dir>
import socket, subprocess, sys, time, re
scenario, W = sys.argv[1], sys.argv[2]
open(f'{W}/auto.m3u', 'w').write('/w/old1.wav\n/w/old2.wav\n')
name = f'liqside-{scenario}'
subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
subprocess.run(['docker', 'run', '-d', '--name', name, '-p', '127.0.0.1::1234', '-v', f'{W}:/w', '--entrypoint', 'liquidsoap',
                'subwave-broadcast:develop-thevault.2', '/w/repro.liq'], check=True, capture_output=True)
time.sleep(1)
port = int(subprocess.run(['docker', 'port', name, '1234'], capture_output=True, text=True).stdout.strip().rsplit(':', 1)[1])
logs = lambda: subprocess.run(['docker', 'logs', name], capture_output=True, text=True).stdout
def wait_for(t, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        if t in logs(): return
        time.sleep(0.2)
    raise SystemExit(f'timed out waiting for {t!r}')
def cmd(c):
    for _ in range(100):
        try:
            s = socket.create_connection(('127.0.0.1', port), 1); s.sendall((c + '\nquit\n').encode()); out = b''
            while True:
                b = s.recv(4096)
                if not b: break
                out += b
            s.close(); return out.decode().split('\nEND')[0].strip()
        except OSError: time.sleep(0.2)
wait_for('ON_AIR /w/old1.wav')
if scenario == 'C':
    for _ in range(3): print('reload ->', cmd('auto.reload')); time.sleep(0.5)   # auto on air
    time.sleep(4)
if scenario == 'D':
    cmd('dj_queue.push /w/dj.wav'); wait_for('ON_AIR /w/dj.wav')
    for _ in range(int(sys.argv[3]) if len(sys.argv) > 3 else 5): cmd('auto.reload'); time.sleep(float(sys.argv[4]) if len(sys.argv) > 4 else 0.3)
    time.sleep(1); before = logs().count('Reloading playlist')
    open(f'{W}/auto.m3u', 'w').write('/w/new1.wav\n'); time.sleep(2)
    print('watch reloads for one file change:', logs().count('Reloading playlist') - before)
    print('state:', cmd('auto_state'))
out = logs(); subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
print(' -> '.join(l.split('ON_AIR /w/')[1] for l in out.splitlines() if 'ON_AIR' in l))
print('auto_playlist lifecycle lines:', len([l for l in out.splitlines() if 'auto_playlist' in l and re.search(r'shut|down|sleep|destroy', l, re.I)]))
