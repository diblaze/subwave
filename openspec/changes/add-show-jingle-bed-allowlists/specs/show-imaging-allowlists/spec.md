## Purpose
Lets each show restrict the station's automatic jingles and instrumental beds to a list picked from the existing library. An empty list keeps today's behaviour: everything is allowed.

## ADDED Requirements

### Requirement: Show stores jingle and bed allowlists
The system SHALL store, on each show, a list of allowed jingles and a list of allowed beds. Each list defaults to empty and is kept through editor save, restart and backup restore.

#### Scenario: Older show loads with empty allowlists
- **GIVEN** a saved show with no jingle or bed list
- **WHEN** the station loads its settings
- **THEN** the show has an empty jingle list and an empty bed list

#### Scenario: Allowlists survive a cold load
- **GIVEN** the lunch show is saved with one allowed jingle and one allowed bed
- **WHEN** the controller restarts and reloads settings from disk
- **THEN** the lunch show still lists that jingle and that bed

#### Scenario: Allowlists survive backup restore
- **GIVEN** a backup taken while the lunch show lists one jingle and one bed
- **WHEN** the operator restores that backup
- **THEN** the restored lunch show lists the same jingle and bed

#### Scenario: Over-long allowlist is refused on save
- **GIVEN** an operator submits a show whose jingle list is longer than the per-show cap
- **WHEN** the show is saved
- **THEN** the save is refused with an error naming the list, and the stored show is unchanged

#### Scenario: Malformed stored entries are dropped on load
- **GIVEN** a hand-edited settings file whose show lists a number and a blank string among its allowed beds
- **WHEN** the station loads its settings
- **THEN** the show keeps its valid bed names, drops the malformed entries and is not deleted

### Requirement: Allowlists stay admin-only
The system SHALL keep a show's jingle and bed lists out of every public, unauthenticated read.

#### Scenario: Public schedule omits allowlists
- **GIVEN** the lunch show lists allowed jingles and beds
- **WHEN** a listener reads the public schedule
- **THEN** the show entry carries neither list

### Requirement: Automatic jingles honour the on-air show's list
The system SHALL draw automatic jingles (the controller-counted rotate and the over-music ID) only from the on-air show's allowed jingles when that list is non-empty, and from every jingle when the list is empty or no show is on air. If none of the listed jingles exists in the library, the draw is skipped.

#### Scenario: Empty jingle list allows every jingle
- **GIVEN** the on-air show has an empty jingle list and the library holds three jingles
- **WHEN** an automatic jingle is drawn
- **THEN** all three jingles are candidates

#### Scenario: No show on air allows every jingle
- **GIVEN** no show is on air and the library holds three jingles
- **WHEN** an automatic jingle is drawn
- **THEN** all three jingles are candidates

#### Scenario: Rotate draws only listed jingles
- **GIVEN** the controller counts the rotate and the on-air show lists only jingle A out of A, B and C
- **WHEN** the rotate comes due
- **THEN** jingle A is handed to the mixer and B and C are never drawn

#### Scenario: Over-music ID draws only listed jingles
- **GIVEN** placement is over-music and the on-air show lists only jingle A out of A and B
- **WHEN** the over-music ID is offered at a song's opening
- **THEN** only jingle A can air over the song

#### Scenario: Rotate skips when no listed jingle exists
- **GIVEN** the on-air show lists only a jingle that has since been deleted
- **WHEN** the rotate comes due
- **THEN** no jingle airs, the offer is spent and the booth log says the show allows none of the jingles in the library

### Requirement: Operator jingle press ignores show lists
The system SHALL play an operator-pressed jingle regardless of the on-air show's jingle list.

#### Scenario: Operator press plays an unlisted jingle
- **GIVEN** the on-air show lists only jingle A
- **WHEN** the operator presses play on jingle B
- **THEN** jingle B is queued for the next safe boundary

### Requirement: Beds honour the on-air show's list
The system SHALL choose a link or request bed only from the on-air show's allowed beds when that list is non-empty, and from every bed when it is empty or no show is on air. If no allowed bed is long enough, or none exists, the link airs without a bed.

#### Scenario: Empty bed list allows every bed
- **GIVEN** beds are enabled, the on-air show has an empty bed list and two beds are long enough
- **WHEN** a link needs a bed
- **THEN** either bed may be chosen

#### Scenario: Link beds only on a listed bed
- **GIVEN** beds are enabled and the on-air show lists only bed X out of X and Y, both long enough
- **WHEN** a link needs a bed
- **THEN** bed X is pushed and bed Y never is

#### Scenario: No listed bed fits so the link airs without a bed
- **GIVEN** the on-air show lists only a bed that is too short or has been deleted, and another bed would fit
- **WHEN** a link needs a bed
- **THEN** no bed is pushed, the link talks over the track and the booth log names the show's list as the reason

### Requirement: Mixer-counted rotate warns that jingle lists are ignored
The system SHALL warn the operator, in the doctor and in the show editor, when the mixer counts the jingle rotate while a show has a non-empty jingle list.

#### Scenario: Doctor warns when the mixer counts and a show lists jingles
- **GIVEN** the mixer counts the rotate and the lunch show lists one jingle
- **WHEN** the operator runs the doctor
- **THEN** a warning says show jingle lists apply only when the controller counts, and how to switch

#### Scenario: Doctor is quiet when the controller counts
- **GIVEN** the controller counts the rotate and the lunch show lists one jingle
- **WHEN** the operator runs the doctor
- **THEN** no show-jingle warning is reported

#### Scenario: Editor warns that the mixer ignores the jingle list
- **GIVEN** the mixer counts the rotate
- **WHEN** the operator picks a jingle for a show in the editor
- **THEN** the editor shows a notice that the mixer's rotate ignores this list

### Requirement: Show editor picks allowlists from the library
The system SHALL let the operator pick a show's allowed jingles and beds from the station's current library in the show editor. Listed entries that no longer exist stay visible, marked deleted, and can be removed.

#### Scenario: Editor offers the station's jingles and beds
- **GIVEN** the library holds two jingles and two beds
- **WHEN** the operator opens a show's Imaging section
- **THEN** both jingles and both beds are offered as checkboxes, none checked for a show with empty lists

#### Scenario: Deleted entry stays visible and removable
- **GIVEN** the show lists a bed that was deleted from the library
- **WHEN** the operator opens the editor
- **THEN** the bed is shown checked and marked "(deleted)", and unchecking it removes it from the list

#### Scenario: Editor save keeps the lists
- **GIVEN** a loaded show with one allowed jingle and one allowed bed
- **WHEN** the editor hydrates the show and builds its save payload
- **THEN** the payload carries the same jingle and bed lists

### Requirement: Operator sees why a show's list is skipped
The system SHALL tell the operator, in the show editor and in the doctor, when a show's non-empty jingle or bed list matches nothing in the library, naming the show and saying that its jingle slots or beds are skipped.

#### Scenario: Editor explains skipped jingle slots when no listed jingle exists
- **GIVEN** the lunch show lists only jingles that were deleted from the library, and the library has loaded
- **WHEN** the operator opens the show's Imaging section
- **THEN** a notice under the jingle picker says this show's automatic jingle slots are skipped because none of its listed jingles exist

#### Scenario: Editor explains skipped beds when no listed bed exists
- **GIVEN** the lunch show lists only beds that were deleted from the library, and the library has loaded
- **WHEN** the operator opens the show's Imaging section
- **THEN** a notice under the bed picker says this show's links air without a bed because none of its listed beds exist

#### Scenario: Editor makes no claim while the library is unavailable
- **GIVEN** the jingle or bed library is still loading or failed to load
- **WHEN** the operator opens the show's Imaging section
- **THEN** no entry is marked deleted and no skip notice is shown

#### Scenario: Doctor names a show whose jingle list matches nothing
- **GIVEN** the lunch show lists only a deleted jingle
- **WHEN** the operator runs the doctor
- **THEN** a warning names the lunch show and says its automatic jingle slots are skipped because none of its listed jingles exist

#### Scenario: Doctor names a show whose bed list matches nothing
- **GIVEN** the lunch show lists only a deleted bed
- **WHEN** the operator runs the doctor
- **THEN** a warning names the lunch show and says its links air without a bed because none of its listed beds exist

#### Scenario: Doctor is quiet when every list matches something
- **GIVEN** every show's non-empty jingle and bed list names at least one existing entry
- **WHEN** the operator runs the doctor
- **THEN** no skipped-list warning is reported
