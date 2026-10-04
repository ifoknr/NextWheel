import { exec, toast } from '../../kernelsu.js'

import { whichCurrentPage } from '../navbar.js'
import { getStrings } from '../pageLoader.js'

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

async function _readStateFlags() {
  const result = await exec('cat /data/adb/treat_wheel/state')
  const flags = {}
  if (result.errno === 0) {
    result.stdout.split('\n').forEach((line) => {
      const idx = line.indexOf('=')
      if (idx === -1) return;
      flags[line.slice(0, idx).trim()] = line.slice(idx + 1).trim() === 'true'
    })
  }
  return flags
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

async function _getprop(prop) {
  const r = await exec(`getprop ${prop}`)
  return r.errno === 0 ? r.stdout.trim() : ''
}

async function _getDevice() {
  const rel = await _getprop('ro.build.version.release')
  const sdk = await _getprop('ro.build.version.sdk')
  const abi = await _getprop('ro.product.cpu.abi')
  return {
    android: rel ? `${rel}${sdk ? ` (SDK ${sdk})` : ''}` : '—',
    arch: abi || '—'
  }
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

const RING = {
  ok: { color: 'var(--green)', svg: '<svg viewBox="0 0 24 24" style="stroke:var(--green)"><path d="M5 13l4 4L19 7"/></svg>' },
  warn: { color: 'var(--amber)', svg: '<svg viewBox="0 0 24 24" style="stroke:var(--amber)"><path d="M12 3l9 16H3zM12 10v4M12 17v.5"/></svg>' },
  err: { color: 'var(--red)', svg: '<svg viewBox="0 0 24 24" style="stroke:var(--red)"><path d="M7 7l10 10M17 7L7 17"/></svg>' },
  neutral: { color: '#5b6472', svg: '<svg viewBox="0 0 24 24" style="stroke:#8b93a0"><path d="M9 8v8M15 8v8"/></svg>' }
}

/* INFO: One-time environment facts, read in load() and reused across refreshes. */
const twEnv = { version: '???', rootImpl: '—', device: { android: '—', arch: '—' }, disabled: false, lockStatic: false }

/* INFO: Time in the WebUI language (Arabic gets its own word order), with Latin digits. */
function _timeNow() {
  const lang = (localStorage.getItem('/TreatWheel/language') || 'en_US').replace('_', '-')
  const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit' }
  try {
    return new Date().toLocaleTimeString(`${lang}-u-nu-latn`, opts)
  } catch (e) {
    return new Date().toLocaleTimeString([], opts)
  }
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) }

async function refreshDashboard() {
  if (whichCurrentPage() !== 'home') return;
  if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return;

  const strings = await getStrings('home')
  if (!strings || !strings.protections || !strings.dash) return;

  const list = document.getElementById('tw_protections_list')
  if (!list) return;

  const flags = await _readStateFlags()
  const ignoring = flags['ignoring'] === true
  const status = await exec('cat /data/adb/treat_wheel/status')
  const incompatible = globalThis.incompatibleModules

  /* Protections grid */
  let active = 0, offNames = []
  let html = ''
  for (const [key, disableKey] of TW_PROTECTIONS) {
    const isActive = !ignoring && !twEnv.disabled && flags[disableKey] !== true
    if (isActive) active++
    else if (!ignoring && !twEnv.disabled && flags[disableKey] === true) offNames.push(strings.protections.items[key] || key)

    const label = strings.protections.items[key] || key
    const stateText = (ignoring || twEnv.disabled) ? strings.protections.paused : (isActive ? strings.protections.active : strings.protections.inactive)
    const cls = (ignoring || twEnv.disabled) ? 'pz' : (isActive ? 'on' : 'off')
    html += `<div class="tw_cell"><div class="tw_cell_top"><svg viewBox="0 0 24 24"><path d="${TW_ICONS[key]}"/></svg><span class="tw_cell_nm">${esc(label)}</span></div>` +
            `<div class="tw_cell_stat"><span class="tw_dot ${cls}"></span><span class="tw_cell_lb">${esc(stateText)}</span></div></div>`
  }
  list.innerHTML = html
  const total = TW_PROTECTIONS.length

  /* Overall status → hero + banner */
  let heroCls, ring, title, sub = '', deg = 360
  const banner = document.getElementById('tw_banner')
  let bType = null, bTitle = '', bDesc = ''

  if (incompatible.length > 0) {
    heroCls = 'err'; ring = 'err'; title = strings.workingModes.incompatibleModules.replace('%s', incompatible.join(', '))
    bType = 'err'; bTitle = strings.dash.incompatibleTitle; bDesc = incompatible.join(', ')
  } else if (twEnv.disabled) {
    heroCls = 'neutral'; ring = 'neutral'; title = strings.workingModes.disabled
  } else if (status.errno !== 0) {
    heroCls = 'warn'; ring = 'warn'; title = strings.workingModes.unknown; bType = 'warn'; bTitle = strings.workingModes.unknown; bDesc = strings.dash.unknownDesc
  } else if (ignoring) {
    heroCls = 'neutral'; ring = 'neutral'; title = strings.workingModes.ignoring
  } else if (status.stdout === 'crashed') {
    heroCls = 'err'; ring = 'err'; title = strings.workingModes.crashed; bType = 'err'; bTitle = strings.workingModes.crashed; bDesc = strings.dash.crashedDesc
  } else {
    heroCls = 'ok'; ring = 'ok'; title = strings.workingModes.working
    sub = strings.dash.heroActive.replace('%s', active).replace('%s', total)
    deg = Math.round((active / total) * 360)
    if (offNames.length > 0) { bType = 'warn'; bTitle = strings.dash.disabledTitle.replace('%s', offNames.length); bDesc = offNames.join(', ') }
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
  if (subEl) subEl.textContent = sub
  const updatedEl = document.getElementById('tw_updated')
  if (updatedEl) updatedEl.textContent = strings.dash.updated.replace('%s', _timeNow())
  if (chipsEl) chipsEl.innerHTML =
    `<span class="tw_chip v">${esc(twEnv.version)}</span>` +
    `<span class="tw_chip">${esc(twEnv.rootImpl)}</span>` +
    `<span class="tw_chip">${active}/${total}</span>`

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

function paintDevice(strings) {
  const el = document.getElementById('tw_device')
  if (!el || !strings.dash) return;
  el.innerHTML =
    `<div class="tw_drow"><span class="k">${esc(strings.dash.android)}</span><span class="v">${esc(twEnv.device.android)}</span></div>` +
    `<div class="tw_drow"><span class="k">${esc(strings.dash.architecture)}</span><span class="v">${esc(twEnv.device.arch)}</span></div>` +
    `<div class="tw_drow"><span class="k">${esc(strings.dash.root)}</span><span class="v">${esc(twEnv.rootImpl)}</span></div>`
}

export async function loadOnce() {}

export async function loadOnceView() {}

export async function onceViewAfterUpdate() {
  const strings = await getStrings(whichCurrentPage())
  if (strings && strings.dash) paintDevice(strings)
  await refreshDashboard()
}

let started = false

export async function load() {
  if (started) { await refreshDashboard(); return; }
  started = true

  const strings = await getStrings('home')

  twEnv.version = await _getVersion()
  twEnv.rootImpl = await _usedRootImpl()
  if (!twEnv.rootImpl) twEnv.rootImpl = (strings && strings.unknown) || 'Unknown'
  else if (twEnv.rootImpl === 'Multiple') twEnv.rootImpl = (strings && strings.rootImpls && strings.rootImpls.multiple) || 'Multiple'
  twEnv.device = await _getDevice()
  twEnv.disabled = await _isModuleDisabled()

  globalThis.incompatibleModules = []
  if (await _fileExists('/data/adb/modules/zygisk_assistant') || await _fileExists('/data/adb/modules_update/zygisk_assistant')) globalThis.incompatibleModules.push('Zygisk Assistant')
  if (await _fileExists('/data/adb/modules/nohello') || await _fileExists('/data/adb/modules_update/nohello')) globalThis.incompatibleModules.push('NoHello')

  if (strings) paintDevice(strings)

  const copy = document.getElementById('tw_copy')
  if (copy) copy.addEventListener('click', async () => {
    const txt = `Treat Wheel ${twEnv.version}\nRoot: ${twEnv.rootImpl}\nAndroid: ${twEnv.device.android}\nArch: ${twEnv.device.arch}`
    try { await navigator.clipboard.writeText(txt); toast((strings && strings.dash && strings.dash.copied) || 'Copied') }
    catch (e) { toast(txt) }
  })

  const refresh = document.getElementById('tw_refresh')
  if (refresh) refresh.addEventListener('click', () => refreshDashboard())

  await refreshDashboard()

  if (!globalThis.twDashboardTimer) {
    globalThis.twDashboardTimer = setInterval(() => { refreshDashboard() }, 4000)
  }

  /* INFO: This hides the throbber screen */
  loading_screen.style.display = 'none'
}
