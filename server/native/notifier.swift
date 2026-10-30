// Notification macOS de Shipyard : affichée pendant N secondes, puis retirée ; un clic ouvre le panel.
// Usage : ShipyardNotifier <titre> <texte> <url> <secondes>
// Lancée sans argument (clic sur une notification après sa fin), elle ouvre seulement l'URL du clic.
import Cocoa
import UserNotifications

final class Delegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let args = CommandLine.arguments

  func applicationDidFinishLaunching(_ notification: Notification) {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    guard args.count >= 5, let seconds = Double(args[4]) else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { exit(0) }
      return
    }
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
      guard granted else {
        FileHandle.standardError.write("notifications refusées pour Shipyard\n".data(using: .utf8)!)
        exit(2)
      }
      let content = UNMutableNotificationContent()
      content.title = self.args[1]
      content.body = self.args[2]
      content.userInfo = ["url": self.args[3]]
      content.sound = .default
      let id = UUID().uuidString
      center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
        if let error {
          FileHandle.standardError.write("\(error.localizedDescription)\n".data(using: .utf8)!)
          exit(3)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
          center.removeDeliveredNotifications(withIdentifiers: [id])
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
        }
      }
    }
  }

  // Affiche la notification même si l'app est « au premier plan » (elle ne l'est jamais : pas d'icône dans le Dock).
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler handler: @escaping (UNNotificationPresentationOptions) -> Void) {
    handler([.banner, .list, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler handler: @escaping () -> Void) {
    if let url = response.notification.request.content.userInfo["url"] as? String, let target = URL(string: url) {
      NSWorkspace.shared.open(target)
    }
    center.removeDeliveredNotifications(withIdentifiers: [response.notification.request.identifier])
    handler()
    exit(0)
  }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
