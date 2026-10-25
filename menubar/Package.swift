// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LocalmarkMenuBar",
    platforms: [.macOS(.v13)],
    targets: [.executableTarget(name: "LocalmarkMenuBar", path: "Sources/LocalmarkMenuBar")]
)
