import { exec, toast } from '../../kernelsu.js'

import { whichCurrentPage } from '../navbar.js'
import { getStrings, loadPage } from '../pageLoader.js'

globalThis.rootInfo = { impl: null }
globalThis.incompatibleModules = []

/* INFO: Protection → state-file disable flag + icon. A protection is active when
           its disable flag is not set and the module is not ignoring everything. */
const TW_ICONS = {
  mapsHiding: 'M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z',
  zygoteMountInfoLeakFixing: 'M4 6h16M4 12h16M4 18h10',
  fridaTracesHiding: 'M12 2v20M5 7l14 10M19 7L5 17',
  customFontLoading: 'M4 7h16v12H4zM4 7l2-3h12l2 3',
  moduleLoadingTracesHiding: 'M12 2l2.5 5 5.5.8-4 3.9 1 5.5L12 20l-5 2.6 1-5.5-4-3.9 5.5-.8z',
  gsiHiding: 'M4 5h16v14H4z',
  revancedMountsUmount: 'M7 8l-4 4 4 4M17 8l4 4-4 4M14 4l-4 16',
  denylistLogicInversion: 'M4 12a8 8 0 1116 0 8 8 0 01-16 0zM12 8v4l3 2',
  propSpoofing: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7'
}
const TW_PROTECTIONS = [
  ['mapsHiding', 'disable_maps_hiding'],
  ['zygoteMountInfoLeakFixing', 'disable_zygote_mountinfo_leak_fixing'],
  ['fridaTracesHiding', 'disable_frida_traces_hiding'],
  ['customFontLoading', 'disable_custom_font_loading'],
  ['moduleLoadingTracesHiding', 'disable_module_loading_traces_hiding'],
  ['gsiHiding', 'disable_gsi_hiding'],
  ['revancedMountsUmount', 'disable_revanced_mounts_umount'],
  ['denylistLogicInversion', 'disable_denylist_logic_inversion'],
  ['propSpoofing', 'disable_prop_spoofing']
]

async function _fileExists(path) {
  const result = await exec(`stat "${path}"`)
  return result.errno === 0
}

async function _isModuleDisabled() {
  return await _fileExists('/data/adb/modules/treat_wheel/disable')
}

/* INFO: ok is false when the state file could not be read. An empty file with ok=true is
           the valid "every protection on" case; a failed read must NOT be treated that way,
           or the dashboard would fabricate an all-on view for a device it never queried. */
async function _readStateFlags() {
  const result = await exec('cat /data/adb/treat_wheel/state')
  const flags = {}
  if (result.errno !== 0) return { flags, ok: false }
  result.stdout.split('\n').forEach((line) => {
    const idx = line.indexOf('=')
    if (idx === -1) return;
    flags[line.slice(0, idx).trim()] = line.slice(idx + 1).trim() === 'true'
  })
  return { flags, ok: true }
}

/* INFO: Serialise the state file the same way the Actions page does: only the flags that
           are set are written, then description.sh refreshes the root-manager module list. */
function _writeStateFlags(flags) {
  const keys = ['ignoring', ...TW_PROTECTIONS.map(([, d]) => d)]
  let state = ''
  for (const k of keys) if (flags[k] === true) state += `${k}=true\n`
  return exec(`echo "${state}" > /data/adb/treat_wheel/state; sh /data/adb/modules/treat_wheel/description.sh`)
}

/* INFO: NextWheel only runs inside apps that NextZygisk/ReZygisk inject into. If the
           Zygisk monitor, daemon or Zygote injection stops, new apps are left unhidden
           while the last status file still reads "hiding", so ask the provider directly
           through the state.json it publishes. NextZygisk can also be told to skip the
           root unmount, which leaves the "clean" namespace NextWheel requests mounted. */
async function _readZygiskHealth() {
  /* INFO: known: state.json was read. loaded: NextZygisk loaded NextWheel at boot. */
  const health = { down: false, reason: '', umountOff: false, known: false, loaded: false, present: false }

  health.umountOff = await _fileExists('/data/adb/nextzygisk/umount_disabled')
  health.present = await _fileExists('/data/adb/modules/rezygisk')

  const result = await exec('cat /data/adb/rezygisk/state.json')
  if (result.errno !== 0 || !result.stdout) return health

  let state
  try { state = JSON.parse(result.stdout) } catch (e) { return health }
  health.known = true

  /* INFO: monitor.state is the tracer's enum, where 0 is TRACING. */
  if (state.monitor && String(state.monitor.state) !== '0') {
    health.down = true
    if (state.monitor.reason) health.reason = state.monitor.reason
  }

  for (const daemon of Object.values(state.rezygiskd || {})) {
    if (Array.isArray(daemon.modules) && daemon.modules.includes('treat_wheel')) health.loaded = true

    if (Number(daemon.state) !== 0) continue;

    health.down = true
    if (!health.reason && daemon.reason) health.reason = daemon.reason
  }

  for (const injected of Object.values(state.zygote || {})) {
    if (Number(injected) === 0) health.down = true
  }

  return health
}

/* INFO: NextSUSFS (the kernel-level SuSFS module) publishes its state in a status file.
           Show a chip for it when it is installed, so the whole stack is visible here. */
async function _readSusfs() {
  const present = (await exec('stat /data/adb/modules/nextsusfs')).errno === 0
  if (!present) return { present: false, working: false }
  const status = await exec('cat /data/adb/nextsusfs/status')
  return { present: true, working: status.errno === 0 && status.stdout.trim() === 'working' }
}

async function _getVersion() {
  const moduleProp = await exec('cat /data/adb/modules/treat_wheel/module.prop')
  if (moduleProp.errno !== 0) return '???'
  let version = '???'
  moduleProp.stdout.split('\n').forEach((line) => {
    if (line.startsWith('version=')) version = line.split('=')[1]
  })
  return version
}

/* INFO: NextZygisk/ReZygisk is the host that loads NextWheel. Report its version so the
           whole stack is visible in one place (Device → Zygisk host). */
async function _getZygiskHostVersion() {
  const p = await exec('cat /data/adb/modules/rezygisk/module.prop')
  if (p.errno !== 0) return ''
  let name = 'NextZygisk', version = ''
  p.stdout.split('\n').forEach((line) => {
    if (line.startsWith('version=')) version = line.split('=')[1]
    if (line.startsWith('name=') && /zygisk/i.test(line)) name = line.split('=')[1].trim()
  })
  return version ? `NextZygisk ${version}` : 'NextZygisk'
}

async function _getprop(prop) {
  const r = await exec(`getprop ${prop}`)
  return r.errno === 0 ? r.stdout.trim() : ''
}

function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

async function _getDevice() {
  const rel = await _getprop('ro.build.version.release')
  const sdk = await _getprop('ro.build.version.sdk')
  const abi = await _getprop('ro.product.cpu.abi')
  const model = await _getprop('ro.product.model')
  const marketName = await _getprop('ro.product.marketname') || await _getprop('ro.product.vendor.marketname')
  const brand = await _getprop('ro.product.manufacturer') || await _getprop('ro.product.brand')
  const kernelR = await exec('uname -r')
  let modelStr = marketName
  if (!modelStr) modelStr = [brand ? _cap(brand) : '', model].filter(Boolean).join(' ')
  return {
    model: modelStr || '—',
    android: rel ? `${rel}${sdk ? ` · SDK ${sdk}` : ''}` : '—',
    kernel: kernelR.errno === 0 ? kernelR.stdout.trim().split(' ')[0] : '—',
    arch: abi || '—',
    bits: /64/.test(abi) ? '64-bit' : (abi ? '32-bit' : '—')
  }
}

/* INFO: Device uptime since boot. NextWheel starts hiding at boot, so this is also how
           long the environment has been protected. */
async function _getUptime(strings) {
  const r = await exec('cat /proc/uptime')
  if (r.errno !== 0) return '—'
  const secs = parseFloat(r.stdout.trim().split(' ')[0])
  if (!isFinite(secs)) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const u = (strings && strings.dash) || {}
  const uD = u.unitDay || 'd', uH = u.unitHour || 'h', uM = u.unitMin || 'm'
  if (d > 0) return `${d}${uD} ${h}${uH}`
  if (h > 0) return `${h}${uH}`
  return `${m}${uM}`
}

/* INFO: Count the apps NextWheel enforces hiding on — the root manager's denylist. There
           is no single cross-root file, so try each manager in turn and leave it unknown
           (shown as "—") when none answers, instead of inventing a number. */
async function _readHiddenApps() {
  /* Magisk keeps a "package|process" denylist its CLI can list. */
  const mg = await exec('magisk --denylist ls 2>/dev/null')
  if (mg.errno === 0 && mg.stdout.trim()) {
    const pkgs = new Set(mg.stdout.trim().split('\n').map((l) => l.split('|')[0].trim()).filter(Boolean))
    if (pkgs.size) return { count: pkgs.size, known: true }
  }
  /* KernelSU / KernelSU-Next and APatch store per-app profiles; the umount list is the
       set of non-root apps that still get modules unmounted (NextWheel's hiding targets). */
  const ksu = await exec("ksud profile list 2>/dev/null || su -c 'ksud profile list' 2>/dev/null")
  if (ksu.errno === 0 && ksu.stdout.trim()) {
    const n = ksu.stdout.trim().split('\n').filter((l) => l.trim()).length
    if (n) return { count: n, known: true }
  }
  return { count: 0, known: false }
}

async function _usedRootImpl() {
  const providers = { KSU: false, APatch: false, Magisk: false }
  {
    const ksuVersion = await exec('/data/adb/ksud debug version')
    if (ksuVersion.errno === 0 && ksuVersion.stdout !== 'Kernel Version: 0') providers.KSU = true
  }
  {
    const apdExists = await exec('/data/adb/apd --help')
    if (apdExists.errno === 0) providers.APatch = true
  }
  {
    const magiskFiles = ['/sbin/magisk32', '/sbin/magisk64', '/sbin/magisk', '/debug_ramdisk/magisk32', '/debug_ramdisk/magisk64', '/debug_ramdisk/magisk']
    for (let i = 0; i < magiskFiles.length; i++) {
      const fileExists = await exec(`${magiskFiles[i]} -V`)
      if (fileExists.errno === 0) { providers.Magisk = true; break }
    }
  }
  if ((providers.KSU) + (providers.APatch) + (providers.Magisk) > 1) return 'Multiple'
  if (providers.KSU) return 'KernelSU'
  if (providers.APatch) return 'APatch'
  if (providers.Magisk) return 'Magisk'
  return false
}

/* INFO: KernelSU Next brands itself differently; when the manager package is present,
           label it so the Device card reads "KernelSU Next" like the stock WebUI. */
async function _refineKsuLabel(label) {
  if (label !== 'KernelSU') return label
  const next = await exec('pm path com.rifsxd.ksunext 2>/dev/null')
  if (next.errno === 0 && next.stdout.trim()) return 'KernelSU Next'
  return label
}

const RING = {
  ok: { color: 'var(--green)', svg: '<svg viewBox="0 0 24 24" style="stroke:var(--green)"><path d="M5 13l4 4L19 7"/></svg>' },
  warn: { color: 'var(--amber)', svg: '<svg viewBox="0 0 24 24" style="stroke:var(--amber)"><path d="M12 3l9 16H3zM12 10v4M12 17v.5"/></svg>' },
  err: { color: 'var(--red)', svg: '<svg viewBox="0 0 24 24" style="stroke:var(--red)"><path d="M7 7l10 10M17 7L7 17"/></svg>' },
  neutral: { color: '#5b6472', svg: '<svg viewBox="0 0 24 24" style="stroke:#8b93a0"><path d="M9 8v8M15 8v8"/></svg>' }
}

const STATUS_EMOJI = { ok: '✅', warn: '⚠️', err: '❌', neutral: '⏸️' }

/* INFO: One-time environment facts, read in load() and reused across refreshes. */
const twEnv = {
  version: '???', rootImpl: '—', rootImplRaw: false, zygiskHost: '',
  device: { model: '—', android: '—', kernel: '—', arch: '—', bits: '—' },
  disabled: false
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) }

function _toolSvg(path) { return `<svg viewBox="0 0 24 24"><path d="${path}"/></svg>` }

const TOOL_ICONS = {
  logs: 'M4 6h16M4 12h10M4 18h13',
  export: 'M12 3v11M8 10l4 4 4-4M5 20h14',
  denylist: 'M4 6h16M4 12h10M4 18h13',
  reboot: 'M12 3v9M18.4 6.6a9 9 0 11-12.8 0'
}

async function refreshDashboard() {
  if (whichCurrentPage() !== 'home') return;
  if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return;

  const strings = await getStrings('home')
  if (!strings || !strings.protections || !strings.dash || !strings.status || !strings.tools) return;

  const list = document.getElementById('tw_protections_list')
  if (!list) return;

  const stateRead = await _readStateFlags()
  const flags = stateRead.flags
  const stateOk = stateRead.ok
  const ignoring = flags['ignoring'] === true
  const paused = ignoring || twEnv.disabled
  const status = await exec('cat /data/adb/treat_wheel/status')
  const zygisk = await _readZygiskHealth()
  const susfs = await _readSusfs()
  const hidden = await _readHiddenApps()
  const incompatible = globalThis.incompatibleModules

  /* Protections list (left column) → rows with working switches */
  let active = 0
  let total = 0
  let html = ''
  for (const [key, disableKey] of TW_PROTECTIONS) {
    /* INFO: Denylist logic inversion is Magisk-only — on other roots it is locked on and
               cannot be toggled, so hide its row entirely (like NextSUSFS hides options that
               do not apply) and leave it out of the count, so the "N/N" the user sees always
               matches the number of switches shown. */
    if (key === 'denylistLogicInversion' && twEnv.rootImplRaw !== 'Magisk') continue;
    total++

    /* INFO: A protection is active when its disable flag is not set and nothing is pausing
               hiding. When the state file could not be read we show nothing as active rather
               than defaulting the whole list to on. */
    const isActive = stateOk && !paused && flags[disableKey] !== true
    if (isActive) active++

    const rowDisabled = paused || !stateOk
    const checked = (stateOk && flags[disableKey] !== true) ? 'checked' : ''
    const label = strings.protections.items[key] || key
    const blurb = (strings.protections.blurbs && strings.protections.blurbs[key]) || ''
    html += `<div class="tw_prot_row${rowDisabled ? ' dis' : ''}" data-key="${key}" data-flag="${disableKey}">` +
            `<div class="tw_prot_tx"><div class="tw_prot_nm">${esc(label)}</div><div class="tw_prot_bl">${esc(blurb)}</div></div>` +
            `<label class="tw_switch"><input type="checkbox" ${checked} ${rowDisabled ? 'disabled' : ''}><span class="tw_slider"></span></label>` +
            `</div>`
  }
  list.innerHTML = html
  _wireProtectionSwitches(list, flags)
  const listSep = document.documentElement.getAttribute('dir') === 'rtl' ? '، ' : ', '

  /* Overall status → hero + banner + device-status row */
  let heroCls, ring, title, deg = Math.round((active / total) * 360)
  let bType = null, bTitle = '', bDesc = ''
  const banner = document.getElementById('tw_banner')

  if (incompatible.length > 0) {
    heroCls = 'err'; ring = 'err'; title = strings.workingModes.incompatibleModules.replace('%s', incompatible.join(listSep))
    bType = 'err'; bTitle = strings.dash.incompatibleTitle; bDesc = incompatible.join(listSep); deg = 360
  } else if (twEnv.disabled) {
    heroCls = 'neutral'; ring = 'neutral'; title = strings.workingModes.disabled; deg = 360
  } else if (zygisk.down) {
    heroCls = 'err'; ring = 'err'; title = strings.workingModes.zygiskDown; bType = 'err'; bTitle = strings.workingModes.zygiskDown; deg = 360
    /* INFO: The reason comes from NextZygisk in English. Isolate it (FSI…PDI) so it
               stays in one piece inside right-to-left text. */
    bDesc = zygisk.reason ? `${strings.dash.zygiskDownDesc} ⁨(${zygisk.reason})⁩` : strings.dash.zygiskDownDesc
  } else if (status.errno !== 0 && !(zygisk.known && zygisk.loaded)) {
    /* INFO: No status file yet just means no app went through hiding since boot. When
               NextZygisk reports NextWheel loaded, that is not a problem. */
    heroCls = 'warn'; ring = 'warn'; title = strings.workingModes.unknown; bType = 'warn'; bTitle = strings.workingModes.unknown; bDesc = strings.dash.unknownDesc; deg = 360
  } else if (ignoring) {
    heroCls = 'neutral'; ring = 'neutral'; title = strings.workingModes.ignoring; deg = 360
  } else if (status.stdout === 'crashed') {
    heroCls = 'err'; ring = 'err'; title = strings.workingModes.crashed; bType = 'err'; bTitle = strings.workingModes.crashed; bDesc = strings.dash.crashedDesc; deg = 360
  } else if (zygisk.umountOff) {
    heroCls = 'warn'; ring = 'warn'; title = strings.workingModes.umountOff
    bType = 'warn'; bTitle = strings.workingModes.umountOff; bDesc = strings.dash.umountOffDesc
  } else {
    heroCls = 'ok'; ring = 'ok'; title = strings.dash.titleActive
    /* INFO: Turning protections off is the user's choice, not a fault: the overall
               status stays active and the ring just shows how many are on. */
  }

  const hero = document.getElementById('tw_hero')
  const ringEl = document.getElementById('tw_ring')
  const ringIc = document.getElementById('tw_ring_ic')
  const stateEl = document.getElementById('tw_state')
  const subEl = document.getElementById('tw_hsub')
  const chipsEl = document.getElementById('tw_chips')
  if (hero) hero.className = 'tw_hero ' + heroCls
  if (ringEl) { ringEl.style.setProperty('--tw-ring', RING[ring].color); ringEl.style.setProperty('--tw-deg', deg + 'deg') }
  if (ringIc) ringIc.innerHTML = RING[ring].svg
  if (stateEl) stateEl.innerHTML = esc(title)
  if (subEl) subEl.textContent = strings.dash.subtitle
  const updatedEl = document.getElementById('tw_updated')
  if (updatedEl) updatedEl.textContent = strings.dash.updatedNow

  const verChip = /^v/i.test(twEnv.version) ? twEnv.version : `v${twEnv.version}`
  if (chipsEl) chipsEl.innerHTML =
    `<span class="tw_chip v">${esc(verChip)}</span>` +
    `<span class="tw_chip">${esc(strings.dash.via)}</span>` +
    `<span class="tw_chip on">${active}/${total} ${esc(strings.dash.on)}</span>` +
    /* INFO: Show a SuSFS chip when NextSUSFS is installed: green when it is working in
               the kernel, amber when installed but the kernel has no SuSFS. */
    (susfs.present ? `<span class="tw_chip" style="color:${susfs.working ? 'var(--green)' : 'var(--amber)'}">SuSFS</span>` : '')

  const hiddenStr = hidden.known ? String(hidden.count) : '—'

  /* Hero stat trio */
  const statsEl = document.getElementById('tw_hstats')
  if (statsEl) statsEl.innerHTML =
    `<div class="tw_hstat"><div class="tw_hstat_n">${active}/${total}</div><div class="tw_hstat_l">${esc(strings.protections.title)}</div></div>` +
    `<div class="tw_hstat"><div class="tw_hstat_n">${esc(hiddenStr)}</div><div class="tw_hstat_l">${esc(strings.dash.statHidden)}</div></div>` +
    `<div class="tw_hstat"><div class="tw_hstat_n">${esc(twEnv.uptime || '—')}</div><div class="tw_hstat_l">${esc(strings.dash.uptime)}</div></div>`

  /* Status 2x2 cards */
  _paintStatusCards(strings, { heroCls, zygisk, paused, ignoring, hidden })

  /* Device card + status row */
  _paintDevice(strings, { title, heroCls, hiddenStr, zygisk })

  if (banner) {
    if (bType) {
      banner.className = 'tw_alert ' + bType
      banner.style.display = 'flex'
      document.getElementById('tw_banner_ic').innerHTML = bType === 'err'
        ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M12 3l9 16H3zM12 10v4M12 17v.5"/></svg>'
      document.getElementById('tw_banner_t').textContent = bTitle
      document.getElementById('tw_banner_d').textContent = bDesc
    } else {
      banner.style.display = 'none'
    }
  }
}

function _cardHTML(icon, name, dotCls, label, sub) {
  return `<div class="tw_cell"><div class="tw_cell_top">${_toolSvg(icon)}<span class="tw_cell_nm">${esc(name)}</span></div>` +
         `<div class="tw_cell_stat"><span class="tw_dot ${dotCls}"></span><span class="tw_cell_lb">${esc(label)}</span></div>` +
         `<div class="tw_cell_sub">${esc(sub)}</div></div>`
}

function _paintStatusCards(strings, ctx) {
  const el = document.getElementById('tw_status_grid')
  if (!el) return;
  const s = strings.status
  const { heroCls, zygisk, paused, hidden } = ctx

  /* NextWheel */
  let nwDot = 'on', nwLabel = s.active, nwSub = s.subActive
  if (heroCls === 'neutral') { nwDot = 'pz'; nwLabel = s.paused; nwSub = s.subPaused }
  else if (heroCls === 'err') { nwDot = 'off'; nwLabel = s.crashed; nwSub = s.subProblem }
  else if (heroCls === 'warn') { nwDot = 'pz'; nwLabel = s.active; nwSub = s.subProblem }
  if (twEnv.disabled) { nwDot = 'neutral'; nwLabel = s.disabled; nwSub = s.subPaused }

  /* NextZygisk host */
  const zLoaded = zygisk.known ? zygisk.loaded : zygisk.present
  const zDot = zygisk.present ? (zygisk.down ? 'pz' : 'on') : 'off'
  const zLabel = zygisk.present ? (zLoaded || !zygisk.known ? s.loaded : s.loaded) : s.notFound
  const zSub = zygisk.present ? s.subHostPresent : s.subHostMissing

  /* Zygote injection */
  const zgInjected = zygisk.present && !zygisk.down
  const zgDot = zgInjected ? 'on' : (zygisk.present ? 'off' : 'neutral')
  const zgLabel = zgInjected ? s.injected : s.notInjected
  const zgSub = zgInjected ? twEnv.device.bits : s.subNotInjected

  /* Denylist */
  const dlLabel = hidden.known ? String(hidden.count) : '—'

  el.innerHTML =
    _cardHTML('M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z', s.nextwheel, nwDot, nwLabel, nwSub) +
    _cardHTML('M12 3a9 9 0 100 18 9 9 0 000-18z', s.nextzygisk, zDot, zLabel, zSub) +
    _cardHTML('M5 5h14v14H5z', s.zygote, zgDot, zgLabel, zgSub) +
    _cardHTML('M5 12h14', s.denylist, hidden.known ? 'on' : 'neutral', dlLabel, s.subApps)
}

function _paintDevice(strings, ctx) {
  const el = document.getElementById('tw_device')
  if (!el || !strings.dash) return;
  const d = strings.dash
  const emoji = ctx && ctx.heroCls ? STATUS_EMOJI[ctx.heroCls] : ''
  const statusVal = ctx && ctx.title ? `${ctx.title} ${emoji}` : '—'
  const hiddenStr = ctx ? ctx.hiddenStr : '—'
  const rows = [
    [d.model, twEnv.device.model],
    [d.android, twEnv.device.android],
    [d.kernel, twEnv.device.kernel],
    [d.root, twEnv.rootImpl],
    [d.zygiskHost, twEnv.zygiskHost || '—'],
    [d.abi || d.architecture, twEnv.device.arch],
    [d.hiddenApps, hiddenStr],
    [d.statusRow, statusVal]
  ]
  el.innerHTML = rows.map(([k, v]) => `<div class="tw_drow"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')
}

/* INFO: Device card painted once with placeholders before data is read, so the layout
           does not jump. refreshDashboard() fills the live status in. */
function paintDevice(strings) { _paintDevice(strings, null) }

let _switchBusy = false
function _wireProtectionSwitches(list, flags) {
  list.querySelectorAll('.tw_prot_row').forEach((row) => {
    const input = row.querySelector('input')
    if (!input || input.disabled) return;
    input.onchange = async () => {
      if (_switchBusy) return;
      _switchBusy = true
      const disableKey = row.getAttribute('data-flag')
      /* INFO: Checked = protection on = disable flag cleared. */
      flags[disableKey] = !input.checked
      /* INFO: Clear a stale "crashed" status when a protection is toggled, mirroring Actions. */
      await exec('grep -q crashed /data/adb/treat_wheel/status && rm -f /data/adb/treat_wheel/status')
      await _writeStateFlags(flags)
      _switchBusy = false
      await refreshDashboard()
    }
  })
}

function _wireTools(strings) {
  const el = document.getElementById('tw_tools')
  if (!el) return;
  const t = strings.tools
  const tools = [
    ['logs', 'liveLogs', 'liveLogsDesc', false],
    ['export', 'export', 'exportDesc', false],
    ['denylist', 'denylist', 'denylistDesc', false],
    ['reboot', 'softReboot', 'softRebootDesc', true]
  ]
  el.innerHTML = tools.map(([ic, nm, ds, danger]) =>
    `<div class="tw_tool${danger ? ' danger' : ''}" data-tool="${nm}"><div class="tw_tool_ic">${_toolSvg(TOOL_ICONS[ic])}</div>` +
    `<div class="tw_tool_nm">${esc(t[nm])}</div><div class="tw_tool_ds">${esc(t[ds])}</div></div>`
  ).join('')

  el.querySelectorAll('.tw_tool').forEach((card) => {
    card.onclick = () => _runTool(card.getAttribute('data-tool'), strings)
  })
}

async function _runTool(tool, strings) {
  const t = strings.tools
  if (tool === 'liveLogs') {
    const out = '/data/adb/treat_wheel/webui_logs.txt'
    await exec(`logcat -d -t 2000 2>/dev/null | grep -iE 'NextWheel|TreatWheel|ReZygisk|Zygisk' > ${out} 2>/dev/null; echo done`)
    toast(t.savedTo.replace('%s', out))
  } else if (tool === 'export') {
    const out = '/data/adb/treat_wheel/diagnostics.txt'
    const state = await exec('cat /data/adb/treat_wheel/state 2>/dev/null')
    const report =
      `NextWheel diagnostics\n` +
      `Version: ${twEnv.version}\n` +
      `Zygisk host: ${twEnv.zygiskHost}\n` +
      `Root: ${twEnv.rootImpl}\n` +
      `Model: ${twEnv.device.model}\n` +
      `Android: ${twEnv.device.android}\n` +
      `Kernel: ${twEnv.device.kernel}\n` +
      `ABI: ${twEnv.device.arch}\n` +
      `--- state ---\n${state.errno === 0 ? state.stdout : '(none)'}`
    await exec(`cat > ${out} <<'TWEOF'\n${report}\nTWEOF`)
    try { await navigator.clipboard.writeText(report) } catch (e) {}
    toast(t.savedTo.replace('%s', out))
  } else if (tool === 'denylist') {
    toast(t.denylistHint)
  } else if (tool === 'softReboot') {
    toast(t.rebooting)
    await exec('setprop ctl.restart zygote; setprop ctl.restart zygote_secondary')
  }
}

export async function loadOnce() {}

export async function loadOnceView() {}

export async function onceViewAfterUpdate() {
  const strings = await getStrings(whichCurrentPage())
  if (strings && strings.dash) paintDevice(strings)
  if (strings && strings.tools) _wireTools(strings)
  await refreshDashboard()
}

let started = false

export async function load() {
  if (started) { await refreshDashboard(); return; }
  started = true

  const strings = await getStrings('home')

  twEnv.version = await _getVersion()
  twEnv.zygiskHost = await _getZygiskHostVersion()
  twEnv.rootImplRaw = await _usedRootImpl()
  globalThis.rootInfo.impl = twEnv.rootImplRaw
  if (!twEnv.rootImplRaw) twEnv.rootImpl = (strings && strings.unknown) || 'Unknown'
  else if (twEnv.rootImplRaw === 'Multiple') twEnv.rootImpl = (strings && strings.rootImpls && strings.rootImpls.multiple) || 'Multiple'
  else twEnv.rootImpl = await _refineKsuLabel(twEnv.rootImplRaw)
  twEnv.device = await _getDevice()
  twEnv.uptime = await _getUptime(strings)
  twEnv.disabled = await _isModuleDisabled()

  globalThis.incompatibleModules = []
  if (await _fileExists('/data/adb/modules/zygisk_assistant') || await _fileExists('/data/adb/modules_update/zygisk_assistant')) globalThis.incompatibleModules.push('Zygisk Assistant')
  if (await _fileExists('/data/adb/modules/nohello') || await _fileExists('/data/adb/modules_update/nohello')) globalThis.incompatibleModules.push('NoHello')

  if (strings) { paintDevice(strings); _wireTools(strings) }

  const copy = document.getElementById('tw_copy')
  if (copy) copy.addEventListener('click', async () => {
    const txt = `NextWheel ${twEnv.version}\n${(strings && strings.dash && strings.dash.model) || 'Model'}: ${twEnv.device.model}\n` +
      `${(strings && strings.dash && strings.dash.android) || 'Android'}: ${twEnv.device.android}\n` +
      `${(strings && strings.dash && strings.dash.kernel) || 'Kernel'}: ${twEnv.device.kernel}\n` +
      `${(strings && strings.dash && strings.dash.root) || 'Root'}: ${twEnv.rootImpl}\n` +
      `${(strings && strings.dash && strings.dash.zygiskHost) || 'Zygisk host'}: ${twEnv.zygiskHost}\n` +
      `ABI: ${twEnv.device.arch}`
    try { await navigator.clipboard.writeText(txt); toast((strings && strings.dash && strings.dash.copied) || 'Copied') }
    catch (e) { toast(txt) }
  })

  const manage = document.getElementById('tw_manage')
  if (manage) manage.addEventListener('click', () => loadPage('actions'))

  const refresh = document.getElementById('tw_refresh')
  if (refresh) refresh.addEventListener('click', () => refreshDashboard())

  /* INFO: Device uptime ticks; recompute it on each refresh. */
  await refreshDashboard()

  if (!globalThis.twDashboardTimer) {
    globalThis.twDashboardTimer = setInterval(async () => {
      twEnv.uptime = await _getUptime(strings)
      refreshDashboard()
    }, 4000)
  }

  /* INFO: This hides the throbber screen */
  loading_screen.style.display = 'none'
}
