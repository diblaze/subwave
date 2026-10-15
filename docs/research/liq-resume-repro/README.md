# Isolated reproduction: resume into another show plays the old fallback

Minimal model of radio.liq's music chain (dj_queue + `auto` playlist in a
track-sensitive fallback, behind the idle gate switch) on the mixer image's
Liquidsoap 2.4.5, driven over a private telnet port. Never touches a live mixer.

    for f in old1:330:4 old2:300:4 new1:660:4 new2:700:4 dj:440:8; do ...ffmpeg sine...; done   # tone files into $DIR
    cp repro-today.liq $DIR/repro.liq; python3 drive.py A none $DIR   # old1 -> dj -> old2 -> new1   (bug)
    cp repro-fix.liq   $DIR/repro.liq; python3 drive.py A none $DIR   # old1 -> dj -> new1          (fixed)
    python3 drive.py B none $DIR                                      # old1 -> new1 (both)
    python3 side.py C $DIR; python3 side.py D $DIR 20 0.3             # reload while auto on air / many swaps

Scenario A: old-show fallback plays, a DJ pick takes over (the playlist prepares
old2 as its current request), idle_on, show changes, idle_off, auto.reload, skip.
Scenario B: only the fallback was playing when the programme paused.
