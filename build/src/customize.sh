# shellcheck disable=SC2034
SKIPUNZIP=1

VERSION=$(grep_prop version "${TMPDIR}/module.prop")
ui_print "- Installing Treat Wheel $VERSION"

if [ "$ARCH" != "arm" ] && [ "$ARCH" != "arm64" ] && [ "$ARCH" != "x86" ] && [ "$ARCH" != "x64" ]; then
  abort "! Unsupported platform: $ARCH"
else
  ui_print "- Device platform: $ARCH"
fi

# INFO: Zygisk Assistant and NoHello are not supported. If present, refuse to install
if [ -d "/data/adb/modules/zygisk_assistant" ] || [ -d "/data/adb/modules_update/zygisk_assistant" ]; then
  abort "! Zygisk Assistant is outdated and causes detections. Please uninstall it before installing Treat Wheel."
fi

if [ -d "/data/adb/modules/nohello" ] || [ -d "/data/adb/modules_update/nohello" ]; then
  abort "! NoHello is outdated and doesn't provide any benefits. Please uninstall it before installing Treat Wheel."
fi

REZYGISK_REQUIRED_VERSION=508

# INFO: Treat Wheel won't work in any other Zygisk anyway. Demand ReZygisk.
if [ -d "/data/adb/modules_update/rezygisk" ]; then
  REZYGISK_PATH="/data/adb/modules_update/rezygisk"
elif [ -d "/data/adb/modules/rezygisk" ]; then
  REZYGISK_PATH="/data/adb/modules/rezygisk"
else
  ui_print "- ReZygisk $REZYGISK_REQUIRED_VERSION or higher is required but not found."
  abort    "- No other Zygisk implementation is supported or works with Treat Wheel."
fi

REZYGISK_VERSION=$(grep_prop versionCode $REZYGISK_PATH/module.prop)
if [ -z "$REZYGISK_VERSION" ]; then
  abort "! Could not determine the installed ReZygisk's version."
fi

# INFO: NextZygisk keeps the "rezygisk" module id so it updates ReZygisk in place,
#         but it renumbers versionCode from a commit count instead of ReZygisk's
#         upstream scheme, so its versionCode is far below REZYGISK_REQUIRED_VERSION
#         even though it implements the same Zygisk API (v5) Treat Wheel needs.
#         Detect it by name/author and accept it instead of failing the numeric gate.
REZYGISK_NAME=$(grep_prop name   $REZYGISK_PATH/module.prop)
REZYGISK_AUTHOR=$(grep_prop author $REZYGISK_PATH/module.prop)

case "$REZYGISK_NAME $REZYGISK_AUTHOR" in
  *[Nn]ex[Tt][Zz]ygisk*)
    ui_print "- Detected NextZygisk ($REZYGISK_VERSION); using it as the Zygisk provider."
    ;;
  *)
    if [ "$REZYGISK_VERSION" -lt "$REZYGISK_REQUIRED_VERSION" ]; then
      ui_print "! The installed ReZygisk ($REZYGISK_VERSION) is too old."
      abort    "! Please update to version $REZYGISK_REQUIRED_VERSION or higher."
    fi
    ;;
esac

abort_verify() {
  ui_print "***********************************************************"
  ui_print "! $1"
  ui_print "! This zip is corrupted or incomplete"
  abort    "***********************************************************"
}

extract() {
  local zip="$1"
  local target="$2"
  local dir="$3"
  local junk_paths="${4:-false}"
  local opts="-o"
  local target_path

  [[ "$junk_paths" == true ]] && opts="-oj"

  if [[ "$target" == */ ]]; then
    target_path="$dir/$(basename "$target")"
    unzip $opts "$zip" "${target}*" -d "$dir" >&2
    [[ -d "$target_path" ]] || abort_verify "$target directory doesn't exist"
  else
    target_path="$dir/$(basename "$file")"
    unzip $opts "$zip" "$target" -d "$dir" >&2
    [[ -f "$target_path" || -d "$target_path" ]] || abort_verify "$target file doesn't exist"
  fi
}

ui_print "- Extracting module files"
extract "$ZIPFILE" 'module.prop'  "$MODPATH"
extract "$ZIPFILE" 'service.sh'   "$MODPATH"
extract "$ZIPFILE" 'uninstall.sh' "$MODPATH"
extract "$ZIPFILE" 'sepolicy.rule' "$MODPATH"

mkdir "$MODPATH/zygisk"
mkdir "$MODPATH/cmd"

# INFO: Utilize the one with the biggest output, as some devices with Tango have the full list
#         in ro.product.cpu.abilist but others only have a subset there, and the full list in
#         ro.system.product.cpu.abilist
CPU_ABIS_PROP1=$(getprop ro.system.product.cpu.abilist)
CPU_ABIS_PROP2=$(getprop ro.product.cpu.abilist)

if [ "${#CPU_ABIS_PROP2}" -gt "${#CPU_ABIS_PROP1}" ]; then
  CPU_ABIS=$CPU_ABIS_PROP2
else
  CPU_ABIS=$CPU_ABIS_PROP1
fi

SUPPORTS_32BIT=false
SUPPORTS_64BIT=false

if [[ "$CPU_ABIS" == *"x86"* && "$CPU_ABIS" != "x86_64" || "$CPU_ABIS" == *"armeabi"* ]]; then
  SUPPORTS_32BIT=true
  ui_print "- Device supports 32-bit"
fi

if [[ "$CPU_ABIS" == *"x86_64"* || "$CPU_ABIS" == *"arm64-v8a"* ]]; then
  SUPPORTS_64BIT=true
  ui_print "- Device supports 64-bit"
fi

if [ "$ARCH" = "x86" ] || [ "$ARCH" = "x64" ]; then
  if [ "$SUPPORTS_32BIT" = true ]; then
    ui_print "- Extracting x86 libraries"

    extract "$ZIPFILE" 'zygisk/x86/libexample.so' "$MODPATH/zygisk" true
    mv "$MODPATH/zygisk/libexample.so" "$MODPATH/zygisk/x86.so"
  fi
    
  if [ "$SUPPORTS_64BIT" = true ]; then
     ui_print "- Extracting x64 libraries"

    extract "$ZIPFILE" 'zygisk/x64/libexample.so' "$MODPATH/zygisk" true
    mv "$MODPATH/zygisk/libexample.so" "$MODPATH/zygisk/x86_64.so"
  fi

  if [ "$ARCH" = "x86" ]; then
    extract "$ZIPFILE" 'cmd/x86/treat-wheel' "$MODPATH/cmd" true
  else
    extract "$ZIPFILE" 'cmd/x64/treat-wheel' "$MODPATH/cmd" true
  fi
else
  if [ "$SUPPORTS_32BIT" = true ]; then
    ui_print "- Extracting arm libraries"

    extract "$ZIPFILE" 'zygisk/armeabi-v7a/libexample.so' "$MODPATH/zygisk" true
    mv "$MODPATH/zygisk/libexample.so" "$MODPATH/zygisk/armeabi-v7a.so"
  fi

  if [ "$SUPPORTS_64BIT" = true ]; then
    ui_print "- Extracting arm64 libraries"

    extract "$ZIPFILE" 'zygisk/arm64-v8a/libexample.so' "$MODPATH/zygisk" true
    mv "$MODPATH/zygisk/libexample.so" "$MODPATH/zygisk/arm64-v8a.so"
  fi

  if [ "$ARCH" = "arm" ]; then
    extract "$ZIPFILE" 'cmd/armeabi-v7a/treat-wheel' "$MODPATH/cmd" true
  elif [ "$ARCH" = "arm64" ]; then
    extract "$ZIPFILE" 'cmd/arm64-v8a/treat-wheel' "$MODPATH/cmd" true
  fi
fi

ui_print "- Setting permissions"
set_perm_recursive "$MODPATH/zygisk" 0 0 0755 0755
set_perm_recursive "$MODPATH/cmd" 0 0 0755 0755

ui_print "- Extracting WebUI"
unzip -o "$ZIPFILE" "webroot/*" -d "$MODPATH"

if [ ! -d "/data/adb/treat_wheel" ]; then
  mkdir "/data/adb/treat_wheel"
fi

if [ ! -f "/data/adb/treat_wheel/state" ]; then
  touch "/data/adb/treat_wheel/state"
fi

# INFO: All protections are enabled by default; the WebUI Actions page is where
#         users turn them off. Older installers forced ReVanced umount and DenyList
#         inversion off on every install, so turn those two back on once.
if [ ! -f "/data/adb/treat_wheel/defaults_all_enabled" ]; then
  sed -i '/^disable_revanced_mounts_umount=/d; /^disable_denylist_logic_inversion=/d' "/data/adb/treat_wheel/state"

  touch "/data/adb/treat_wheel/defaults_all_enabled"
fi

ui_print "- Welcome to Treat Wheel $VERSION"
