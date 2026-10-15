settings.server.telnet := true
settings.server.telnet.bind_addr := "0.0.0.0"
settings.server.telnet.port := 1234
settings.log.stdout := true
settings.log.level := 3
settings.init.allow_root := true

dj_queue = request.queue(id="dj_queue")
auto_playlist = playlist(id="auto", reload_mode="watch", mode="normal", "/w/auto.m3u")
music = fallback(id="music", track_sensitive=true, [dj_queue, auto_playlist])
music.on_track(synchronous=true, fun (m) -> print("ON_AIR #{m['filename']}"))
radio = music
# The idle gate, as radio.liq builds it.
idle_mode = ref(false)
radio = switch(id="idle_gate", track_sensitive=false, [({idle_mode()}, blank(id="idle_silence")), ({true}, radio)])
server.register("idle_on", fun (_) -> begin idle_mode := true "OK" end)
server.register("idle_off", fun (_) -> begin idle_mode := false "OK" end)
server.register("skip", fun (_) -> begin radio.skip() "OK" end)
output.dummy(fallible=true, radio)
def req_uri(r) = list.assoc(default="?", "initial_uri", request.metadata(r)) end
server.register("auto_state", fun (_) -> begin
  cur = auto_playlist.current()
  c = null.case(cur, fun () -> "none", fun (r) -> req_uri(r))
  q = list.map(req_uri, auto_playlist.queue())
  "current=#{c} queue=#{q}"
end)
