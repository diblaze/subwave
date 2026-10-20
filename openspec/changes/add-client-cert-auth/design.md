# Design

## Context
E1–E63: explorer sweep, `/mnt/black/tmp/claude/claude-1000/-sharedfolders-media-docker-services/29522cdf-e0b1-440c-9081-12c296864c3c/scratchpad/mtls-evidence.md` (repo @ ee9ab1b5). Added here (paths under `app/` unless noted; `node_modules` read from the sibling checkout `~/git/subwave-up/app/node_modules`, same lockfile versions):

- E64 `src/lib/api.ts:115-119` — `export function createApi(rawBase, credentials?, stationPassword = () => null)`; `:124-127` `streamAuthHeaders … ? { Authorization } : undefined` / `api = (p) => \`${requestBase}/api${p}\``; `:215` `streamHeaders: () => streamAuthHeaders` — single client; headers plug in here.
- E65 `src/lib/api.ts:109-113` — `getJson … fetchWithTimeout(url, { signal })`; `:155-158,162-165,173-176,190-193` POSTs with `'Content-Type'` only — every API call routes through `fetchWithTimeout`.
- E66 `src/config/StationContext.tsx:106-124` — `selectStation` → `loadStationCredentials` → `setActiveStation` → `teardown()`; `:157-163` `api = useMemo(() => createApi(base, credentials, () => stationPasswordRef.current), [base, credentials])`.
- E67 `src/lib/station.ts:190-202` — `secureStorage` (SecureStore, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) feeds `createCredentialVault` and `createStationPasswordStore`; `:281-301` `setActiveStation(ref, credentials?)`; `:303-312` `removeRecent` → `credentialVault.remove(base); stationPasswords.remove(base)`.
- E68 `src/lib/station-password.ts:402-435` — `createStationPasswordStore(storage)`: JSON map base→string under one SecureStore key; the per-station secure-map pattern to copy.
- E69 `src/player/CoverArt.tsx:37-38,42-43,128` `<Image source={{ uri }}`; `src/player/drawers/ScheduleDrawer.tsx:215-216` `source={{ uri: api.avatar(…) }}` — the only artwork loads; no headers today.
- E70 `node_modules/expo-image/src/Image.types.ts:23-26` — `headers?: Record<string, string>` on the image source; `expo-image/ios/ImageSource.swift:19` `var headers` — the dep already carries headers on both platforms.
- E71 `src/hooks/useLiveActivity.ts:57-58` — `const artworkHeaders = useMemo(() => api?.streamHeaders() ?? {}, [api])`; `modules/live-activity/index.ts:28-29` `artworkHeaders?: Record<string,string>` — Live Activity artwork inherits whatever `streamHeaders()` returns.
- E72 `src/hooks/useCast.ts:45` — `const castable = !!api && !api.streamHeaders();` — cast gate keys on `streamHeaders()`.
- E73 `src/app/onboarding.tsx:227-228` — `const api = createApi(candidate, activeCredentials)` (probe); `:349-357` `submitEntry` builds `enteredCredentials`; `:323-330` `tuneIn` → `selectStation({url, name}, target.credentials)`; `:446-470` the collapsible **Station login** fields.
- E74 RNTP 4.1.2: `android/src/main/java/com/doublesymmetry/trackplayer/model/Track.kt:21,51-55` `headers` → `AudioItemOptions(headers, …)`; `ios/RNTrackPlayer/Models/Track.swift:128-129` `options["AVURLAssetHTTPHeaderFieldsKey"] = headers`; `android/build.gradle:53` `com.github.doublesymmetry:kotlinaudio:v2.1.0` (Maven, source not on disk); `react-native-track-player.podspec:21` `SwiftAudioEx 1.1.0` (not on disk).
- E75 `node_modules/react-native/Libraries/Network/RCTHTTPRequestHandler.mm:103` — `_session = [NSURLSession sessionWithConfiguration:configuration delegate:self …]`; `:131-194` implements only progress / response / data / complete — **no `didReceiveChallenge`**, so RN fetch on iOS falls to NSURLSession default handling.
- E76 `node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/OkHttpClientProvider.kt:28` — `public fun setOkHttpClientFactory(factory: OkHttpClientFactory?)`; `:33` `getOkHttpClient()`; `node_modules/expo-image/android/src/main/java/expo/modules/image/okhttp/ExpoImageOkHttpClientGlideModule.kt:11` `import com.facebook.react.modules.network.OkHttpClientProvider` — fetch and expo-image share one OkHttp client on Android.
- E77 `node_modules/expo-modules-core/android/src/main/java/expo/modules/core/interfaces/ApplicationLifecycleListener.java:7` — `default void onCreate(Application application) {}`; `Package.java:18` `createApplicationLifecycleListeners(Context)` — a local Expo module can run code before RN builds its OkHttp client.
- E78 `node_modules/react-native/React/Base/RCTURLRequestHandler.h:44-50` — `handlerPriority` picks between handlers that both `canHandleRequest:` — fallback hook for a challenge-aware fetch handler on iOS.
- E79 `src/app/_layout.tsx:76-78` — `<Stack.Screen name="stations" options={{ presentation: 'modal' }} />` — route registration pattern.
- E80 `docs/plans/app-edit-station-login.md:73-79` — adds `saveLogin`/`forgetStationPasswordFor` to `StationContext` and a `src/app/station-login.tsx` screen on branch `feat/app-station-login`, not merged.
- E81 `app/docs/QA-CHECKLIST.md:1-18` — manual device checklist is the merge gate for native behaviour ("no automated test framework").
- E82 `DEPLOY.md:151-157` — "### Make the station private (Cloudflare Access)"; `docs/reverse-proxy.md:297-341` — Cloudflare Tunnel section ends with E45.
- E83 `app/scripts/station-credentials.test.ts:15-23` — `memoryStore()` fake for SecureStore; `station-password.test.ts` same shape.
- E84 `docs/private-station.md:65-70` — pure-URL clients (VLC, Sonos, hardware) get a credentialed or `?auth=` URL — these can never do headers or mTLS.

## Goals / Non-Goals
**Goals:**
- Headers per station on every app request (E64, E65, E69, E71, E74).
- Client identity per station on every app connection, Android and iOS.
- Cast hidden for either (E72).
- Docs: one truthful story for Cloudflare Access / mTLS, proxy recipes, what stays open.

**Non-Goals:**
- Server/proxy code: TLS ends at the edge (E33); nothing for the controller to verify. Reopen when a proxy forwards client-cert identity headers that the controller should read.
- Web player code: same-origin (E2, E23), the browser picks the certificate. Reopen if the manual check in tasks 3.3 shows the `<audio>` element not reusing the certificate.
- Pure-URL clients (Home Assistant, Music Assistant, Sonos, E6, E84): docs only. Reopen never — they cannot present credentials beyond a URL.
- Cast with headers/certs: impossible by design (E7, E8). Reopen never.
- Detecting an identity-proxy login page in the station probe (302→HTML 200 looks healthy). Reopen when a listener reports "check passed, nothing plays" on an Access station.
- An iOS loopback proxy for AVPlayer mTLS. Reopen only if Open Question 1 answers "no".
- Importing `.p12` on Android (system install covers it, matches "install it on their phone"). Reopen when an Android build < API 24 or a work profile blocks `KeyChain`.
- Header/cert editing on an already-saved station. Lives in the station-login screen (E80); until that merges, re-adding the station is the edit path.

## Decisions
- **Headers are a 4th `createApi` argument, merged into one `extraHeaders` map used by `fetchWithTimeout`, `streamHeaders()` and a new `imageHeaders()`** — one choke point (E64, E65); `streamHeaders()` returning the merged map makes Live Activity (E71) and the Cast gate (E72) correct with zero edits. Alternative "per-call plumbing" lost: more edits, same behaviour.
- **Storage: a generic `createSecureMap<T>(storage, key, isValid)` in a new `src/lib/station-headers.ts`, key `subwave.stationHeaders.v1`** — same shape as E68, third copy avoided; existing vault/password stores are NOT refactored onto it (keeps slice 1 diff small; reopen on the next store). Values are `Record<string,string>`; SecureStore's per-value limit (~2 KB on iOS) is enough for service-token pairs.
- **UI: one multiline "Extra request headers" field under the onboarding Station login section (E73:446-470), parsed by a pure `parseHeaderLines()`** — no second screen, sits beside the login fields; `feat/app-station-login` (E80) can lift the same field into its screen. Invalid token names (`/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/` per RFC 9110) and `Authorization`/`Host` are rejected (keeps Basic login and URL as the only route for those).
- **Probe sends headers** — `createApi(candidate, activeCredentials, undefined, headers)` at E73:227; `stationProbeCandidates(raw, authenticated)` gets `authenticated = !!creds || hasHeaders` so a header-gated bare host never probes cleartext (E21).
- **Client identity, Android: system `KeyChain`** — `KeyChain.choosePrivateKeyAlias(activity, cb, null, null, host, -1, null)` returns an alias; a local Expo module `modules/client-cert/` installs, in `ApplicationLifecycleListener.onCreate` (E77), (a) `OkHttpClientProvider.setOkHttpClientFactory` (E76) with `sslSocketFactory(ctx.socketFactory, trustManager)` where the `X509KeyManager` resolves host→alias from a map JS fills, lazily `KeyChain.getPrivateKey`/`getCertificateChain`; and (b) `HttpsURLConnection.setDefaultSSLSocketFactory(same)` so ExoPlayer's `DefaultHttpDataSource` (HttpURLConnection) presents it too. Trust manager = platform default, so `withAndroidUserCaTrust` (E30) still applies. Alternative "app-side `.p12` parse into AndroidKeyStore" lost: more code, and the requester explicitly wants "install it on their phone".
- **Client identity, iOS: `.p12` import into the app keychain** — iOS apps cannot read profile-installed identities (Apple keychain isolation; unverified by doc fetch, see Unverified). The Swift side of the same module presents `UIDocumentPickerViewController` for `com.rsa.pkcs-12` (no new npm dep), `SecPKCS12Import` with the passphrase, `SecItemAdd` the identity with label `subwave.clientCert.<host>`, and registers `URLCredential(identity:certificates:persistence:.permanent)` as the **default credential in `URLCredentialStorage.shared`** for the protection space `(host, 443, https, NSURLAuthenticationMethodClientCertificate)`. Rationale: RN's handler has no challenge delegate (E75), expo-image and `URLSession.shared` (E9) likewise; default-credential storage is the only single hook that reaches all of them plus AVPlayer without patching RN. If AVPlayer ignores it (Open Question 1) the fallback for fetch is a higher-priority `RCTURLRequestHandler` (E78) and the stream stays a Non-Goal.
- **JS keeps only `{ base → { alias | label } }` in `subwave.stationClientCerts.v1` (same `createSecureMap`)**; on launch and on station switch JS calls `ClientCert.activate(host, ref)`; `clear(base)` on forget (E67:303-312) also `SecItemDelete`s on iOS. Cast gate: `streamHeaders()` is unchanged, so `useCast` gets a second term `!api.clientCert` (E72).
- **Dev-build check, not unit tests, for native** (E59, E81): a scripted QA-CHECKLIST section against a local Caddy with `client_auth` (`docker/Caddyfile` recipe in the docs task) is the proof for every native scenario.
- **Docs**: E28 note becomes "service-token headers: supported in the app via Extra request headers; SSO cookies: not"; E29 bullet stays true once slice 1 lands; new `docs/reverse-proxy.md` "## Requiring client certificates" after E82's tunnel section; `app/CLAUDE.md` station paragraph gains one sentence each. Public text uses `your-station.example`.

## Risks / Trade-offs
- iOS AVPlayer may not consult `URLCredentialStorage` for client-cert challenges → stream silent on iOS while API works. Mitigation: task 2.1 is a spike on a dev build before any iOS code lands; the spec scenario "API, stream and artwork use the identity" is the gate.
- KotlinAudio 2.1.0's HTTP data source is unverified (E74); if it is OkHttp with its own client, `setDefaultSSLSocketFactory` will not reach it → Android stream fails. Mitigation: same spike, Android half.
- `OkHttpClientProvider.setOkHttpClientFactory` must run before the first `getOkHttpClient()` — Expo's `onCreate` listener (E77) runs in `MainApplication.onCreate`, early enough; verified only by the spike.
- SecureStore write failures: copy the existing "could not save securely, station not added" path (E73:338-340).
- Merge order with `feat/app-station-login` (E80): both add context methods and a login UI. Land slice 1 first (smaller); rebase E80's branch to lift the headers field into its screen.
- A service-token secret stored on many phones is a shared secret; docs say so (as for the Basic login today, `docs/private-station.md:113-116`).

## Open Questions
1. Does iOS AVPlayer (via SwiftAudioEx `AVURLAsset`) answer an `NSURLAuthenticationMethodClientCertificate` challenge from a default credential in `URLCredentialStorage.shared`? If no, slice 2 ships Android-only and iOS gets API/artwork only or a loopback proxy (Non-Goal).
2. Does KotlinAudio 2.1.0 build its media `DataSource` on `DefaultHttpDataSource` (HttpURLConnection, honours `HttpsURLConnection.setDefaultSSLSocketFactory`) or on `OkHttpDataSource` with its own client? If OkHttp, the module must also hand KotlinAudio a client — likely a patch-package change to RNTP (E53 already runs patch-package).
3. Cloudflare Access with a service-token policy: does it answer a header-less `/api/health` with 403 or a 302 to the login page? Decides whether the probe copy in `describeFail` (E73) needs a new branch for "identity proxy in front" or the existing 401/403 wording suffices.
