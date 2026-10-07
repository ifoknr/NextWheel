MODDIR="${0%/*}"

$MODDIR/cmd/treat-wheel &

# INFO: Keep the status and protection count in the module list up to date.
(
  while true; do
    sh "$MODDIR/description.sh"
    sleep 30
  done
) &
