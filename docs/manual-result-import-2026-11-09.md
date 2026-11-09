# Manual result import — 7/8 November 2026 scrims

Source: `ArewaVanta_CODM_6_Games_Entry_Data_Updated.csv` (362 rows, six games).

## Slots

The CSV `TEAM` number is the event slot.

- Added **slot 17** for **DARK EMPIRE · Squad 3**.
- Added **slot 25** for **Northern Elites · Squad 3**. This is the only place YAMIN appeared (TEAM25); rename or replace this squad if TEAM25 was a mixed/solo entry rather than an NE third squad.
- Added both slots to the series default slot map and to the already-generated week of 14 November. Future weeks inherit 1–25 (slot 24 remains reserved).

## Games saved

1. Day 1 Game 1 — 18 teams, 66 player rows
2. Day 1 Game 2 — 15 teams, 58 player rows
3. Day 1 Game 3 — 19 teams, 68 player rows
4. Day 2 Game 1 — 15 teams, 48 player rows
5. Day 2 Game 2 — 18 teams, 59 player rows
6. Day 2 Game 3 — 17 teams, 60 player rows

All team totals are stored from the CSV. Where the visible names do not add up to the printed team total, the team total is retained and the player rows remain partial.

## Profiles merged

- A4 ABDOOL: inactive duplicate → active
- A4 Abati: inactive duplicate → active
- A4 SHEHI: two inactive duplicates → active
- NF Konami: inactive `Konami` → active `NF-Konami`
- AK ice wolf: inactive → active `Ice°wolf`
- AIG Gwaskaa: import-created `Gwakkø` → `Gwàskàa`
- 4X Ameer520: import-created `Ammar520` → `Ameer520`
- 4X badkiller: import-created `luckkiller` → `badkiller`
- AK MDKILLER: import-created `MOKILLER` → `MDKILLER`
- NF Yaron Gombe: inactive duplicate → active
- NF captainzero: inactive duplicate → active
- DRK `ZERO` renamed to `ZORO` with `ZERO` kept as an alias.

## New profiles

NE: VxnMOHA, GeST. A4: GOGA, LEGEND. AIG: UMAR, jailbreak. B: MHD.rnx. DRK: HOLY_SK, Kankarax, Sorix, Rashid. 4X: MURRYY, shi_piey, 8teen, agbako°beams+. Prime: Moses, REDJOHN. NF: MUHD---SKT, Sadick, Benzkid. Unclanned: CHIOMA (alias `NLU · CHIOMA`), GODFATHER.

## Aliases and tags

- Stored CSV spellings as aliases, for example `F4IS4L<3`, `SAYYID`, `BSM.drk`, `BUNZASKI`, `Gr8tness`, `4X.CPTN SMN`, `Kankarax-DRK`.
- Added short tag variants to clans: `NF`/`NF-`, `A4`, `AK`, `AIG`, `B`, `4X`, `P`, `DRK`.
- Removed glued clan prefixes from stored player names. The clan tag is now displayed once by the UI.

## Intentionally left separate

These are similar names but have different clan histories, so they were not merged automatically:

- A4 `ABDOOL` / A4 `APDOUL` (both have results)
- A4 `Death` / Prime `DÉATH`
- NE `SAYYID玄` / VC `Sayyid` (`Sayyid` has no results)
- AK `FULANI` / NF `Fulani`
- AK `Voidメ` / DRK `VOID` (`Voidメ` has no results)

## Incomplete data left unattributed

- Game 3, slot 4: `NF [stylized username]`, 3 kills added to the team total only.
- Game 6, slot 4: `NF [stylized username]`, 1 kill added to the team total only.
- Game 3, slot 8: 5 team kills with no readable player names.
- Game 3, slot 18: printed 23 kills, 18 attributed.
- Game 3, slot 20: printed 24 kills, 22 attributed.
