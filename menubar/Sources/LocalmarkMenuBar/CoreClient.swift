import Foundation

final class CoreClient {
    private struct BundleConfig: Decodable { let initialDataDirectory: String? }
    private struct AccountResponse: Decodable { let account: String }

    let rootURL: URL
    let dataURL: URL
    private let nodeURL: URL

    init() throws {
        let fileManager = FileManager.default
        let environment = ProcessInfo.processInfo.environment
        let bundledRoot = Bundle.main.resourceURL?.appendingPathComponent("core", isDirectory: true)
        let developmentRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()

        if let bundledRoot, fileManager.fileExists(atPath: bundledRoot.appendingPathComponent("src/cli.ts").path) {
            rootURL = bundledRoot
        } else if let configured = environment["LOCALMARK_ROOT"] {
            rootURL = URL(fileURLWithPath: configured, isDirectory: true)
        } else {
            rootURL = developmentRoot
        }
        guard fileManager.fileExists(atPath: rootURL.appendingPathComponent("src/cli.ts").path) else {
            throw CoreError.missingRuntime("수집 코어를 찾을 수 없습니다: \(rootURL.path)")
        }

        if let saved = UserDefaults.standard.string(forKey: "dataDirectory") {
            dataURL = URL(fileURLWithPath: saved, isDirectory: true)
        } else {
            let configURL = Bundle.main.resourceURL?.appendingPathComponent("bundle-config.json")
            let config = configURL.flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONDecoder().decode(BundleConfig.self, from: $0) }
            dataURL = URL(fileURLWithPath: config?.initialDataDirectory ?? rootURL.appendingPathComponent("data").path, isDirectory: true)
        }

        let bundledNode = rootURL.deletingLastPathComponent().appendingPathComponent("node/bin/node")
        let candidates = [bundledNode.path, environment["LOCALMARK_NODE"], "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].compactMap { $0 }
        guard let node = candidates.first(where: { fileManager.isExecutableFile(atPath: $0) }) else {
            throw CoreError.missingRuntime("Node 22 실행 파일을 찾을 수 없습니다.")
        }
        nodeURL = URL(fileURLWithPath: node)
    }

    private var environment: [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["LOCALMARK_ROOT"] = rootURL.path
        environment["LOCALMARK_NODE"] = nodeURL.path
        environment["LOCALMARK_DATA_DIR"] = dataURL.path
        environment["PATH"] = [NSHomeDirectory() + "/.local/bin", nodeURL.deletingLastPathComponent().path, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].joined(separator: ":")
        return environment
    }

    func initialize() throws { _ = try runCLI(["init"]) }

    func loadStatus() throws -> StatusSnapshot {
        _ = try runCLI(["init"])
        let result = try runCLI(["status"])
        return try JSONDecoder().decode(StatusSnapshot.self, from: Data(result.stdout.utf8))
    }

    func save(_ settings: LocalmarkSettings) throws {
        let data = try JSONEncoder().encode(settings)
        _ = try runCLI(["settings", "--set", String(decoding: data, as: UTF8.self)])
        _ = try run(executable: URL(fileURLWithPath: "/bin/bash"), arguments: [rootURL.appendingPathComponent("scripts/install-launch-agent.sh").path])
    }

    func runNow() throws { _ = try runCLI(["sync"]) }

    func detectAccount(_ platform: String, browser: String) throws -> String {
        let result = try runCLI(["accounts", "--platform", platform, "--browser", browser])
        return try JSONDecoder().decode(AccountResponse.self, from: Data(result.stdout.utf8)).account
    }

    private func runCLI(_ arguments: [String]) throws -> ProcessResult {
        try run(executable: nodeURL, arguments: ["--import", "tsx", rootURL.appendingPathComponent("src/cli.ts").path] + arguments + ["--data", dataURL.path])
    }

    private func run(executable: URL, arguments: [String]) throws -> ProcessResult {
        let process = Process(), stdout = Pipe(), stderr = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = rootURL
        process.environment = environment
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        var output = Data(), errors = Data()
        let group = DispatchGroup()
        group.enter(); DispatchQueue.global().async { output = stdout.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        group.enter(); DispatchQueue.global().async { errors = stderr.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        process.waitUntilExit(); group.wait()
        let result = ProcessResult(status: process.terminationStatus, stdout: String(decoding: output, as: UTF8.self), stderr: String(decoding: errors, as: UTF8.self))
        if result.status != 0 {
            let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw CoreError.commandFailed(detail.isEmpty ? "명령이 실패했습니다." : detail)
        }
        return result
    }
}
