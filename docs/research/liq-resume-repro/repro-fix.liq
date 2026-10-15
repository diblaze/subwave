settings.server.telnet := true
settings.server.telnet.bind_addr := "0.0.0.0"
settings.server.telnet.port := 1234
settings.log.stdout := true
settings.log.level := 4
settings.init.allow_root := true

dj_queue = request.queue(id="dj_queue")
def make_auto() =
  playlist(id="auto_playlist", register_server_commands=false, reload_mode="never", mode="normal", "/w/auto.m3u")
end
auto_playlist = ref(make_auto())
pending_auto = ref(null)
auto_slot = source.dynamic(id="auto_slot", init=auto_playlist(), fun () -> begin
  next = pending_auto()
  pending_auto := null
  next
end)
auto_on_air = ref(false)
dj_queue.on_track(synchronous=true, fun (_) -> auto_on_air := false)
auto_slot.on_track(synchronous=true, fun (_) -> auto_on_air := true)
server.register(namespace="auto", "reload", fun (_) -> begin
  # On air, or a fresh instance not yet committed: a plain reload is enough.
  if auto_on_air() or null.defined(pending_auto()) then
    auto_playlist().reload()
  else
    auto_playlist := make_auto()
    auto_slot.prepare(auto_playlist())
    pending_auto := auto_playlist()
  end
  "OK"
end)
music = fallback(id="music", track_sensitive=true, [dj_queue, auto_slot])
music.on_track(synchronous=true, fun (m) -> print("ON_AIR #{m['filename']}"))
radio = music
idle_mode = ref(false)
radio = switch(id="idle_gate", track_sensitive=false, [({idle_mode()}, blank(id="idle_silence")), ({true}, radio)])
server.register("idle_on", fun (_) -> begin idle_mode := true "OK" end)
server.register("idle_off", fun (_) -> begin idle_mode := false "OK" end)
server.register("skip", fun (_) -> begin radio.skip() "OK" end)
def req_uri(r) = list.assoc(default="?", "initial_uri", request.metadata(r)) end
server.register("auto_state", fun (_) -> begin
  p = auto_playlist()
  c = null.case(p.current(), fun () -> "none", fun (r) -> req_uri(r))
  "on_air=#{auto_on_air()} current=#{c} queue=#{list.map(req_uri, p.queue())}"
end)
output.dummy(fallible=true, radio)
