import AppKit
import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published var settings: LocalmarkSettings?
    @Published var state: SyncState?
    @Published private(set) var capabilities: PlatformCapabilities?
    @Published private(set) var qmdStatus: QmdStatus?
    @Published var dataDirectory = ""
    @Published var busy = false
    @Published var running = false
    @Published var saving = false
    @Published var errorMessage: String?
    @Published var notice: String?
    @Published private(set) var accountChecks: [String: AccountCheck] = [:]
    private var checkingAccounts = Set<String>()

    private var client: CoreClient?

    init() {
        do { client = try CoreClient() } catch { errorMessage = error.localizedDescription }
        refresh()
    }

    var iconName: String {
        if running { return "arrow.triangle.2.circlepath" }
        if errorMessage != nil || state?.platforms.values.contains(where: { $0.lastError != nil }) == true { return "exclamationmark.circle" }
        return settings?.autoSync == true ? "checkmark.circle" : "pause.circle"
    }

    func refresh() {
        guard let client, !busy else { return }
        busy = true; errorMessage = nil
        Task.detached {
            do {
                let snapshot = try client.loadStatus()
                await MainActor.run {
                    self.settings = snapshot.settings; self.state = snapshot.state
                    self.capabilities = snapshot.capabilities
                    self.qmdStatus = snapshot.qmd
                    self.dataDirectory = snapshot.dataDir; self.busy = false
                }
            } catch {
                await MainActor.run { self.errorMessage = error.localizedDescription; self.busy = false }
            }
        }
    }

    func update() {
        guard let client, let settings, !saving else { return }
        saving = true; errorMessage = nil; notice = nil
        Task.detached {
            do {
                try client.save(settings)
                let snapshot = try client.loadStatus()
                await MainActor.run {
                    self.settings = snapshot.settings; self.state = snapshot.state
                    self.capabilities = snapshot.capabilities
                    self.qmdStatus = snapshot.qmd
                    self.saving = false; self.notice = "설정을 적용했습니다."
                }
            } catch {
                await MainActor.run { self.errorMessage = error.localizedDescription; self.saving = false }
            }
        }
    }

    func runNow() {
        guard let client, !running else { return }
        running = true; errorMessage = nil; notice = nil
        Task.detached {
            let failure: String?
            do { try client.runNow(); failure = nil } catch { failure = error.localizedDescription }
            // A partial failure still saves per-platform results, so reload them either way.
            let snapshot = try? client.loadStatus()
            await MainActor.run {
                if let snapshot {
                    self.state = snapshot.state; self.settings = snapshot.settings
                    self.capabilities = snapshot.capabilities
                    self.qmdStatus = snapshot.qmd
                }
                self.running = false
                guard let failure else { self.notice = "수집을 마쳤습니다."; return }
                let platformFailed = snapshot?.state.platforms.values.contains { $0.lastError != nil } == true
                self.errorMessage = platformFailed ? "일부 플랫폼 수집에 실패했습니다. 각 플랫폼 아래 메시지를 확인하세요." : failure
            }
        }
    }

    func verifyAccount(_ platform: String) {
        guard let client, let expected = expectedAccount(for: platform), let browser = selectedBrowser(for: platform),
              !checkingAccounts.contains(platform), !saving else { return }
        checkingAccounts.insert(platform)
        accountChecks[platform] = AccountCheck(expected: expected, detected: nil, status: .checking, message: nil)
        Task.detached {
            do {
                let detected = try client.detectAccount(platform, browser: browser)
                await MainActor.run { self.finishAccountCheck(platform: platform, detected: detected, error: nil) }
            } catch {
                await MainActor.run { self.finishAccountCheck(platform: platform, detected: nil, error: error) }
            }
        }
    }

    func browserChanged(_ platform: String) {
        accountChecks[platform] = nil
        update()
    }

    func useDetectedAccount(_ platform: String) {
        guard let detected = accountChecks[platform]?.detected, !saving else { return }
        setExpectedAccount(detected, for: platform)
        accountChecks[platform] = AccountCheck(expected: detected, detected: detected, status: .verified, message: nil)
        update()
    }

    func accountCheck(for platform: String) -> AccountCheck? {
        guard let check = accountChecks[platform], check.expected == expectedAccount(for: platform) else { return nil }
        return check
    }

    private func finishAccountCheck(platform: String, detected: String?, error: Error?) {
        checkingAccounts.remove(platform)
        guard let expected = expectedAccount(for: platform) else { return }
        if let detected {
            accountChecks[platform] = AccountCheck(
                expected: expected,
                detected: detected,
                status: detected == expected ? .verified : .mismatch,
                message: detected == expected ? nil : "\(browserLabel(for: platform))에는 @\(detected)가 로그인되어 있습니다."
            )
        } else {
            let message = error?.localizedDescription ?? "계정을 확인하지 못했습니다."
            accountChecks[platform] = AccountCheck(
                expected: expected,
                detected: nil,
                status: message.contains("login required") ? .loginRequired : .failed,
                message: message
            )
        }
    }

    private func selectedBrowser(for platform: String) -> String? {
        guard let settings else { return nil }
        switch platform {
        case "x": return settings.platforms.x.browser
        case "threads": return settings.platforms.threads.browser
        default: return nil
        }
    }

    private func browserLabel(for platform: String) -> String {
        selectedBrowser(for: platform) == "chrome" ? "Chrome" : "ego lite"
    }

    private func expectedAccount(for platform: String) -> String? {
        guard let settings else { return nil }
        switch platform {
        case "x": return settings.platforms.x.account
        case "threads": return settings.platforms.threads.account
        default: return nil
        }
    }

    private func setExpectedAccount(_ account: String, for platform: String) {
        guard var settings else { return }
        switch platform {
        case "x": settings.platforms.x.account = account
        case "threads": settings.platforms.threads.account = account
        default: return
        }
        self.settings = settings
    }

    func chooseDataDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false; panel.canChooseDirectories = true
        panel.canCreateDirectories = true; panel.prompt = "선택"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        UserDefaults.standard.set(url.path, forKey: "dataDirectory")
        do {
            client = try CoreClient()
            settings = nil; state = nil; refresh()
        } catch { errorMessage = error.localizedDescription }
    }

    func openDataDirectory() {
        guard let client else { return }
        try? FileManager.default.createDirectory(at: client.dataURL, withIntermediateDirectories: true)
        NSWorkspace.shared.open(client.dataURL)
    }

    func state(for platform: String) -> PlatformState? { state?.platforms[platform] }

    func capability(for platform: String) -> PlatformCapability? {
        switch platform {
        case "x": return capabilities?.x
        case "threads": return capabilities?.threads
        default: return nil
        }
    }
}
