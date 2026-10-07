#!/system/bin/sh
# INFO: Writes NextWheel's status and how many protections are on or off into the
#         module.prop description, so the root manager's module list shows them
#         without opening the WebUI. Rewrites the file only when the text changes.
MODDIR="${0%/*}"
DATA=/data/adb/treat_wheel
PROP="$MODDIR/module.prop"
ABOUT="A Treat Wheel fork made for NextZygisk."

FLAGS="disable_maps_hiding disable_zygote_mountinfo_leak_fixing disable_frida_traces_hiding
disable_custom_font_loading disable_module_loading_traces_hiding disable_gsi_hiding
disable_revanced_mounts_umount disable_denylist_logic_inversion disable_prop_spoofing"

total=0
off=0
for flag in $FLAGS; do
  total=$((total + 1))
  grep -q "^$flag=true" "$DATA/state" 2> /dev/null && off=$((off + 1))
done
on=$((total - off))

# INFO: NextZygisk (module id rezygisk) publishes its monitor state; 0 is tracing.
ZYGISK=/data/adb/modules/rezygisk
monitor=$(awk '/"monitor"/ { m = 1; next } m && /"state"/ { gsub(/[^0-9]/, ""); print; exit }' /data/adb/rezygisk/state.json 2> /dev/null)

if [ -f "$MODDIR/disable" ]; then
  status="⏸️ Disabled"
elif grep -q '^ignoring=true' "$DATA/state" 2> /dev/null; then
  status="⏸️ Paused"
elif [ ! -d "$ZYGISK" ] || [ -f "$ZYGISK/disable" ]; then
  status="❌ Not working: NextZygisk not found"
elif [ -n "$monitor" ] && [ "$monitor" != 0 ]; then
  status="❌ Not working: Zygisk stopped"
elif grep -q crashed "$DATA/status" 2> /dev/null; then
  status="❌ Not working: crashed"
else
  status="✅ Working"
fi

desc="$status | 🛡️ $on active, $off inactive ($on/$total) | $ABOUT"
grep -qxF "description=$desc" "$PROP" && exit 0
# INFO: awk, not sed: the text holds "|" and "&". cat keeps the file in place.
awk -v d="description=$desc" '/^description=/ { print d; next } { print }' "$PROP" > "$PROP.tmp" &&
  cat "$PROP.tmp" > "$PROP"
rm -f "$PROP.tmp"
