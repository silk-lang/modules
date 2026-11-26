// macOS: open feed.html in the selected Chrome tab, or run the native --feed demo.
// From an Accessibility-authorized terminal: swift inspect-feed.swift chrome|silk
import AppKit
import ApplicationServices

func stop(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func read(_ node: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(node, name as CFString, &value)
    return (error, value)
}

func children(_ node: AXUIElement) -> [AXUIElement] {
    read(node, "AXChildren").1 as? [AXUIElement] ?? []
}

func describe(_ label: String, _ node: AXUIElement) {
    var names: CFArray?
    let status = AXUIElementCopyAttributeNames(node, &names)
    let advertised = Set(names as? [String] ?? [])
    print("\(label): \(children(node).count) AXChildren")
    for key in ["AXRole", "AXSubrole", "AXRoleDescription", "AXARIAPosInSet", "AXARIASetSize"] {
        let (error, value) = read(node, key)
        let text = value.map { String(describing: $0) } ?? "no value"
        let listed = status == .success ? String(advertised.contains(key)) : "unknown"
        print("  \(key): \(text); advertised=\(listed); AXError=\(error.rawValue)")
    }
}

let target = CommandLine.arguments.dropFirst().first
guard target == "chrome" || target == "silk" else { stop("Use chrome or silk.") }
guard AXIsProcessTrusted() else { stop("This terminal does not have macOS Accessibility permission.") }
let apps = NSWorkspace.shared.runningApplications.filter {
    target == "chrome" ? $0.bundleIdentifier == "com.google.Chrome"
        : $0.executableURL?.lastPathComponent == "ui-virtual-list-demo"
}
guard !apps.isEmpty else { stop("No running \(target!) application matched the probe.") }
var matchedWindow = false
var scanned = 0
var seen = Set<String>()
// The native host publishes its first AX update asynchronously after a query.
for attempt in 0..<6 {
for app in apps {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    let (_, windows) = read(root, "AXWindows")
    for window in windows as? [AXUIElement] ?? [] {
        guard let title = read(window, "AXTitle").1 as? String,
              title.contains("Observatory dispatches") else { continue }
        matchedWindow = true
        var pending = [(window, 0)]
        var visited = 0
        while let (node, depth) = pending.popLast(), visited < 5000 {
            visited += 1
            scanned += 1
            let articles = children(node)
            let subrole = read(node, "AXSubrole").1 as? String
            let name = read(node, "AXTitle").1 as? String
            let kind = read(node, "AXRoleDescription").1 as? String
            if let subrole { seen.insert(subrole) }
            if subrole == "AXApplicationGroup" || kind == "feed" || name == "Observatory dispatches",
               let article = articles.first(where: {
                   read($0, "AXSubrole").1 as? String == "AXDocumentArticle" ||
                   read($0, "AXRoleDescription").1 as? String == "article" ||
                   (read($0, "AXTitle").1 as? String)?.hasPrefix("First light") == true
               }) {
                describe("Feed", node)
                describe("First article", article)
                exit(0)
            }
            if depth < 40 { pending.append(contentsOf: articles.reversed().map { ($0, depth + 1) }) }
        }
    }
}
    if attempt < 5 { Thread.sleep(forTimeInterval: 0.3) }
}
stop(matchedWindow
    ? "Found the window, but no matching feed/article pair after \(scanned) node visits. Subroles: \(seen.sorted())"
    : "Found the application, but not its Observatory dispatches window. Open the feed demo or select its HTML tab.")
