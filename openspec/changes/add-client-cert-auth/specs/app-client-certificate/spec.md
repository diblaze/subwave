## Purpose
A listener can attach a TLS client identity to a saved station so a proxy that requires client certificates (mTLS) admits every connection the app opens, with no account and no VPN.

## ADDED Requirements

### Requirement: A listener attaches a client identity to a station
The system SHALL let a listener attach one client identity per station: on Android by choosing a certificate already installed on the device, on iOS by importing a PKCS#12 file with its passphrase. The system SHALL store only a reference to the identity beside the station; the private key stays in the platform key store.

#### Scenario: Android picks a device-installed certificate
- **GIVEN** a certificate installed in the Android user credential store
- **WHEN** the listener chooses "Client certificate" for a station and selects it in the system picker
- **THEN** the station records that identity and the app can read its private key for that station's host

#### Scenario: iOS imports a certificate file with its passphrase
- **GIVEN** a `.p12` file reachable from the Files picker
- **WHEN** the listener chooses it for a station and enters the correct passphrase
- **THEN** the identity is imported into the app's keychain and the station records it

#### Scenario: Wrong passphrase is reported
- **GIVEN** a `.p12` file
- **WHEN** the listener enters a wrong passphrase
- **THEN** nothing is stored and the listener is told the passphrase was rejected and may retry

#### Scenario: Identity reference saved with the station
- **GIVEN** a listener attached an identity to a station
- **WHEN** the app relaunches
- **THEN** the station still has that identity and the stored station address contains no key material

### Requirement: The identity is presented on every connection to that station
The system SHALL present the station's client identity whenever the server requests one on any connection the app opens to that station: API calls, the audio stream, cover art and Live Activity artwork. A station without an identity SHALL connect exactly as before.

#### Scenario: API, stream and artwork use the identity
- **GIVEN** a station whose proxy requires a client certificate and a station record with a matching identity
- **WHEN** the listener tunes in
- **THEN** the station check passes, audio plays, cover art renders and the iOS Live Activity shows artwork

#### Scenario: Station without identity connects as before
- **GIVEN** a station with no identity attached
- **WHEN** the proxy requests a client certificate
- **THEN** the app presents none and reports the connection failure as it does today

### Requirement: A listener removes a client identity
The system SHALL remove a station's identity reference when the listener removes it or forgets the station; on iOS the imported identity SHALL also leave the app's keychain.

#### Scenario: Forgetting a station removes its identity
- **GIVEN** a station with an identity
- **WHEN** the listener forgets the station
- **THEN** no identity reference remains for that base address

#### Scenario: Listener removes identity, station stays
- **GIVEN** a station with an identity
- **WHEN** the listener removes the identity
- **THEN** the station remains saved and the next connection presents no identity

### Requirement: Google Cast is unavailable for a station with a client identity
The system SHALL hide the cast control for a station with a client identity, because the Cast receiver opens its own connection and cannot present it.

#### Scenario: Cast hidden for a station with a client certificate
- **GIVEN** a station with an identity and a Cast device on the network
- **WHEN** the player opens
- **THEN** no cast button is shown and playback stays local
