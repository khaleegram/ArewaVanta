# DeepSeek score import review — 9 November 2026

## Budget and workflow

The implementation keeps the configured DeepSeek Flash model. Each Read screenshots action makes one extraction request for the selected images. Cropping runs in the browser using canvas; there is no additional OCR service, paid retry loop, package dependency, or database migration.

Literal TEAM headers take priority over finishing order and legacy squad numbers. An explicit unassigned TEAM cannot silently take another clan slot. Team conflicts appear before player questions. Organizers can keep guests in their actual game slot without changing their permanent clan.

Strong, unique name matches in a known clan need fewer taps. Close alternatives, conflicting tags, new profiles and duplicate occurrences remain reviewable. A confusable NE/NF tag offers the slot clan's matching profile first and retains the other identity as an alternative; it does not silently select the wrong duplicate. Creating a new profile checks existing players first, and retried saves reuse an unambiguous cleaned name.

Partial saves retain known team kills while player identities are unresolved. Unknown kill values stay unknown. The mobile save bar has one primary action and secondary actions under More.

## Real extraction check

Compared one live DeepSeek response against the manually transcribed board from three original Android Gallery screenshots supplied for the reviewed Week 2 game.

| Measure | Latest observed result |
| --- | --- |
| TEAM numbers paired with finishing placements | 15 / 15 correct |
| Visible player kill values | 59 / 59 correct |
| Sum of visible kills | 246, matching the screenshots |
| Extraction request duration | 13.2 seconds |
| Mobile save bar, 390px viewport | 87px, previously approximately 272px in the reviewed draft |

This is one successful sample, not a general accuracy guarantee. Stylized player names still contain transcription differences, and end-to-end profile identity accuracy and a two-minute human review time have not been established. The heavily compressed WhatsApp copies remained unreliable in comparison. Use original screenshots when available. Production scores and the user's saved draft were not changed by this check.

## Regression checks

- `ScreenshotImportTest` and `PlayerDuplicateMergeTest`: 14 tests passed, 131 assertions.
- `check:import`: desktop import, profile search/create, guest selection, remapping, draft apply, save payloads, cached review handling, and partial kill preservation passed.
- Mobile checks passed at 390×844 and 390×480, including horizontal overflow and save bar height.
- Synthetic crop checks retain final short card rows at both 540px and 1080px source widths and exclude the later gallery thumbnail strip.
- Production web build and PHP formatting passed. The build retains its existing bundle size warning.

The wider `MatchResultWorkflowTest` run is not green. It includes random squad factory values outside PostgreSQL's smallint range, a lookup for a retired scoring preset, outdated expectations that shared placements must be rejected, and an unassigned-slot fixture failure. Baseline checks against unchanged commit `36c8fbb` reproduced the factory overflow. With only temporary deterministic squad numbers in that baseline copy, they also reproduced the missing preset and shared-placement expectation failures. The working tree's legacy tests and factories were not changed to hide these failures.

Frontend and API changes are local and should be deployed together. No push or production data migration was performed.
