# Drive repro.liq in a throwaway container: python3 drive.py <A|B> <none|skipauto|cmd> <dir>
#   A: old-show fallback plays, a DJ pick takes over, idle, resume into a new show.
#   B: only the fallback was playing when the programme paused.
import socket, subprocess, sys, time
scenario, fix, W = sys.argv[1], sys.argv[2], sys.argv[3]
open(f'{W}/auto.m3u', 'w').write('/w/old1.wav\n/w/old2.wav\n')
name = f'liqrepro-{scenario}-{fix}'
subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
subprocess.run(['docker', 'run', '-d', '--name', name, '-p', '127.0.0.1::1234', '-v', f'{W}:/w', '--entrypoint', 'liquidsoap',
                'subwave-broadcast:develop-thevault.2', '/w/repro.liq'], check=True, capture_output=True)
time.sleep(1)
port = int(subprocess.run(['docker', 'port', name, '1234'], capture_output=True, text=True).stdout.strip().rsplit(':', 1)[1])
logs = lambda: subprocess.run(['docker', 'logs', name], capture_output=True, text=True).stdout
def wait_for(text, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        if text in logs(): return
        time.sleep(0.2)
    raise SystemExit(f'timed out waiting for {text!r}')
def cmd(c):
    for _ in range(100):
        try:
            s = socket.create_connection(('127.0.0.1', port), 1)
            s.sendall((c + '\nquit\n').encode()); out = b''
            while True:
                b = s.recv(4096)
                if not b: break
                out += b
            s.close(); return out.decode().split('\nEND')[0].strip()
        except OSError:
            time.sleep(0.2)
    raise SystemExit(f'no telnet answer for {c}')
wait_for('ON_AIR /w/old1.wav')
if scenario == 'A':
    cmd('dj_queue.push /w/dj.wav')
    wait_for('ON_AIR /w/dj.wav')           # old1 ended; the playlist has prepared old2
    time.sleep(1)
cmd('idle_on'); time.sleep(2)
open(f'{W}/auto.m3u', 'w').write('/w/new1.wav\n/w/new2.wav\n')   # the show changes while paused
time.sleep(1)
cmd('idle_off'); time.sleep(1)
print('before reload:', cmd('auto_state'))
cmd('auto.reload')
time.sleep(0.5)
print('after reload: ', cmd('auto_state'))
if fix == 'skipauto':
    cmd('auto.skip'); time.sleep(0.5); print('after auto.skip:', cmd('auto_state'))
if fix == 'cmd': print('auto_replace ->', cmd('auto_replace'))
cmd('skip')
time.sleep(6)
if fix == 'cmd':
    open(f'{W}/auto.m3u', 'w').write('/w/new2.wav\n')
    print('hourly auto.reload after replace ->', cmd('auto.reload')); time.sleep(0.5); print('state:', cmd('auto_state'))
    for _ in range(int(sys.argv[4]) if len(sys.argv) > 4 else 3): cmd('auto_replace'); time.sleep(0.5)
    before = logs().count('Reloading playlist')
    open(f'{W}/auto.m3u', 'w').write('/w/new1.wav\n'); time.sleep(2)
    print('watch reloads for one file change after 3 more replaces:', logs().count('Reloading playlist') - before)
out = logs()
subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
print(' -> '.join(l.split('ON_AIR /w/')[1] for l in out.splitlines() if 'ON_AIR' in l))
for l in out.splitlines():
    if 'Switch to' in l or 'Prepared' in l or 'ON_AIR' in l or 'CHECK_NEXT' in l or 'Reloading' in l: print('   ', l[11:19], l.split('] ',1)[-1] if '] ' in l else l)
