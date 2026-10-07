# NextWheel changelog

## v0.0.15
- The root manager's module list shows NextWheel's status and its protections: whether
  it is working (or why not: crashed, Zygisk stopped, NextZygisk not found, paused,
  disabled), and how many protections are active and inactive, for example
  "✅ Working | 🛡️ 9 active, 0 inactive (9/9)". It refreshes every 30 seconds and right
  after a change in the WebUI.

## v0.0.14
- Updates from the root manager: module.prop has an updateJson link to this repository,
  and each release updates update.json, so the next versions show up as updates
  automatically.

## v0.0.13
- Fixed: the module banner did not show in the root manager. The installer now extracts
  banner.png, and module.prop points to it relative to the module folder (banner=banner.png).

## v0.0.12
First NextWheel release, based on Treat Wheel 0.0.11 by ThePedroo.

**NextZygisk support**
- The installer accepts NextZygisk as the Zygisk provider (it was rejected by the ReZygisk
  version check). ReZygisk 508 or higher still works.
- The dashboard shows when Zygisk stops or NextZygisk skips the root unmount, instead of
  showing "Working" from an old status file.
- Shows NextSUSFS when it is installed.

**Fixes**
- No more false "Crashed while hiding": the crash check now tells a slow process from one
  that died, and a data race in the companion is fixed.
- The companion always answers when a mount line can't be read.
- Turning a protection off no longer turns the status yellow; only real problems do.

**WebUI**
- Redesigned live dashboard and actions page, refreshed every few seconds.
- All nine protections on by default.
- Arabic translation with right-to-left layout; 11 languages in total.
- Sora and Noto Kufi Arabic fonts, bundled so the WebUI works offline.
- Fits phones and tablets, with a compact floating navbar.
- Module banner in the root manager.

**Performance**
- Optimized release builds, cached state and font scans in the companion, mmapped ELF
  images and faster string helpers.

**Rebrand**
- Shown as NextWheel everywhere, with ifoknr credited next to the Treat Wheel developers.
  The module id stays `treat_wheel`, so it installs over Treat Wheel and keeps its settings.
