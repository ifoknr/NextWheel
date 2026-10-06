# NextWheel / NextZygisk: ideas for later

Saved on 2026-10-06 to revisit later. Ordered from most to least impact.

## Hiding

1. **Live conflict check.** The installer only refuses Zygisk Assistant and NoHello. Have the
   home page keep checking installed modules and warn about ones that conflict or leak
   (for example Sui, which TrustAttestor flagged), before a detection app finds them.
2. **Deal with the Sui leak.** TrustAttestor reported "Sui service chain anomaly". Research
   hiding Sui's service from regular apps, or at least show a clear warning and what to do.
   _Needs the device to confirm._
3. **Per-app hiding list.** Have the companion remember the last apps that went through
   hiding successfully and show them in the WebUI, to confirm a specific app (a banking app,
   say) was handled and to help diagnose.

## WebUI and robustness

4. **Event log page.** Recent events (hiding started, crash, Zygisk stopped) inside the
   WebUI, so diagnosing does not need logcat from a computer.
5. **Backup / restore settings.** Export and import the protections state, for re-flashing
   or moving to another device.
6. **Light theme and theme picker.** NextZygisk has a light theme; NextWheel is dark only.
   Add a light theme and a manual choice so both match.

## Deeper (need the device)

7. **Tune protection defaults.** Some protections are heavy or of little use on Android 14.
   Measure which matter on the device and adjust what is on by default.
8. **Faster app start.** Hiding adds a little time to each app launch. Measure where it goes
   (mountinfo copy, fonts) and optimize it.
