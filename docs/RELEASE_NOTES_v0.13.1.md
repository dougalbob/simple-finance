# Release notes — v0.13.1 (the till opens with nothing focused)

**Published:** _pending publish — this draft is stamped once the image is verified in the registry._
**Merge commit:** _pending publish_
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.13.1` · `latest` · `sha-<short>`
**Digest:** _pending publish — one digest for all three tags, different from v0.13.0's
`sha256:5264c114…084df0`._
**Version badge:** `v0.13.1 · pre-release`

## What changed

One behaviour change asked for by the household on 2026-09-25, straight after they Force Updated to
v0.13.0 and opened the home page on the real phone (decision 151).

**The till no longer grabs a field when it opens.** Until now the Quick Entry card focused **Supplier** as
soon as it was ready to listen. On a phone that raised the on-screen keyboard, the browser scrolled the
focused field above it, and the **Purchase / Fuel / Balance / Move** tab strip went off the top of the
screen with it — measured on the page before this change: the page jumped 1342px and the tab strip sat at
`y=-35`, entirely above the viewport, so a different mode was not one tap away.

In their words: _"It is not necessary for any control on the form to get focus when it opens — the user can
make that decision by tapping whatever control they want to change. Changing where the page scrolls to looks
much cleaner … and avoids the user missing the Purchase/Fuel/Balance/Move buttons."_

So the rule is now: **no field is focused as a side-effect of the till becoming ready, or of a type tab
becoming visible.** Concretely:

- The home page opens with **nothing focused**. The keyboard stays down and the page does not scroll
  itself — it opens at the top, where the household total and the payday projection are, and you scroll to
  the till when you want it.
- The card's first paint is unchanged: the type tabs, the pot, the payday shortfall warning and the
  free-to-spend figure are all there as soon as the page opens.
- **Fuel** and **Balance** no longer focus their amount as the tab appears, for the same reason.
- The rule is the same on a laptop as on a phone. Desktop has room, so autofocus cost it nothing there —
  but one rule is simpler to keep than a media query's worth of exceptions.

Everything that moves focus **while you are typing** is untouched, because each one answers something you
did:

| What you do | Where focus goes |
|---|---|
| Tap a supplier suggestion | Amount |
| Press Enter/Go in Supplier | Amount |
| Press **Next: category →** (or Enter in Amount / the note) | Category on card 2 |
| Tap **+ Note** | The note field it just opened |
| Tap **Add another** after saving | Supplier, back on card 1 |

Enter/Go still never saves from card 1.

## Schema and data

**No schema changes and no database migrations.** v0.13.1 is a focus-behaviour change only. Existing
databases, settings and backups from v0.13.0 (or earlier) work without any migration or modification.

## Version badge

The app identifies as **v0.13.1 · pre-release**. The badge in the navigation and on the home page reads
`v0.13.1 · pre-release` after updating.

## How to update (Unraid)

1. **Back up first**: Settings → _Backup and restore_ → take a backup, and keep the downloaded archive
   somewhere other than the array.
2. In Unraid, open the Simple Finance container and click **Force Update** on the Docker tab (the `latest`
   tag points at v0.13.1).
3. Verify the version badge reads **v0.13.1 · pre-release**.
4. Open the home page **on the phone** and confirm: the page does not scroll by itself, the keyboard stays
   down, and the Purchase / Fuel / Balance / Move tabs are on screen when you scroll to the till. Then tap
   **Balance** and check that nothing is focused until you tap a field.

Release notes: [`docs/RELEASE_NOTES_v0.13.1.md`](RELEASE_NOTES_v0.13.1.md)
