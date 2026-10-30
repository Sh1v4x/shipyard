import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, ROOT } from './config.ts'
import { run } from './exec.ts'

// Notifications macOS via une petite app compilée sur place (server/native/notifier.swift) :
// elle affiche la notification, la retire au bout de N secondes, et ouvre le panel au clic.
// Sans compilateur Swift, repli sur osascript (durée fixée par macOS, clic sans effet).

const APP = join(DATA_DIR, 'ShipyardNotifier.app')
const BIN = join(APP, 'Contents/MacOS/ShipyardNotifier')
const SOURCE = join(ROOT, 'server/native/notifier.swift')

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.shipyard.notifier</string>
<key>CFBundleName</key><string>Shipyard</string>
<key>CFBundleDisplayName</key><string>Shipyard</string>
<key>CFBundleExecutable</key><string>ShipyardNotifier</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
</dict></plist>
`

let building: Promise<boolean> | null = null

/** Compile l'app de notification si besoin (une fois). Renvoie false si ce n'est pas possible. */
export function ensureNotifierApp(): Promise<boolean> {
  if (existsSync(BIN)) return Promise.resolve(true)
  building ??= (async () => {
    try {
      mkdirSync(join(APP, 'Contents/MacOS'), { recursive: true })
      writeFileSync(join(APP, 'Contents/Info.plist'), PLIST)
      await run('swiftc', ['-O', '-o', BIN, SOURCE, '-framework', 'Cocoa', '-framework', 'UserNotifications'], { timeoutMs: 300_000 })
      await run('codesign', ['-s', '-', '--force', APP])
      return true
    } catch (e) {
      console.error(`Notifications : compilation impossible (${(e as Error).message}), repli sur osascript`)
      return false
    }
  })()
  return building
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Affiche une notification macOS pendant `seconds` secondes ; un clic ouvre `url`. */
export async function macNotify(n: { title: string; body: string; url: string; seconds: number }): Promise<'app' | 'osascript'> {
  if (await ensureNotifierApp()) {
    // open -n : une instance par notification ; -g : sans prendre le focus.
    await run('open', ['-n', '-g', APP, '--args', n.title, n.body || ' ', n.url, String(n.seconds)])
    return 'app'
  }
  await run('osascript', ['-e', `display notification ${quote(n.body || ' ')} with title ${quote('Shipyard')} subtitle ${quote(n.title)}`]).catch(() => undefined)
  return 'osascript'
}
