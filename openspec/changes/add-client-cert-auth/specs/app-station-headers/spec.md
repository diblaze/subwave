## Purpose
A listener can attach custom HTTP request headers to a saved station so an identity proxy that accepts a service token (header pair) admits the app without an interactive login.

## ADDED Requirements

### Requirement: Per-station request headers are kept in secure storage
The system SHALL keep custom request headers per station in the device's secure storage, apart from the station address, and SHALL discard them when the station is forgotten.

#### Scenario: Headers saved with a station
- **GIVEN** a listener adds a station and enters one or more `Name: value` header lines
- **WHEN** the station is saved
- **THEN** the headers are retrievable for that station's base address and the stored station address contains no header data

#### Scenario: Headers removed when station forgotten
- **GIVEN** a station with saved headers
- **WHEN** the listener forgets the station
- **THEN** no headers remain for that base address

#### Scenario: Malformed header line rejected
- **GIVEN** a listener enters a line without a `Name: value` shape or with a name that is not a valid header token
- **WHEN** the station check is started
- **THEN** the check does not run and the listener is told which line is wrong

### Requirement: Saved headers ride every request to that station
The system SHALL send a station's saved headers on every request the app makes to that station: API calls, the audio stream, cover art and Live Activity artwork. A station without saved headers SHALL be requested exactly as before.

#### Scenario: API request carries saved headers
- **GIVEN** a station with saved headers
- **WHEN** the app calls any station API endpoint
- **THEN** the request carries every saved header, alongside any Basic login the station also has

#### Scenario: Stream and artwork carry saved headers
- **GIVEN** a station with saved headers
- **WHEN** the app loads the stream, a cover, a persona avatar or Live Activity artwork
- **THEN** each request carries every saved header

#### Scenario: Station without headers sends none
- **GIVEN** a station with no saved headers
- **WHEN** the app makes any request to it
- **THEN** no custom header is added and the stream carries no headers unless a Basic login is saved

### Requirement: The station check uses the saved headers
The system SHALL send the entered headers during the add-station check so a station behind a header-gated proxy passes the check.

#### Scenario: Probe passes with headers
- **GIVEN** a station whose proxy admits requests only with a given header pair
- **WHEN** the listener enters that pair and runs the station check
- **THEN** the check reaches the controller and the station can be tuned in

### Requirement: Google Cast is unavailable for a station with headers
The system SHALL hide the cast control for a station with saved headers, because the Cast receiver fetches the stream itself and cannot send them.

#### Scenario: Cast hidden for a station with headers
- **GIVEN** a station with saved headers and a Cast device on the network
- **WHEN** the player opens
- **THEN** no cast button is shown and playback stays local
