# Map Kinds, Donation, and Transferable Maps — Plan

## Goal

Three kinds of map instead of one, and a way for a map to become an object in the
world that can be found and carried.

| Kind | Who owns it | What can be done to it |
| --- | --- | --- |
| **Player map** | one Actor | recorded, annotated, edited, reset, deleted by that Actor's owners. **Private unless shared.** |
| **Party map** | the party | **donated to** by any member; annotated and edited by any member. Not recorded into. One per scene. |
| **Official map** | nobody — it is an artifact | **annotations only.** Nothing already on it can be removed or changed. |

The party map is *the merge of the parts people chose to donate*, not an
automatic union. A player may keep their own map to themselves for their own
reasons; contributing is their decision and is never implied by exploring.

## Current Model, and What Has To Change

A map's identity **is** an Actor today. `_recordId(actorId, sceneId)` produces
`actorId::sceneId`, permissions run through `_canManageActor`, the persistence
path is `flags.<module>.mapping.maps.<actorId>`, and the list groups by Actor.
Every other feature here waits on that assumption being widened.

### The record gains a kind

```js
kind: 'player' | 'party' | 'official'   // absent means 'player'
```

Read as `'player'` when missing, so **no migration is needed** and an older
record stays exactly what it was.

The storage key follows from the kind:

| kind | key under `…mapping.maps` |
| --- | --- |
| `player` | `<actorId>` — unchanged |
| `party` | the literal `party` |
| `official` | `official:<randomId>` — several per scene are allowed |

A literal `party` cannot collide with an Actor key: Foundry ids are 16-character
random alphanumerics.

### Why not key the party map on the party's name

`blacksmith.api.campaign.getParty()` returns a `name`, but it comes from the
`defaultPartyName` **world setting** and falls back to `'Adventurers'`. It is a
display string a GM may change at any time, so keying storage on it would orphan
every party map on a rename. Key on the literal, show the name.

### Permissions become per-kind and per-operation

One `canManageRecord` is no longer enough. `official` allows adding but not
removing, which is a distinction the current code does not draw anywhere.

| Operation | Player (own) | Player (other's) | Party | Official |
| --- | --- | --- | --- | --- |
| See it in the list | yes | only if shared | party members | yes |
| Record into | yes | no | **no** | no |
| Add symbol / note | yes | no | yes | **yes** |
| Remove or edit an entry | yes | no | yes | **own additions only** |
| Floor surfaces, Fix Things | yes | no | yes | no |
| Rename | yes | no | party members | GM |
| Reset / delete | yes | no | GM | GM |
| Donate to the party map | yes | no | — | — |

"Own additions" is decidable from data already stored: every symbol carries
`createdBy`. Anything that arrived with the map, or that another player added,
is not removable — a typo of one's own still is.

Party membership comes from `getParty().members` (Actor ids). It is
GM-configured via `defaultPartySize` and `partyMember1..N` and **may be unset**,
which would silently make a party map GM-only. Fallback: any user who owns at
least one character Actor.

## Privacy: What "Private" Can Honestly Mean

Records live in a Scene flag, and Foundry ships Scene flags to every client.
`getMapList()` applies no visibility filter at all today, so every player can
already read every other player's map.

Three ways to change that:

- **A — a `shared` flag and a list filter.** Cheap. Honest label: *hidden*, not
  *private* — the bytes still reach the client and a player who opens a console
  can read them.
- **B — player maps move onto the Actor document.** Foundry ownership does the
  enforcing. Real, *provided* the world does not grant players OBSERVER on each
  other's characters, which many worlds do. Costs a rewrite of
  `_persistMapRecord`, `_writeSceneContainer`, `_indexScene`,
  `_handleRegistryUpdated`, and the index build.
- **C — a document per player map with explicit ownership.** Airtight, and the
  most work by a distance.

**Recommendation: A.** The module already tells us why, in
`_processRevealRequest`: *"the layout was never secret anyway -- Foundry ships
every wall to every client, which is how client-side vision works."* A player
willing to open a console already has the entire dungeon. Spending a storage
refactor so they cannot also see a teammate's pencil map buys close to nothing.

The `shared` flag is meaningful under all three, so choosing A now does not
foreclose B later.

## Donation

Donating merges a player map into the scene's party map. Repeatable — explore
more, donate again.

**Additive only. A donation can never take anything away.** Union `explored`,
`secrets` and `hidden`-respecting floor; keep the party map's own `sides` where
it already has them (first-write-wins, which is already the reveal's rule);
fill `floors` only where unset; add symbols only on squares that are free.

This falls out of rules the code already holds. `_persistMapRecord` explains the
same principle from the storage side: a merge cannot take anything away, which
is exactly the guarantee wanted here and the reason donation needs no conflict
UI.

Consequences worth stating plainly:

- There is no un-donating. Additive-only means the operation has no inverse.
- A donor's struck-off square does **not** strike it off for the party. Someone
  else may have walked it and donated it as floor, and their exploration is not
  the donor's to erase.
- Track `contributors: [actorId]` on the party map, so the list can say who a
  map was built by.

## Transferable Maps: Export as an Item

Not an image — an object that exists in the world, that can be found in a chest
and used when the party reaches the place it describes.

- **GM only.** A player-facing export invites item spam, and the party already
  has a shared list.
- **Item type `loot`** (dnd5e). Guard the create so a system without that type
  fails loudly rather than producing a broken Item.
- The record rides on `flags.<module>.map`, stripped of Actor identity and
  marked `kind: 'official'`.
- The Item's **description is generated** from the record: the scene, the area
  covered, the secret doors and hazards and stairs it marks, and the notes
  verbatim. Now that a note holds a paragraph rather than a label, this is the
  part that makes a found map worth reading.

### Filing a found map

Using the Item files the map into the holder's list **as its own record**, never
merged into their exploration.

This is the invariant the whole module rests on: a record holds only what is
genuinely the party's. A found map is not somewhere you have been — it is a
document you now possess, drawn by someone else. `TODO.md` already states the
same rule for converting a scene's walls: it "must be a GM authoring action that
produces an official map, never something that writes a party map."

Filing writes to **another scene's** flag — the map describes scene X while the
party stands in scene Y — and players cannot update Scene documents. Nothing new
is needed: every mutation already routes through the active GM via
`_processMutationRequest` and `socketManager.broadcast('mapping',
'mutation-request')`, so filing is one more action in that switch. The list
already handles maps belonging to other scenes.

## Order of Work

1. **`kind` on the record**, keyed storage, and the permission matrix. Nothing
   else can be built first, and on its own it changes no behaviour: every
   existing record reads as `player` and keeps its current permissions.
2. **The `shared` flag and the list filter.** Small, and independent of the rest.
3. **The party map** — declare one per scene, plus editing by any member.
4. **Donation.** Needs 3, and is where the merge rules above land.
5. **Export as an Item**, with the generated description.
6. **Filing a found map**, as a new mutation action.

Steps 1 and 2 are worth landing and playing with before 3 onward is designed in
detail: they are where the assumptions get tested.

## Open Questions

- Should a GM be able to record into the party map directly, as an authoring
  shortcut? The model says donations build it, but a GM seeding a map by walking
  a token is a plausible want.
- Does an official map show a party marker at all? It has no `lastPosition` of
  anyone's, and following is meaningless on a map nobody is recording.
- Should donating be offered per-scene from the player's map, or as one action
  that donates every scene's map at once?
